import { readLaunchedToken, type LaunchedToken } from '../../src/lib/chain-read';

export interface Env {
  ASSETS: { fetch(request: Request | string): Promise<Response> };
  SOLANA_RPC_MAINNET?: string;
  SOLANA_RPC_DEVNET?: string;
}

export type Cluster = 'mainnet' | 'devnet';

const PUBLIC_RPC: Record<Cluster, string> = {
  mainnet: 'https://solana-rpc.publicnode.com',
  devnet: 'https://api.devnet.solana.com',
};

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseCluster(value: unknown): Cluster {
  if (value === 'mainnet' || value === 'devnet') return value;
  throw new HttpError(400, 'Cluster must be mainnet or devnet.');
}

export function rpcFor(env: Env, cluster: Cluster): string {
  return (cluster === 'mainnet' ? env.SOLANA_RPC_MAINNET : env.SOLANA_RPC_DEVNET) || PUBLIC_RPC[cluster];
}

const BASE_HEADERS = {
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

// Immutable once nobody can rewrite the metadata; otherwise short-lived so an
// owner's metadata edits propagate to wallets and explorers.
export function cacheControlFor(token: LaunchedToken): string {
  return token.updateAuthority === null
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300, stale-while-revalidate=3600';
}

export function json(body: unknown, init: { status?: number; cache?: string } = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': init.cache ?? 'no-store' },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : 'Unexpected resolver failure.';
  // Chain-state answers (no account, wrong program) are the caller's problem;
  // transport failures are ours and must not be cached.
  const notFound = /No account exists|not a Token-2022|no embedded token metadata|token account, not a mint|not a valid Solana|no inscribed image|was not found on/u.test(message);
  const invalid = /does not reference the mint|names a different mint|does not match|incomplete|verification failed|valid Solana transaction signature|contains no valid Firsts/u.test(message);
  return json({ error: message }, { status: notFound ? 404 : invalid ? 422 : 502 });
}

export async function cached(request: Request, context: { waitUntil(promise: Promise<unknown>): void }, produce: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  if (cache && request.method === 'GET') {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const response = await produce();
  if (cache && response.ok && request.method === 'GET' && response.headers.get('cache-control')?.includes('max-age')) {
    context.waitUntil(cache.put(key, response.clone()));
  }
  return response;
}

export async function loadToken(env: Env, cluster: Cluster, mint: string): Promise<LaunchedToken> {
  return readLaunchedToken(rpcFor(env, cluster), mint.replace(/\.json$/u, ''));
}

export function publicOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);

// Inscribed bytes are attacker-controlled. Served content can never run script,
// load subresources, or be framed as part of this origin.
export const SANDBOX_HEADERS = {
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'cross-origin',
};
