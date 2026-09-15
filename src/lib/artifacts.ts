export const ARTIFACT_PROTOCOL = 'firsts/1';
export const LEGACY_PAYLOAD_BUDGET = 700;
export const V1_PAYLOAD_BUDGET = 2_700;
export const MAX_FILE_BYTES = 256_000;

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

function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) chunks.push(bytes.slice(offset, offset + size));
  return chunks.length ? chunks : [new Uint8Array()];
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
  const hash = await sha256(input.bytes);
  const id = hash.slice(0, 16);
  const budget = input.mode === 'v1' ? V1_PAYLOAD_BUDGET : LEGACY_PAYLOAD_BUDGET;
  const chunks = chunkBytes(input.bytes, budget);
  const encodedChunks = chunks.map((chunk, index) => {
    const envelope = {
      p: ARTIFACT_PROTOCOL,
      id,
      i: index,
      n: chunks.length,
      name: index === 0 ? input.name : undefined,
      mime: index === 0 ? input.mime : undefined,
      hash: index === 0 ? hash : undefined,
      data: base64Url(chunk),
    };
    return encoder.encode(JSON.stringify(envelope));
  });
  return { ...input, bytes: input.bytes.length, hash, id, chunks, encodedChunks };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
