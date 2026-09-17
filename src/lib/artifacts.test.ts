import { describe, expect, it } from 'vitest';
import { blockhash } from '@solana/kit';
import {
  ARTIFACT_PROTOCOL,
  encodeAsciiJson,
  LEGACY_MEMO_BUDGET,
  MAX_COMPUTE_UNITS,
  MAX_FILE_BYTES,
  MAX_MIME_BYTES,
  MAX_NAME_BYTES,
  memoComputeUnitLimit,
  planArtifact,
  sha256,
  V1_MEMO_BUDGET,
  type TransactionMode,
} from './artifacts';
import { getMemoTransactionSize } from './transactions';

const payer = 'THREEZmp7v26VbpQ8B27bBaLNA2zMyaNHWpkQtJkrgd';
const lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n };

function transactionSize(mode: TransactionMode, memo: Uint8Array): number {
  return getMemoTransactionSize({ mode, payer, lifetime, memo: new TextDecoder().decode(memo) });
}

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

  it.each([
    ['legacy', LEGACY_MEMO_BUDGET, 1_232],
    ['v1', V1_MEMO_BUDGET, 4_096],
  ] as const)('keeps every %s chunk within the encoded Memo and wire limits', async (mode, memoLimit, wireLimit) => {
    const plan = await planArtifact({
      bytes: new Uint8Array(MAX_FILE_BYTES).fill(7),
      kind: 'file',
      name: 'n'.repeat(MAX_NAME_BYTES),
      mime: 'm'.repeat(MAX_MIME_BYTES),
      mode,
    });
    expect(plan.encodedChunks.length).toBeGreaterThan(1);
    for (const memo of plan.encodedChunks) {
      expect(memo.length).toBeLessThanOrEqual(memoLimit);
      expect(transactionSize(mode, memo)).toBeLessThanOrEqual(wireLimit);
      expect(memoComputeUnitLimit(memo)).toBeLessThanOrEqual(MAX_COMPUTE_UNITS);
    }
  }, 20_000);

  it('keeps envelopes ASCII so Memo compute cost stays linear', async () => {
    const name = '\u{1F600}'.repeat(63);
    const plan = await planArtifact({ bytes: new Uint8Array(9_000).fill(7), kind: 'file', name, mime: 'text/plain; charset=\u00e9', mode: 'v1' });
    for (const memo of plan.encodedChunks) {
      expect(memo.every(byte => byte < 0x7f)).toBe(true);
      expect(transactionSize('v1', memo)).toBeLessThanOrEqual(4_096);
      expect(memoComputeUnitLimit(memo)).toBeLessThanOrEqual(MAX_COMPUTE_UNITS);
    }
    const first = JSON.parse(new TextDecoder().decode(plan.encodedChunks[0]));
    expect(first.name).toBe(name);
    expect(first.mime).toBe('text/plain; charset=\u00e9');
  });

  it('escapes non-ASCII and DEL without changing the decoded value', () => {
    const value = { name: '\u6f22\u{1F600}\u00e9\u007f\n"' };
    const encoded = encodeAsciiJson(value);
    expect(encoded.every(byte => byte < 0x7f)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(encoded))).toEqual(value);
  });

  it('sizes the compute limit from the memo and refuses unsafe payloads', () => {
    expect(memoComputeUnitLimit(new Uint8Array(V1_MEMO_BUDGET).fill(97))).toBe(MAX_COMPUTE_UNITS);
    expect(memoComputeUnitLimit(new Uint8Array(1_000).fill(97))).toBe(Math.ceil((1_400 + 352 * 1_000) * 1.05));
    expect(() => memoComputeUnitLimit(new Uint8Array(4_000).fill(97))).toThrow('compute unit');
    expect(() => memoComputeUnitLimit(new TextEncoder().encode('\u6f22'))).toThrow('ASCII');
  });

  it('rejects metadata that cannot be represented safely', async () => {
    await expect(planArtifact({
      bytes: new Uint8Array([1]),
      kind: 'file',
      name: 'n'.repeat(MAX_NAME_BYTES + 1),
      mime: 'application/octet-stream',
      mode: 'v1',
    })).rejects.toThrow('limited');
  });
});
