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
} from '@solana/kit';
import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
} from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import type { ConnectedWallet } from './wallets';
import type { TransactionMode } from './artifacts';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
} from '@solana-program/token';

export type Cluster = 'devnet' | 'mainnet';

export const RPC_ENDPOINTS: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

const V1_CONFIG = {
  computeUnitLimit: 20_000,
  loadedAccountsDataSizeLimit: 32 * 1024,
  priorityFeeLamports: 5_000n,
} as const;

type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

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

export async function publishMemos(input: {
  connected: ConnectedWallet;
  cluster: Cluster;
  mode: TransactionMode;
  memos: readonly Uint8Array[];
  onProgress?: (complete: number, total: number) => void;
}): Promise<string[]> {
  const feature = (input.connected.wallet.features as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
  if (!feature) throw new Error(`${input.connected.wallet.name} cannot sign and send Solana transactions.`);
  const rpc = createSolanaRpc(RPC_ENDPOINTS[input.cluster]);
  const signatures: string[] = [];
  for (const [index, bytes] of input.memos.entries()) {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
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
      chain: input.cluster === 'mainnet' ? 'solana:mainnet' : 'solana:devnet',
      transaction,
      options: { commitment: 'confirmed' },
    });
    signatures.push(bs58.encode(result.signature));
    input.onProgress?.(index + 1, input.memos.length);
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
  const feature = (input.connected.wallet.features as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
  if (!feature) throw new Error(`${input.connected.wallet.name} cannot sign and send Solana transactions.`);
  if (!/^\d+(?:\.\d+)?$/u.test(input.supply)) throw new Error('Supply must be a positive number.');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) throw new Error('Decimals must be an integer from 0 to 9.');
  if (!input.name.trim() || !input.symbol.trim()) throw new Error('Token name and symbol are required.');
  const [whole = '0', fraction = ''] = input.supply.split('.');
  if (fraction.length > input.decimals) throw new Error(`Supply has more than ${input.decimals} decimal places.`);
  const rawSupply = BigInt(whole) * 10n ** BigInt(input.decimals) + BigInt(fraction.padEnd(input.decimals, '0') || '0');
  if (rawSupply <= 0n || rawSupply > 18_446_744_073_709_551_615n) throw new Error('Supply is outside the SPL Token u64 range.');

  const rpc = createSolanaRpc(RPC_ENDPOINTS[input.cluster]);
  const payerAddress = address(input.connected.account.address);
  const payer = createNoopSigner(payerAddress);
  const mint = await generateKeyPairSigner();
  const mintSize = getMintSize();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(mintSize), { commitment: 'confirmed' }).send();
  const [ata] = await findAssociatedTokenPda({ owner: payerAddress, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const memo = JSON.stringify({
    p: 'firsts/token/1',
    name: input.name,
    symbol: input.symbol,
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
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    value => setTransactionMessageFeePayer(payerAddress, value),
    value => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, value),
    value => appendTransactionMessageInstructions(instructions, value),
  );
  const partial = await partiallySignTransactionMessageWithSigners(message);
  const transaction = new Uint8Array(getTransactionEncoder().encode(partial));
  const [result] = await feature.signAndSendTransaction({
    account: input.connected.account,
    chain: input.cluster === 'mainnet' ? 'solana:mainnet' : 'solana:devnet',
    transaction,
    options: { commitment: 'confirmed' },
  });
  return { mint: mint.address, signature: bs58.encode(result.signature) };
}
