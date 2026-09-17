import { METADATA_KEYS } from '../../../../src/lib/chain-read';
import { cacheControlFor, cached, errorResponse, json, loadToken, parseCluster, publicOrigin, type Env } from '../../../_lib/http';

type Context = { request: Request; env: Env; params: Record<string, string | string[]>; waitUntil(promise: Promise<unknown>): void };

// Metaplex-style off-chain JSON, generated entirely from onchain state so wallets
// and explorers that only understand a metadata URI can render the token.
export async function onRequestGet(context: Context): Promise<Response> {
  return cached(context.request, context, async () => {
    try {
      const cluster = parseCluster(context.params.cluster);
      const token = await loadToken(context.env, cluster, String(context.params.mint));
      const origin = publicOrigin(context.request);
      const base = `${origin}/api/token/${cluster}/${token.mint}`;
      const image = token.image ? `${base}/image` : undefined;
      const extensions = Object.fromEntries(Object.entries({
        website: token.metadata[METADATA_KEYS.website],
        twitter: token.metadata[METADATA_KEYS.x],
        telegram: token.metadata[METADATA_KEYS.telegram],
      }).filter(([, value]) => value));
      return json({
        name: token.name,
        symbol: token.symbol,
        description: token.metadata[METADATA_KEYS.description] ?? '',
        image,
        external_url: `${origin}/t/${cluster}/${token.mint}`,
        extensions,
        properties: {
          category: 'image',
          files: image ? [{ uri: image, type: 'image' }] : [],
        },
        attributes: [
          { trait_type: 'Supply locked', value: token.mintAuthority === null ? 'yes' : 'no' },
          { trait_type: 'Metadata locked', value: token.updateAuthority === null ? 'yes' : 'no' },
          { trait_type: 'Artwork', value: token.image ? 'Inscribed onchain' : 'None' },
        ],
        firsts: {
          protocol: token.metadata[METADATA_KEYS.protocol] ?? null,
          cluster,
          mint: token.mint,
          decimals: token.decimals,
          supply: token.supply,
          mint_authority: token.mintAuthority,
          freeze_authority: token.freezeAuthority,
          update_authority: token.updateAuthority,
          image_sha256: token.image?.hash ?? null,
          image_transactions: token.image?.signatures ?? [],
        },
      }, { cache: cacheControlFor(token) });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
