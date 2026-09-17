import { readArtifactFrom } from '../../../src/lib/chain-read';
import { HttpError, SANDBOX_HEADERS, cached, errorResponse, parseCluster, rpcFor, type Env } from '../../_lib/http';

type Context = { request: Request; env: Env; params: Record<string, string | string[]>; waitUntil(promise: Promise<unknown>): void };

const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|svg\+xml)|text\/plain|application\/json|audio\/|video\/)/u;

// GET /api/artifact/:cluster?tx=<sig>,<sig>  streams a verified firsts/1 artifact.
// A manifest names exact transactions, so a successful read is immutable.
export async function onRequestGet(context: Context): Promise<Response> {
  return cached(context.request, context, async () => {
    try {
      const cluster = parseCluster(context.params.cluster);
      const tx = new URL(context.request.url).searchParams.get('tx') ?? '';
      const signatures = tx.split(/[\s,]+/u).filter(Boolean);
      if (!signatures.length) throw new HttpError(400, 'Pass the artifact transaction signatures as ?tx=sig1,sig2.');
      if (signatures.length > 100) throw new HttpError(413, 'The resolver reads at most 100 transactions per artifact.');
      const artifact = await readArtifactFrom(rpcFor(context.env, cluster), signatures, cluster);
      const inline = INLINE_TYPES.test(artifact.mime);
      const filename = artifact.name.replace(/[^\w.-]+/gu, '_').slice(0, 120) || 'artifact';
      return new Response(artifact.bytes, {
        headers: {
          ...SANDBOX_HEADERS,
          'access-control-allow-origin': '*',
          'x-content-type-options': 'nosniff',
          // HTML and unknown types download instead of rendering on this origin.
          'content-type': inline ? artifact.mime : 'application/octet-stream',
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
          'content-length': String(artifact.bytes.length),
          etag: `"${artifact.hash}"`,
          'x-firsts-sha256': artifact.hash,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
