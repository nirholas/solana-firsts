import bs58 from 'bs58';
import { z } from 'zod';
import { MAX_FILE_BYTES, MAX_MIME_BYTES, MAX_NAME_BYTES, sha256 } from './artifacts';
import { RPC_ENDPOINTS, type Cluster } from './config';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MAX_MANIFEST_SIGNATURES = 1_000;

const envelopeSchema = z.object({
  p: z.literal('firsts/1'),
  id: z.string().regex(/^[0-9a-f]{16}$/u),
  i: z.number().int().nonnegative(),
  n: z.number().int().positive().max(1_000),
  name: z.string().refine(value => new TextEncoder().encode(value).length <= MAX_NAME_BYTES).optional(),
  mime: z.string().refine(value => new TextEncoder().encode(value).length <= MAX_MIME_BYTES).optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
  data: z.string().max(4_096).regex(/^[A-Za-z0-9_-]*$/u),
}).passthrough();

export type ArtifactEnvelope = z.infer<typeof envelopeSchema>;

export interface RecoveredArtifact {
  id: string;
  name: string;
  mime: string;
  hash: string;
  bytes: Uint8Array;
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function reassembleEnvelopes(envelopes: readonly ArtifactEnvelope[]): Promise<RecoveredArtifact> {
  if (!envelopes.length) throw new Error('No Firsts protocol chunks were found.');
  const sorted = envelopes.map(value => envelopeSchema.parse(value)).sort((left, right) => left.i - right.i);
  const first = sorted[0];
  if (sorted.some(item => item.p !== 'firsts/1' || item.id !== first.id || item.n !== first.n)) {
    throw new Error('The signatures contain chunks from different artifacts.');
  }
  if (sorted.length !== first.n || sorted.some((item, index) => item.i !== index)) {
    throw new Error(`Artifact is incomplete: found ${sorted.length} of ${first.n} chunks.`);
  }
  if (!first.name || !first.mime || !first.hash) throw new Error('Chunk zero is missing required artifact metadata.');
  if (first.id !== first.hash.slice(0, 16)) throw new Error('Artifact ID does not match the full content digest.');
  if (sorted.slice(1).some(item => item.name !== undefined || item.mime !== undefined || item.hash !== undefined)) {
    throw new Error('Only chunk zero may contain artifact metadata.');
  }
  const chunks = sorted.map(item => base64UrlDecode(item.data));
  const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (byteLength > MAX_FILE_BYTES) throw new Error('Recovered artifact exceeds the 256 KB protocol limit.');
  const bytes = new Uint8Array(byteLength);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  const digest = await sha256(bytes);
  if (digest !== first.hash) throw new Error('SHA-256 verification failed. The recovered bytes do not match the inscription.');
  return { id: first.id, name: first.name, mime: first.mime, hash: digest, bytes };
}

type JsonInstruction = { programIdIndex?: number; data?: string; parsed?: unknown; programId?: string };
type TransactionResponse = {
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }>; instructions?: JsonInstruction[] } };
};

function normalizeSignatures(values: readonly string[]): string[] {
  const signatures = values.map(value => value.trim()).filter(Boolean);
  if (!signatures.length) throw new Error('At least one transaction signature is required.');
  if (signatures.length > MAX_MANIFEST_SIGNATURES) throw new Error(`A manifest can contain at most ${MAX_MANIFEST_SIGNATURES} signatures.`);
  if (new Set(signatures).size !== signatures.length) throw new Error('The recovery manifest contains duplicate signatures.');
  for (const [index, signature] of signatures.entries()) {
    try {
      if (bs58.decode(signature).length !== 64) throw new Error();
    } catch {
      throw new Error(`Signature ${index + 1} is not a valid Solana transaction signature.`);
    }
  }
  return signatures;
}

async function fetchTransaction(signature: string, cluster: Cluster, index: number): Promise<TransactionResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(RPC_ENDPOINTS[cluster], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }),
    });
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}.`);
    const payload = await response.json() as { result?: TransactionResponse | null; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message ?? 'RPC rejected the transaction lookup.');
    if (!payload.result?.transaction?.message) throw new Error(`Transaction ${index + 1} was not found on ${cluster}.`);
    return payload.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(`Transaction ${index + 1} lookup timed out.`);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function readArtifact(signatures: readonly string[], cluster: Cluster): Promise<RecoveredArtifact> {
  const normalized = normalizeSignatures(signatures);
  const envelopes: ArtifactEnvelope[] = [];
  for (const [index, signature] of normalized.entries()) {
    const payload = await fetchTransaction(signature, cluster, index);
    const message = payload.transaction!.message!;
    const keys = message.accountKeys ?? [];
    const memos = (message.instructions ?? []).filter(instruction => {
      if (instruction.programId === MEMO_PROGRAM) return true;
      const key = instruction.programIdIndex === undefined ? undefined : keys[instruction.programIdIndex];
      return (typeof key === 'string' ? key : key?.pubkey) === MEMO_PROGRAM;
    });
    if (!memos.length) throw new Error(`Transaction ${index + 1} does not contain a Memo Program instruction.`);
    let found = false;
    for (const memo of memos) {
      if (!memo.data) continue;
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bs58.decode(memo.data));
        const parsed = JSON.parse(decoded) as unknown;
        if (typeof parsed === 'object' && parsed !== null && 'p' in parsed && parsed.p === 'firsts/1') {
          envelopes.push(envelopeSchema.parse(parsed));
          found = true;
        }
      } catch {
        // Other Memo instructions may coexist with a Firsts envelope.
      }
    }
    if (!found) throw new Error(`Transaction ${index + 1} contains no valid Firsts artifact chunk.`);
  }
  return reassembleEnvelopes(envelopes);
}
