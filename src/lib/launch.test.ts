import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { METADATA_KEYS } from './chain-read';
import {
  LEGACY_TRANSACTION_LIMIT, MAX_DESCRIPTION_CHARACTERS, V1_TRANSACTION_LIMIT,
  buildLaunchGroups, launchAccountBytes, launchMetadataPairs, measureLaunchTransaction,
  packLaunchGroups, planLaunch, tokenMetadataUri, validateLaunchText, type LaunchSpec,
} from './launch';

// A real key, because the system program address may never be a fee payer.
const payer = (await generateKeyPairSigner()).address;
const signature = '4'.repeat(87);

async function spec(overrides: Partial<LaunchSpec> = {}): Promise<LaunchSpec> {
  return {
    payer,
    mint: await generateKeyPairSigner(),
    cluster: 'devnet',
    name: 'First Artifact',
    symbol: 'FIRST',
    decimals: 6,
    amount: 1_000_000_000_000_000n,
    uri: tokenMetadataUri('https://solana-firsts.pages.dev', 'devnet', payer),
    lockSupply: true,
    lockMetadata: true,
    ...overrides,
  };
}

describe('launch planning', () => {
  it('keeps every packed transaction inside the wire limit for its mode', async () => {
    const base = await spec({
      description: 'd'.repeat(MAX_DESCRIPTION_CHARACTERS),
      links: { website: `https://example.com/${'p'.repeat(150)}`, x: 'https://x.com/firsts', telegram: 'https://t.me/firsts' },
      image: { hash: 'a'.repeat(64), signatures: [signature, signature.replace('4', '5')] },
    });
    const groups = await buildLaunchGroups(base, 2_000_000n);
    for (const [mode, limit] of [['legacy', LEGACY_TRANSACTION_LIMIT], ['v1', V1_TRANSACTION_LIMIT]] as const) {
      const packed = packLaunchGroups(mode, payer, groups);
      expect(packed.length).toBeGreaterThan(0);
      for (const instructions of packed) {
        expect(measureLaunchTransaction(mode, payer, instructions)).toBeLessThanOrEqual(limit);
      }
      // Packing may merge groups but must never drop or reorder an instruction.
      expect(packed.flat()).toEqual(groups.flat());
    }
  });

  it('collapses a rich launch into fewer v1 transactions than legacy allows', async () => {
    const groups = await buildLaunchGroups(await spec({
      description: 'd'.repeat(MAX_DESCRIPTION_CHARACTERS),
      links: { website: 'https://example.com', x: 'https://x.com/firsts', telegram: 'https://t.me/firsts' },
      image: { hash: 'a'.repeat(64), signatures: [signature] },
    }), 2_000_000n);
    expect(packLaunchGroups('v1', payer, groups).length).toBeLessThan(packLaunchGroups('legacy', payer, groups).length);
  });

  it('funds rent for the metadata the mint will grow into', async () => {
    const withMetadata = await spec({ description: 'Story', links: { website: 'https://example.com' } });
    const { allocated, funded } = launchAccountBytes(withMetadata);
    expect(funded).toBeGreaterThan(allocated);
    const requested: number[] = [];
    const plan = await planLaunch(withMetadata, 'v1', async bytes => { requested.push(bytes); return 3_000_000n; });
    expect(requested).toEqual([funded]);
    expect(plan.rentLamports).toBe(3_000_000n);
    expect(plan.mint).toBe(withMetadata.mint.address);
  });

  it('revokes authorities last so the supply can still be minted', async () => {
    const groups = await buildLaunchGroups(await spec({ lockSupply: true, lockMetadata: true }), 2_000_000n);
    const flat = groups.flat();
    const mintTo = flat.findIndex(instruction => instruction.data?.[0] === 7);
    expect(mintTo).toBeGreaterThan(-1);
    expect(flat.length - mintTo).toBeGreaterThan(2);
  });

  it('writes the image pointer only with a full digest and manifest', async () => {
    const pairs = launchMetadataPairs({ description: 'hi', image: { hash: 'b'.repeat(64), signatures: [signature] } });
    expect(Object.fromEntries(pairs)).toMatchObject({
      [METADATA_KEYS.description]: 'hi',
      [METADATA_KEYS.imageHash]: 'b'.repeat(64),
      [METADATA_KEYS.imageTransactions]: signature,
    });
    expect(() => launchMetadataPairs({ image: { hash: 'nothex', signatures: [signature] } })).toThrow('SHA-256');
    expect(() => launchMetadataPairs({ image: { hash: 'b'.repeat(64), signatures: [] } })).toThrow('no transaction signatures');
    expect(() => launchMetadataPairs({ description: 'x'.repeat(MAX_DESCRIPTION_CHARACTERS + 1) })).toThrow('limited to');
  });

  it('rejects links that are not https URLs', () => {
    expect(() => launchMetadataPairs({ links: { website: 'example.com' } })).toThrow('full https:// URL');
    expect(() => launchMetadataPairs({ links: { x: 'http://x.com/a' } })).toThrow('must use https://');
    expect(launchMetadataPairs({ links: { telegram: '  https://t.me/a  ' } }).at(-1)).toEqual([METADATA_KEYS.telegram, 'https://t.me/a']);
  });

  it('normalizes the ticker and refuses unusable names', () => {
    expect(validateLaunchText('  First  ', ' first ')).toEqual({ name: 'First', symbol: 'FIRST' });
    expect(() => validateLaunchText('', 'FIRST')).toThrow('name is required');
    expect(() => validateLaunchText('n'.repeat(33), 'FIRST')).toThrow('32 characters');
    expect(() => validateLaunchText('First', 'to-o-long!')).toThrow('1 to 10 letters');
  });

  it('refuses supply, decimals, and metadata the chain would reject', async () => {
    await expect(buildLaunchGroups(await spec({ amount: 0n }), 1n)).rejects.toThrow('greater than zero');
    await expect(buildLaunchGroups(await spec({ decimals: 10 }), 1n)).rejects.toThrow('0 to 9');
    await expect(buildLaunchGroups(await spec({ uri: `https://example.com/${'u'.repeat(200)}` }), 1n)).rejects.toThrow('URI is too long');
  });

  it('builds a metadata URI on the canonical origin', () => {
    expect(tokenMetadataUri('https://solana-firsts.pages.dev/', 'mainnet', payer)).toBe(`https://solana-firsts.pages.dev/api/token/mainnet/${payer}`);
  });
});
