export type Cluster = 'devnet' | 'mainnet';
export const CLUSTERS: readonly Cluster[] = ['mainnet', 'devnet'];

// Vite substitutes the literal import.meta.env token at build time; Node scripts
// and the edge resolver have no such object, so they fall back to defaults.
const env: Partial<Record<string, string>> = typeof import.meta.env === 'undefined' ? {} : import.meta.env;
export const DEFAULT_CLUSTER: Cluster = 'mainnet';

const DEFAULT_ENDPOINTS: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://solana-rpc.publicnode.com',
};

function publicRpcEndpoint(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Solana RPC endpoints must use HTTPS except on localhost.');
  }
  if (url.username || url.password) throw new Error('Do not place RPC credentials in a public VITE_ environment variable.');
  return url.toString();
}

export const RPC_ENDPOINTS: Readonly<Record<Cluster, string>> = Object.freeze({
  devnet: publicRpcEndpoint(env.VITE_SOLANA_RPC_DEVNET, DEFAULT_ENDPOINTS.devnet),
  mainnet: publicRpcEndpoint(env.VITE_SOLANA_RPC_MAINNET, DEFAULT_ENDPOINTS.mainnet),
});

// Launched tokens bake this origin into their permanent metadata URI, so it must
// be the canonical production host even when the studio runs on localhost.
export const METADATA_ORIGIN = new URL(env.VITE_METADATA_ORIGIN ?? 'https://solana-firsts.pages.dev').origin;

// Shareable path for a launched coin. The Cloudflare Pages function at the same
// path rewrites the social card tags before the SPA renders this route.
export function tokenPagePath(cluster: Cluster, mint: string): string {
  return `/t/${cluster}/${mint}`;
}
