import {
  compileTransaction,
  createSolanaRpc,
  getTransactionEncoder,
  getTransactionMessageSize,
  partiallySignTransactionMessageWithSigners,
  type Address,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit';
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
} from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import type { ConnectedWallet } from './wallets';
import type { TransactionMode } from './artifacts';
import { RPC_ENDPOINTS, type Cluster } from './config';
import { buildMemoMessage, type Lifetime } from './messages';
import {
  LEGACY_TRANSACTION_LIMIT,
  V1_TRANSACTION_LIMIT,
  buildLaunchMessage,
  planLaunch,
  type LaunchPlan,
  type LaunchSpec,
} from './launch';

export { DEFAULT_CLUSTER, RPC_ENDPOINTS, type Cluster } from './config';
export { getMemoTransactionSize } from './messages';

const RPC_TIMEOUT_MS = 15_000;
const U64_MAX = 18_446_744_073_709_551_615n;

function chainForCluster(cluster: Cluster): `solana:${Cluster}` {
  return `solana:${cluster}`;
}

function assertAccountSupportsCluster(connected: ConnectedWallet, cluster: Cluster): void {
  const chain = chainForCluster(cluster);
  if (!connected.account.chains.includes(chain)) {
    throw new Error(`${connected.wallet.name} did not expose an account for ${chain}. Reconnect after selecting ${cluster}.`);
  }
}

