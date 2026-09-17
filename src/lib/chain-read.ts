import bs58 from 'bs58';
import { z } from 'zod';
import { MAX_FILE_BYTES, MAX_MIME_BYTES, MAX_NAME_BYTES, sha256 } from './artifacts';

// Environment-free chain reads. Shared by the browser studio and the Cloudflare
// Pages resolver, so nothing here may touch import.meta.env or the DOM.

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const MAX_MANIFEST_SIGNATURES = 1_000;
const RPC_TIMEOUT_MS = 15_000;

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

export function isSignature(value: string): boolean {
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}

export function isAddress(value: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value) && bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

export function normalizeSignatures(values: readonly string[]): string[] {
  const signatures = values.map(value => value.trim()).filter(Boolean);
  if (!signatures.length) throw new Error('At least one transaction signature is required.');
  if (signatures.length > MAX_MANIFEST_SIGNATURES) throw new Error(`A manifest can contain at most ${MAX_MANIFEST_SIGNATURES} signatures.`);
  if (new Set(signatures).size !== signatures.length) throw new Error('The recovery manifest contains duplicate signatures.');
  signatures.forEach((signature, index) => {
    if (!isSignature(signature)) throw new Error(`Signature ${index + 1} is not a valid Solana transaction signature.`);
  });
  return signatures;
}

export async function rpcCall<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`RPC ${method} timed out.`);
    }
    throw error;
  }
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}${response.statusText ? ` (${response.statusText})` : ''}.`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? `RPC rejected ${method}.`);
  return payload.result as T;
}

type JsonInstruction = { programIdIndex?: number; data?: string; programId?: string };
type TransactionResponse = {
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }>; instructions?: JsonInstruction[] } };
} | null;

export function extractEnvelopes(transaction: NonNullable<TransactionResponse>): ArtifactEnvelope[] {
  const message = transaction.transaction?.message;
  if (!message) return [];
  const keys = message.accountKeys ?? [];
  const envelopes: ArtifactEnvelope[] = [];
  for (const instruction of message.instructions ?? []) {
    const key = instruction.programId ?? (instruction.programIdIndex === undefined ? undefined : keys[instruction.programIdIndex]);
    const program = typeof key === 'string' ? key : key?.pubkey;
    if (program !== MEMO_PROGRAM || !instruction.data) continue;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bs58.decode(instruction.data));
      const parsed = JSON.parse(decoded) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'p' in parsed && parsed.p === 'firsts/1') {
        envelopes.push(envelopeSchema.parse(parsed));
      }
    } catch {
      continue;
    }
  }
  return envelopes;
}

export async function readArtifactFrom(endpoint: string, signatures: readonly string[], networkLabel: string): Promise<RecoveredArtifact> {
  const normalized = normalizeSignatures(signatures);
  const envelopes: ArtifactEnvelope[] = [];
  for (const [index, signature] of normalized.entries()) {
    const payload = await rpcCall<TransactionResponse>(endpoint, 'getTransaction', [
      signature,
      { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 1 },
    ]);
    if (!payload?.transaction?.message) throw new Error(`Transaction ${index + 1} was not found on ${networkLabel}.`);
    const found = extractEnvelopes(payload);
    if (!found.length) throw new Error(`Transaction ${index + 1} contains no valid Firsts artifact chunk.`);
    envelopes.push(...found);
  }
  return reassembleEnvelopes(envelopes);
}

export const LAUNCH_PROTOCOL = 'token/2';

export const METADATA_KEYS = {
  protocol: 'firsts',
  description: 'description',
  imageHash: 'image_sha256',
  imageTransactions: 'image_tx',
  website: 'website',
  x: 'x',
  telegram: 'telegram',
} as const;

export interface LaunchedToken {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  updateAuthority: string | null;
  metadata: Record<string, string>;
  image?: { hash: string; signatures: string[] };
}

type ParsedExtension = { extension: string; state?: Record<string, unknown> };
type ParsedMintAccount = {
  value: null | {
    owner: string;
    data: { parsed?: { type?: string; info?: {
      decimals?: number;
      supply?: string;
      mintAuthority?: string | null;
      freezeAuthority?: string | null;
      extensions?: ParsedExtension[];
    } } } | [string, string];
  };
};

export async function readLaunchedToken(endpoint: string, mint: string): Promise<LaunchedToken> {
  if (!isAddress(mint)) throw new Error('That is not a valid Solana mint address.');
  const account = await rpcCall<ParsedMintAccount>(endpoint, 'getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  if (!account.value) throw new Error('No account exists at that mint address.');
  if (account.value.owner !== TOKEN_2022_PROGRAM) throw new Error('This mint is not a Token-2022 mint, so it carries no onchain metadata.');
  const data = account.value.data;
  const info = Array.isArray(data) ? undefined : data.parsed?.info;
  if (Array.isArray(data) || data.parsed?.type !== 'mint' || !info) throw new Error('That address is a token account, not a mint.');
  const extensions = info.extensions ?? [];
  const pointer = extensions.find(entry => entry.extension === 'metadataPointer')?.state;
  const state = extensions.find(entry => entry.extension === 'tokenMetadata')?.state;
  if (!state) throw new Error('This mint has no embedded token metadata.');
  if (pointer?.metadataAddress !== mint) throw new Error('The metadata pointer does not reference the mint itself.');
  if (state.mint !== mint) throw new Error('Embedded metadata names a different mint.');
  const metadata: Record<string, string> = {};
  for (const pair of (state.additionalMetadata as unknown[] | undefined) ?? []) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') metadata[pair[0]] = pair[1];
  }
  const imageHash = metadata[METADATA_KEYS.imageHash];
  const imageTransactions = metadata[METADATA_KEYS.imageTransactions]?.split(/\s+/u).filter(Boolean) ?? [];
  const validImage = imageHash !== undefined && /^[0-9a-f]{64}$/u.test(imageHash) && imageTransactions.length > 0 && imageTransactions.every(isSignature);
  return {
    mint,
    name: String(state.name ?? ''),
    symbol: String(state.symbol ?? ''),
    uri: String(state.uri ?? ''),
    decimals: info.decimals ?? 0,
    supply: info.supply ?? '0',
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    updateAuthority: typeof state.updateAuthority === 'string' ? state.updateAuthority : null,
    metadata,
    image: validImage ? { hash: imageHash, signatures: imageTransactions } : undefined,
  };
}

export async function readTokenImage(endpoint: string, token: LaunchedToken, networkLabel: string): Promise<RecoveredArtifact> {
  if (!token.image) throw new Error('This token has no inscribed image.');
  const artifact = await readArtifactFrom(endpoint, token.image.signatures, networkLabel);
  if (artifact.hash !== token.image.hash) throw new Error('The inscribed image does not match the digest stored in the mint.');
  return artifact;
}
