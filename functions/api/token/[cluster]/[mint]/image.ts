import { readTokenImage } from '../../../../../src/lib/chain-read';
import { IMAGE_TYPES, SANDBOX_HEADERS, cacheControlFor, cached, errorResponse, loadToken, parseCluster, rpcFor, type Env } from '../../../../_lib/http';

type Context = { request: Request; env: Env; params: Record<string, string | string[]>; waitUntil(promise: Promise<unknown>): void };

// Rebuilds token artwork from its inscription transactions and serves it only
// after the SHA-256 matches the digest written into the mint account.
export async function onRequestGet(context: Context): Promise<Response> {
  return cached(context.request, context, async () => {
    try {
      const cluster = parseCluster(context.params.cluster);
      const token = await loadToken(context.env, cluster, String(context.params.mint));
      const artifact = await readTokenImage(rpcFor(context.env, cluster), token, cluster);
      const type = IMAGE_TYPES.has(artifact.mime) ? artifact.mime : 'application/octet-stream';
      return new Response(artifact.bytes, {
        headers: {
          ...SANDBOX_HEADERS,
          'access-control-allow-origin': '*',
          'x-content-type-options': 'nosniff',
          'content-type': type,
          'content-length': String(artifact.bytes.length),
          etag: `"${artifact.hash}"`,
          'x-firsts-sha256': artifact.hash,
          // Artwork bytes are content-addressed; only the pointer can change.
          'cache-control': token.updateAuthority === null ? 'public, max-age=31536000, immutable' : cacheControlFor(token),
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