function getSignAndSendFeature(connected: ConnectedWallet, version: 'legacy' | 1) {
  const feature = (connected.wallet.features as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
  if (!feature) throw new Error(`${connected.wallet.name} cannot sign and send Solana transactions.`);
  if (!feature.supportedTransactionVersions.some(candidate => candidate === version)) {
    throw new Error(`${connected.wallet.name} does not advertise ${version === 1 ? 'v1' : 'legacy'} transaction support.`);
  }
  return feature;
}

export class PublishInterruptedError extends Error {
  readonly signatures: readonly string[];

  constructor(message: string, signatures: readonly string[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'PublishInterruptedError';
    this.signatures = [...signatures];
  }
}

export function parseTokenAmount(supply: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/u.test(supply)) throw new Error('Supply must be a positive number.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) throw new Error('Decimals must be an integer from 0 to 9.');
  const [whole = '0', fraction = ''] = supply.split('.');
  if (fraction.length > decimals) throw new Error(`Supply has more than ${decimals} decimal places.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (amount <= 0n || amount > U64_MAX) throw new Error('Supply is outside the SPL Token u64 range.');
  return amount;
}

export function getRpc(cluster: Cluster): Rpc<SolanaRpcApi> {
  return createSolanaRpc(RPC_ENDPOINTS[cluster]);
}

async function latestLifetime(rpc: Rpc<SolanaRpcApi>): Promise<Lifetime> {
  const { value } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  return value;
}

async function confirmSignature(rpc: Rpc<SolanaRpcApi>, transactionSignature: Signature, lifetime: Lifetime): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const [status] = (await rpc.getSignatureStatuses([transactionSignature], { searchTransactionHistory: true }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) })).value;
    if (status?.err) throw new Error(`Transaction failed onchain: ${JSON.stringify(status.err, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)}.`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    const blockHeight = await rpc.getBlockHeight({ commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    if (blockHeight > lifetime.lastValidBlockHeight) throw new Error('Transaction expired before confirmation. Nothing was charged for it; retry the step.');
    await new Promise(resolve => globalThis.setTimeout(resolve, 750));
  }
  throw new Error('Timed out waiting for confirmation. Check the signature in an explorer before retrying.');
}

async function sendWireTransaction(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  mode: TransactionMode;
  rpc: Rpc<SolanaRpcApi>;
  lifetime: Lifetime;
  transaction: Uint8Array;
}): Promise<string> {
  const limit = input.mode === 'v1' ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
  if (input.transaction.length > limit) throw new Error(`Transaction serializes to ${input.transaction.length} bytes, above the ${limit}-byte ${input.mode} limit.`);
  const feature = getSignAndSendFeature(input.connected, input.mode === 'v1' ? 1 : 'legacy');
  const [result] = await feature.signAndSendTransaction({
    account: input.connected.account,
    chain: chainForCluster(input.cluster),
    transaction: input.transaction,
    options: { commitment: 'confirmed' },
  });
  if (!result) throw new Error('The wallet did not return a transaction signature.');
  const signature = bs58.encode(result.signature);
  await confirmSignature(input.rpc, signature as Signature, input.lifetime);
  return signature;
}

export async function publishMemos(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  mode: TransactionMode;
  memos: readonly Uint8Array[];
  onProgress?: (complete: number, total: number, signature: string) => void;
}): Promise<string[]> {
  getSignAndSendFeature(input.connected, input.mode === 'v1' ? 1 : 'legacy');
  assertAccountSupportsCluster(input.connected, input.cluster);
  const rpc = getRpc(input.cluster);
  const signatures: string[] = [];
  try {
    for (const bytes of input.memos) {
      const lifetime = await latestLifetime(rpc);
      const message = buildMemoMessage(input.mode, input.connected.account.address, lifetime, new TextDecoder().decode(bytes));
      const transaction = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
      const signature = await sendWireTransaction({ ...input, rpc, lifetime, transaction });
      signatures.push(signature);
      input.onProgress?.(signatures.length, input.memos.length, signature);
    }
  } catch (error) {
    if (signatures.length) {
      throw new PublishInterruptedError(`Publishing stopped after ${signatures.length} of ${input.memos.length} transactions. Keep the partial manifest before retrying.`, signatures, { cause: error });
    }
    throw error;
  }
  return signatures;
}

export function explorerUrl(signature: string, cluster: Cluster): string {
  return `https://explorer.solana.com/tx/${signature}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export function explorerAddressUrl(value: string, cluster: Cluster): string {
  return `https://explorer.solana.com/address/${value}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

export async function prepareLaunch(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  mode: TransactionMode;
  spec: Omit<LaunchSpec, 'payer' | 'cluster'>;
}): Promise<LaunchPlan> {
  assertAccountSupportsCluster(input.connected, input.cluster);
  getSignAndSendFeature(input.connected, input.mode === 'v1' ? 1 : 'legacy');
  const rpc = getRpc(input.cluster);
  const payer = input.connected.account.address as Address;
  return planLaunch({ ...input.spec, payer, cluster: input.cluster }, input.mode, bytes =>
    rpc.getMinimumBalanceForRentExemption(BigInt(bytes), { commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) }));
}

// Executes a launch plan from `startAt`, so a launch interrupted after the mint
// exists resumes with the same mint instead of creating a second one.
export async function executeLaunch(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  plan: LaunchPlan;
  startAt?: number;
  onStep?: (complete: number, total: number, signature: string) => void;
}): Promise<string[]> {
  assertAccountSupportsCluster(input.connected, input.cluster);
  const rpc = getRpc(input.cluster);
  const payer = input.connected.account.address as Address;
  const total = input.plan.transactions.length;
  const signatures: string[] = [];
  let step = input.startAt ?? 0;
  try {
    for (; step < total; step += 1) {
      const lifetime = await latestLifetime(rpc);
      const message = buildLaunchMessage({ mode: input.plan.mode, payer, lifetime, instructions: input.plan.transactions[step] });
      const size = getTransactionMessageSize(message);
      const limit = input.plan.mode === 'v1' ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
      if (size > limit) throw new Error(`Launch transaction ${step + 1} is ${size} bytes, above the ${limit}-byte limit.`);
      // The wallet's no-op signer is skipped; only the local mint keypair signs here.
      const compiled = await partiallySignTransactionMessageWithSigners(message);
      const transaction = new Uint8Array(getTransactionEncoder().encode(compiled));
      const signature = await sendWireTransaction({ connected: input.connected, cluster: input.cluster, mode: input.plan.mode, rpc, lifetime, transaction });
      signatures.push(signature);
      input.onStep?.(step + 1, total, signature);
    }
  } catch (error) {
    throw new LaunchInterruptedError(step, signatures, error);
  }
  return signatures;
}

export class LaunchInterruptedError extends Error {
  readonly failedStep: number;
  readonly signatures: readonly string[];

  constructor(failedStep: number, signatures: readonly string[], cause: unknown) {
    const reason = cause instanceof Error ? cause.message : 'The wallet or network rejected the transaction.';
    super(failedStep === 0 && !signatures.length ? reason : `Launch paused at step ${failedStep + 1}: ${reason} Resume to finish with the same mint.`, { cause });
    this.name = 'LaunchInterruptedError';
    this.failedStep = failedStep;
    this.signatures = [...signatures];
  }
}
