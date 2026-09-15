import bs58 from 'bs58';
import { sha256 } from './artifacts';
import type { Cluster } from './transactions';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export interface ArtifactEnvelope {
  p: 'firsts/1';
  id: string;
  i: number;
  n: number;
  name?: string;
  mime?: string;
  hash?: string;
  data: string;
}

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
  const sorted = [...envelopes].sort((left, right) => left.i - right.i);
  const first = sorted[0];
  if (sorted.some(item => item.p !== 'firsts/1' || item.id !== first.id || item.n !== first.n)) {
    throw new Error('The signatures contain chunks from different artifacts.');
  }
  if (sorted.length !== first.n || sorted.some((item, index) => item.i !== index)) {
    throw new Error(`Artifact is incomplete: found ${sorted.length} of ${first.n} chunks.`);
  }
  const chunks = sorted.map(item => base64UrlDecode(item.data));
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  const digest = await sha256(bytes);
  if (!first.hash || digest !== first.hash) throw new Error('SHA-256 verification failed. The recovered bytes do not match the inscription.');
  return { id: first.id, name: first.name ?? `${first.id}.bin`, mime: first.mime ?? 'application/octet-stream', hash: digest, bytes };
}

type JsonInstruction = { programIdIndex?: number; data?: string; parsed?: unknown; programId?: string };
type TransactionResponse = {
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }>; instructions?: JsonInstruction[] } };
};

export async function readArtifact(signatures: readonly string[], cluster: Cluster): Promise<RecoveredArtifact> {
  const endpoint = cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com';
  const envelopes: ArtifactEnvelope[] = [];
  for (const [index, signature] of signatures.entries()) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: index + 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }),
    });
    if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}.`);
    const payload = await response.json() as { result?: TransactionResponse | null; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message ?? 'RPC rejected the transaction lookup.');
    if (!payload.result?.transaction?.message) throw new Error(`Transaction ${index + 1} was not found on ${cluster}.`);
    const message = payload.result.transaction.message;
    const keys = message.accountKeys ?? [];
    const memo = (message.instructions ?? []).find(instruction => {
      if (instruction.programId === MEMO_PROGRAM) return true;
      const key = instruction.programIdIndex === undefined ? undefined : keys[instruction.programIdIndex];
      return (typeof key === 'string' ? key : key?.pubkey) === MEMO_PROGRAM;
    });
    if (!memo?.data) throw new Error(`Transaction ${index + 1} does not contain a Memo Program instruction.`);
    try {
      const decoded = new TextDecoder().decode(bs58.decode(memo.data));
      const envelope = JSON.parse(decoded) as ArtifactEnvelope;
      if (envelope.p === 'firsts/1') envelopes.push(envelope);
    } catch {
      throw new Error(`Transaction ${index + 1} contains a memo, but it is not a valid Firsts artifact chunk.`);
    }
  }
  return reassembleEnvelopes(envelopes);
}
