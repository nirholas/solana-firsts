export const ARTIFACT_PROTOCOL = 'firsts/1';
export const LEGACY_MEMO_BUDGET = 1_010;
export const V1_MEMO_BUDGET = 3_890;
export const MAX_COMPUTE_UNITS = 1_400_000;

// SPL Memo v3 costs about 351 compute units per ASCII byte on mainnet, but
// 3,700 to 4,300 per byte of 3- and 4-byte UTF-8. Envelopes are therefore
// ASCII-only, which keeps cost linear and a full v1 chunk under the cap.
const MEMO_BASE_COMPUTE_UNITS = 1_400;
const MEMO_COMPUTE_UNITS_PER_BYTE = 352;
const MEMO_COMPUTE_UNIT_HEADROOM = 1.05;
export const MAX_FILE_BYTES = 256_000;
export const MAX_NAME_BYTES = 255;
export const MAX_MIME_BYTES = 127;

export type ArtifactKind = 'text' | 'json' | 'image' | 'agent' | 'html' | 'file';
export type TransactionMode = 'legacy' | 'v1';

export interface ArtifactPlan {
  id: string;
  kind: ArtifactKind;
  name: string;
  mime: string;
  bytes: number;
  hash: string;
  mode: TransactionMode;
  chunks: Uint8Array[];
  encodedChunks: Uint8Array[];
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function assertMetadataFits(name: string, mime: string): void {
  if (!name.trim()) throw new Error('Artifact name is required.');
  if (!mime.trim()) throw new Error('Artifact MIME type is required.');
  if (encoder.encode(name).length > MAX_NAME_BYTES) throw new Error(`Artifact names are limited to ${MAX_NAME_BYTES} UTF-8 bytes.`);
  if (encoder.encode(mime).length > MAX_MIME_BYTES) throw new Error(`Artifact MIME types are limited to ${MAX_MIME_BYTES} UTF-8 bytes.`);
}

export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function encodeAsciiJson(value: unknown): Uint8Array {
  return encoder.encode(asciiJson(value));
}

export function memoComputeUnitLimit(memo: Uint8Array): number {
  if (memo.some(byte => byte > 0x7e)) throw new Error('Memo payloads must be ASCII-only JSON.');
  const estimate = MEMO_BASE_COMPUTE_UNITS + MEMO_COMPUTE_UNITS_PER_BYTE * memo.length;
  if (estimate > MAX_COMPUTE_UNITS) throw new Error(`A ${memo.length}-byte memo exceeds the ${MAX_COMPUTE_UNITS.toLocaleString('en-US')} compute unit transaction cap.`);
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(estimate * MEMO_COMPUTE_UNIT_HEADROOM));
}

function encodeEnvelope(input: {
  chunk: Uint8Array;
  hash: string;
  id: string;
  index: number;
  mime: string;
  name: string;
  total: number;
}): Uint8Array {
  return encodeAsciiJson({
    p: ARTIFACT_PROTOCOL,
    id: input.id,
    i: input.index,
    n: input.total,
    name: input.index === 0 ? input.name : undefined,
    mime: input.index === 0 ? input.mime : undefined,
    hash: input.index === 0 ? input.hash : undefined,
    data: base64Url(input.chunk),
  });
}

function maxChunkSize(input: {
  available: number;
  hash: string;
  id: string;
  index: number;
  memoBudget: number;
  mime: string;
  name: string;
  total: number;
}): number {
  let low = 0;
  let high = Math.min(input.available, Math.floor(input.memoBudget * 3 / 4));
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    const encoded = encodeEnvelope({ ...input, chunk: new Uint8Array(candidate) });
    if (encoded.length <= input.memoBudget) low = candidate;
    else high = candidate - 1;
  }
  return low;
}

function planChunks(input: {
  bytes: Uint8Array;
  hash: string;
  id: string;
  memoBudget: number;
  mime: string;
  name: string;
}): Uint8Array[] {
  let expectedTotal = 1;
  for (let pass = 0; pass < 10; pass += 1) {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    do {
      const size = maxChunkSize({
        ...input,
        available: input.bytes.length - offset,
        index: chunks.length,
        total: expectedTotal,
      });
      if (size === 0 && input.bytes.length > offset) throw new Error('The file name and MIME type leave no room for content in this transaction format. Shorten the name or use a wallet with v1 support.');
      chunks.push(input.bytes.slice(offset, offset + size));
      offset += size;
    } while (offset < input.bytes.length);
    if (chunks.length === expectedTotal) return chunks;
    expectedTotal = chunks.length;
  }
  throw new Error('Could not produce a stable artifact chunk plan.');
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function planArtifact(input: {
  bytes: Uint8Array;
  kind: ArtifactKind;
  name: string;
  mime: string;
  mode: TransactionMode;
}): Promise<ArtifactPlan> {
  if (input.bytes.length > MAX_FILE_BYTES) throw new Error('Artifacts are limited to 256 KB in this release.');
  assertMetadataFits(input.name, input.mime);
  const hash = await sha256(input.bytes);
  const id = hash.slice(0, 16);
  const memoBudget = input.mode === 'v1' ? V1_MEMO_BUDGET : LEGACY_MEMO_BUDGET;
  const chunks = planChunks({ ...input, hash, id, memoBudget });
  const encodedChunks = chunks.map((chunk, index) => encodeEnvelope({
    chunk,
    hash,
    id,
    index,
    mime: input.mime,
    name: input.name,
    total: chunks.length,
  }));
  return { ...input, bytes: input.bytes.length, hash, id, chunks, encodedChunks };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
