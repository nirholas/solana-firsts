import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';

const registry = getWallets();

export type ConnectedWallet = { wallet: Wallet; account: WalletAccount };

export function getSolanaWallets(): readonly Wallet[] {
  return registry.get().filter(wallet => wallet.chains.some(chain => chain.startsWith('solana:')));
}

export function subscribeWallets(listener: () => void): () => void {
  const unregister = registry.on('register', listener);
  const remove = registry.on('unregister', listener);
  return () => { unregister(); remove(); };
}

export function supportedVersions(wallet: Wallet): ReadonlySet<string> {
  const versions = new Set<string>();
  const send = (wallet.features as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
  const sign = (wallet.features as SolanaSignTransactionFeature)[SolanaSignTransaction];
  for (const version of send?.supportedTransactionVersions ?? []) versions.add(String(version));
  for (const version of sign?.supportedTransactionVersions ?? []) versions.add(String(version));
  return versions;
}

export function supportsV1(wallet?: Wallet): boolean {
  return wallet ? supportedVersions(wallet).has('1') : false;
}

export async function connectWallet(wallet: Wallet): Promise<ConnectedWallet> {
  const feature = wallet.features['standard:connect'] as
    | { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> }
    | undefined;
  if (!feature) throw new Error(`${wallet.name} does not expose Wallet Standard connect.`);
  const result = await feature.connect();
  const account = result.accounts.find(entry => entry.chains.some(chain => chain.startsWith('solana:')));
  if (!account) throw new Error(`${wallet.name} did not return a Solana account.`);
  return { wallet, account };
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
