import { getAddMemoInstruction } from '@solana-program/memo';
import {
  address,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionEncoder,
  getTransactionMessageSize,
  pipe,
  generateKeyPairSigner,
  partiallySignTransactionMessageWithSigners,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
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
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
} from '@solana-program/token';

export { DEFAULT_CLUSTER, RPC_ENDPOINTS, type Cluster } from './config';

const V1_CONFIG = {
  computeUnitLimit: 20_000,
  loadedAccountsDataSizeLimit: 256 * 1024,
  priorityFeeLamports: 5_000n,
} as const;

const RPC_TIMEOUT_MS = 15_000;
const U64_MAX = 18_446_744_073_709_551_615n;

type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

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

async function confirmSignature(
  rpc: Rpc<SolanaRpcApi>,
  transactionSignature: Signature,
  lifetime: Lifetime,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const [status] = (await rpc.getSignatureStatuses([transactionSignature], { searchTransactionHistory: true }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) })).value;
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}.`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    const blockHeight = await rpc.getBlockHeight({ commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    if (blockHeight > lifetime.lastValidBlockHeight) throw new Error('Transaction expired before confirmation.');
    await new Promise(resolve => globalThis.setTimeout(resolve, 750));
  }
  throw new Error('Timed out waiting for transaction confirmation. Check the signature before retrying.');
}

function buildLegacyMessage(payer: string, lifetime: Lifetime, memo: string) {
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(address(payer), message),
    message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    message => appendTransactionMessageInstruction(getAddMemoInstruction({ memo }), message),
  );
}

function buildV1Message(payer: string, lifetime: Lifetime, memo: string) {
  return pipe(
    createTransactionMessage({ version: 1 }),
    message => setTransactionMessageFeePayer(address(payer), message),
    message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    message => appendTransactionMessageInstruction(getAddMemoInstruction({ memo }), message),
    message => setTransactionMessageConfig(V1_CONFIG, message),
  );
}

export function getMemoTransactionSize(input: { mode: TransactionMode; payer: string; lifetime: Lifetime; memo: string }): number {
  const message = input.mode === 'v1'
    ? buildV1Message(input.payer, input.lifetime, input.memo)
    : buildLegacyMessage(input.payer, input.lifetime, input.memo);
  return getTransactionMessageSize(message);
}

export async function publishMemos(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  mode: TransactionMode;
  memos: readonly Uint8Array[];
  onProgress?: (complete: number, total: number, signature: string) => void;
}): Promise<string[]> {
  const feature = getSignAndSendFeature(input.connected, input.mode === 'v1' ? 1 : 'legacy');
  assertAccountSupportsCluster(input.connected, input.cluster);
  const rpc = createSolanaRpc(RPC_ENDPOINTS[input.cluster]);
  const signatures: string[] = [];
  try {
    for (const [index, bytes] of input.memos.entries()) {
      const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
      const memo = new TextDecoder().decode(bytes);
      const message = input.mode === 'v1'
        ? buildV1Message(input.connected.account.address, latestBlockhash, memo)
        : buildLegacyMessage(input.connected.account.address, latestBlockhash, memo);
      const size = getTransactionMessageSize(message);
      const limit = input.mode === 'v1' ? 4_096 : 1_232;
      if (size > limit) throw new Error(`Chunk ${index + 1} serializes to ${size} bytes, above the ${limit}-byte limit.`);
      const transaction = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
      const [result] = await feature.signAndSendTransaction({
        account: input.connected.account,
        chain: chainForCluster(input.cluster),
        transaction,
        options: { commitment: 'confirmed' },
      });
      if (!result) throw new Error('The wallet did not return a transaction signature.');
      const signatureText = bs58.encode(result.signature);
      signatures.push(signatureText);
      await confirmSignature(rpc, signatureText as Signature, latestBlockhash);
      input.onProgress?.(index + 1, input.memos.length, signatureText);
    }
  } catch (error) {
    if (signatures.length) {
      throw new PublishInterruptedError(`Publishing stopped after ${signatures.length} of ${input.memos.length} transactions. Preserve the partial manifest before retrying.`, signatures, { cause: error });
    }
    throw error;
  }
  return signatures;
}

export function explorerUrl(signature: string, cluster: Cluster): string {
  const suffix = cluster === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export async function createToken(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  artifact?: { id: string; hash: string };
}): Promise<{ mint: string; signature: string }> {
  const feature = getSignAndSendFeature(input.connected, 'legacy');
  assertAccountSupportsCluster(input.connected, input.cluster);
  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase();
  if (!name || !symbol) throw new Error('Token name and symbol are required.');
  if ([...name].length > 32) throw new Error('Token name is limited to 32 characters.');
  if (!/^[A-Z0-9]{1,10}$/u.test(symbol)) throw new Error('Token symbol must contain 1–10 letters or digits.');
  const rawSupply = parseTokenAmount(input.supply, input.decimals);

  const rpc = createSolanaRpc(RPC_ENDPOINTS[input.cluster]);
  const payerAddress = address(input.connected.account.address);
  const payer = createNoopSigner(payerAddress);
  const mint = await generateKeyPairSigner();
  const mintSize = getMintSize();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(mintSize), { commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  const [ata] = await findAssociatedTokenPda({ owner: payerAddress, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const memo = JSON.stringify({
    p: 'firsts/token/1',
    name,
    symbol,
    mint: mint.address,
    artifact: input.artifact,
  });
  const instructions = [
    getCreateAccountInstruction({ payer, newAccount: mint, lamports: rent, space: mintSize, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: input.decimals, mintAuthority: payerAddress, freezeAuthority: null }),
    getCreateAssociatedTokenInstruction({ payer, ata, owner: payerAddress, mint: mint.address }),
    getMintToInstruction({ mint: mint.address, token: ata, mintAuthority: payer, amount: rawSupply }),
    getAddMemoInstruction({ memo }),
  ];
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    value => setTransactionMessageFeePayer(payerAddress, value),
    value => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, value),
    value => appendTransactionMessageInstructions(instructions, value),
  );
  const partial = await partiallySignTransactionMessageWithSigners(message);
  const transaction = new Uint8Array(getTransactionEncoder().encode(partial));
  if (transaction.length > 1_232) throw new Error(`Token creation serializes to ${transaction.length} bytes, above the 1,232-byte legacy limit.`);
  const [result] = await feature.signAndSendTransaction({
    account: input.connected.account,
    chain: chainForCluster(input.cluster),
    transaction,
    options: { commitment: 'confirmed' },
  });
  if (!result) throw new Error('The wallet did not return a transaction signature.');
  const signatureText = bs58.encode(result.signature);
  await confirmSignature(rpc, signatureText as Signature, latestBlockhash);
  return { mint: mint.address, signature: signatureText };
}
