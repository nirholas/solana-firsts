import { describe, expect, it } from 'vitest';
import type { Blockhash } from '@solana/kit';
import { planArtifact } from './artifacts';
import { getMemoTransactionSize, parseTokenAmount } from './transactions';

const payer = '11111111111111111111111111111111';
const lifetime = { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 1n };

describe('transaction construction', () => {
  for (const [mode, limit] of [['legacy', 1_232], ['v1', 4_096]] as const) {
    it(`keeps worst-case ${mode} artifact chunks under ${limit} bytes`, async () => {
      const plan = await planArtifact({ bytes: new Uint8Array(256_000).fill(255), kind: 'file', name: 'n'.repeat(255), mime: 'x'.repeat(127), mode });
      for (const encoded of plan.encodedChunks) {
        const size = getMemoTransactionSize({ mode, payer, lifetime, memo: new TextDecoder().decode(encoded) });
        expect(size).toBeLessThanOrEqual(limit);
      }
    }, 20_000);
  }

  it('converts decimal supply to the exact SPL u64 amount', () => {
    expect(parseTokenAmount('1.25', 6)).toBe(1_250_000n);
    expect(parseTokenAmount('1', 0)).toBe(1n);
    expect(() => parseTokenAmount('1.001', 2)).toThrow('decimal places');
    expect(() => parseTokenAmount('0', 9)).toThrow('u64 range');
    expect(() => parseTokenAmount('18446744073709551616', 0)).toThrow('u64 range');
  });
});
