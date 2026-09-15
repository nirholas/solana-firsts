import { describe, expect, it } from 'vitest';
import { ARTIFACT_PROTOCOL, planArtifact, sha256 } from './artifacts';

describe('artifact protocol', () => {
  it('uses the canonical SHA-256 digest', async () => {
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('plans larger v1 chunks without changing content identity', async () => {
    const bytes = new Uint8Array(2_000).fill(7);
    const legacy = await planArtifact({ bytes, kind: 'file', name: 'x.bin', mime: 'application/octet-stream', mode: 'legacy' });
    const v1 = await planArtifact({ bytes, kind: 'file', name: 'x.bin', mime: 'application/octet-stream', mode: 'v1' });
    expect(legacy.chunks).toHaveLength(3);
    expect(v1.chunks).toHaveLength(1);
    expect(v1.id).toBe(legacy.id);
    expect(JSON.parse(new TextDecoder().decode(v1.encodedChunks[0])).p).toBe(ARTIFACT_PROTOCOL);
  });
});
