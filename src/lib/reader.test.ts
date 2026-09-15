import { describe, expect, it } from 'vitest';
import { planArtifact } from './artifacts';
import { reassembleEnvelopes, type ArtifactEnvelope } from './reader';

describe('artifact recovery', () => {
  it('reassembles and verifies chunks in any order', async () => {
    const source = new TextEncoder().encode('permanent, verifiable, composable');
    const plan = await planArtifact({ bytes: source, kind: 'text', name: 'idea.txt', mime: 'text/plain', mode: 'legacy' });
    const envelopes = plan.encodedChunks.map(chunk => JSON.parse(new TextDecoder().decode(chunk)) as ArtifactEnvelope).reverse();
    const recovered = await reassembleEnvelopes(envelopes);
    expect(new TextDecoder().decode(recovered.bytes)).toBe('permanent, verifiable, composable');
    expect(recovered.hash).toBe(plan.hash);
  });

  it('rejects missing chunks', async () => {
    const source = new Uint8Array(1_500).fill(9);
    const plan = await planArtifact({ bytes: source, kind: 'file', name: 'x.bin', mime: 'application/octet-stream', mode: 'legacy' });
    const envelopes = plan.encodedChunks.slice(1).map(chunk => JSON.parse(new TextDecoder().decode(chunk)) as ArtifactEnvelope);
    await expect(reassembleEnvelopes(envelopes)).rejects.toThrow('incomplete');
  });
});
