export type Cluster = 'devnet' | 'mainnet';
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
  devnet: publicRpcEndpoint(import.meta.env.VITE_SOLANA_RPC_DEVNET, DEFAULT_ENDPOINTS.devnet),
  mainnet: publicRpcEndpoint(import.meta.env.VITE_SOLANA_RPC_MAINNET, DEFAULT_ENDPOINTS.mainnet),
});
