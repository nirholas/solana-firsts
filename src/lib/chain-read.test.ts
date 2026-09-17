import { afterEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEYS, isAddress, isSignature, readLaunchedToken, TOKEN_2022_PROGRAM } from './chain-read';

const MINT = 'So11111111111111111111111111111111111111112';
const OWNER = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const SIGNATURE = '4'.repeat(87);

// Shapes a jsonParsed getAccountInfo reply the way Solana RPC returns one for a
// Token-2022 mint, so the reader is exercised against the real response layout.
function mintAccount(overrides: { extensions?: unknown[]; owner?: string; type?: string } = {}) {
  return {
    value: {
      owner: overrides.owner ?? TOKEN_2022_PROGRAM,
      data: {
        parsed: {
          type: overrides.type ?? 'mint',
          info: {
            decimals: 6,
            supply: '1000000000000000',
            mintAuthority: null,
            freezeAuthority: null,
            extensions: overrides.extensions ?? [
              { extension: 'metadataPointer', state: { authority: null, metadataAddress: MINT } },
              {
                extension: 'tokenMetadata',
                state: {
                  updateAuthority: OWNER,
                  mint: MINT,
                  name: 'First Artifact',
                  symbol: 'FIRST',
                  uri: `https://solana-firsts.pages.dev/api/token/mainnet/${MINT}`,
                  additionalMetadata: [
                    [METADATA_KEYS.protocol, 'token/2'],
                    [METADATA_KEYS.description, 'A first.'],
                    [METADATA_KEYS.imageHash, 'a'.repeat(64)],
                    [METADATA_KEYS.imageTransactions, SIGNATURE],
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
}

function stubRpc(result: unknown, init: { ok?: boolean; error?: { message: string } } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result, error: init.error }), {
    status: init.ok === false ? 503 : 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('address and signature shapes', () => {
  it('separates 32-byte addresses from 64-byte signatures', () => {
    expect(isAddress(MINT)).toBe(true);
    expect(isAddress(SIGNATURE)).toBe(false);
    expect(isSignature(SIGNATURE)).toBe(true);
    expect(isSignature(MINT)).toBe(false);
    expect(isAddress('not-base58-0OIl')).toBe(false);
  });
});

describe('reading a launched token', () => {
  it('returns the embedded metadata and verified image pointer', async () => {
    stubRpc(mintAccount());
    const token = await readLaunchedToken('https://rpc.example', MINT);
    expect(token).toMatchObject({ mint: MINT, name: 'First Artifact', symbol: 'FIRST', decimals: 6, mintAuthority: null, updateAuthority: OWNER });
    expect(token.image).toEqual({ hash: 'a'.repeat(64), signatures: [SIGNATURE] });
    expect(token.metadata[METADATA_KEYS.description]).toBe('A first.');
  });

  it('ignores an image pointer whose manifest is not signatures', async () => {
    stubRpc(mintAccount({
      extensions: [
        { extension: 'metadataPointer', state: { metadataAddress: MINT } },
        { extension: 'tokenMetadata', state: { mint: MINT, name: 'n', symbol: 's', uri: 'https://example.com', additionalMetadata: [[METADATA_KEYS.imageHash, 'a'.repeat(64)], [METADATA_KEYS.imageTransactions, 'nonsense']] } },
      ],
    }));
    expect((await readLaunchedToken('https://rpc.example', MINT)).image).toBeUndefined();
  });

  it('refuses a mint whose pointer aims somewhere else', async () => {
    stubRpc(mintAccount({
      extensions: [
        { extension: 'metadataPointer', state: { metadataAddress: OWNER } },
        { extension: 'tokenMetadata', state: { mint: MINT, name: 'n', symbol: 's', uri: '', additionalMetadata: [] } },
      ],
    }));
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('does not reference the mint');
  });

  it('explains the common wrong-account cases in plain language', async () => {
    stubRpc({ value: null });
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('No account exists');
    stubRpc(mintAccount({ owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }));
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('not a Token-2022 mint');
    stubRpc(mintAccount({ type: 'account' }));
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('token account, not a mint');
    stubRpc(mintAccount({ extensions: [] }));
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('no embedded token metadata');
    await expect(readLaunchedToken('https://rpc.example', 'nope')).rejects.toThrow('not a valid Solana mint');
  });

  it('surfaces transport and RPC errors instead of returning empty state', async () => {
    stubRpc(null, { ok: false });
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('HTTP 503');
    stubRpc(null, { error: { message: 'rate limited' } });
    await expect(readLaunchedToken('https://rpc.example', MINT)).rejects.toThrow('rate limited');
  });
});
