import { describe, expect, it } from 'vitest';
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  createTransactionMessage,
  getTransactionMessageSize,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  ARTIFACT_PROTOCOL,
  LEGACY_MEMO_BUDGET,
  MAX_FILE_BYTES,
  MAX_MIME_BYTES,
  MAX_NAME_BYTES,
  planArtifact,
  sha256,
  V1_MEMO_BUDGET,
  type TransactionMode,
} from './artifacts';

const payer = address('THREEZmp7v26VbpQ8B27bBaLNA2zMyaNHWpkQtJkrgd');
const lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 1n };

function transactionSize(mode: TransactionMode, memo: Uint8Array): number {
  const text = new TextDecoder().decode(memo);
  if (mode === 'v1') {
    return getTransactionMessageSize(pipe(
      createTransactionMessage({ version: 1 }),
      value => setTransactionMessageFeePayer(payer, value),
      value => setTransactionMessageLifetimeUsingBlockhash(lifetime, value),
      value => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: text }), value),
      value => setTransactionMessageConfig({
        computeUnitLimit: 20_000,
        loadedAccountsDataSizeLimit: 256 * 1024,
        priorityFeeLamports: 5_000n,
      }, value),
    ));
  }
  return getTransactionMessageSize(pipe(
    createTransactionMessage({ version: 'legacy' }),
    value => setTransactionMessageFeePayer(payer, value),
    value => setTransactionMessageLifetimeUsingBlockhash(lifetime, value),
    value => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: text }), value),
  ));
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
    }
  }, 20_000);

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
