// Funds-free verification: builds the real inscription and launch transactions
// and asks devnet to simulate them. Nothing is signed by a funded key and
// nothing is sent, so this is safe to run anywhere, including CI.
//
//   npm run smoke:simulate
//
// Simulation needs a fee payer that already holds SOL, so it borrows a live
// validator identity address. That account is only read; it never signs.
import { readFile } from 'node:fs/promises';
import {
  compileTransaction,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  type Address,
  type Blockhash,
} from '@solana/kit';
import { planArtifact, V1_MEMO_BUDGET, LEGACY_MEMO_BUDGET, type TransactionMode } from '../src/lib/artifacts';
import { LEGACY_TRANSACTION_LIMIT, V1_TRANSACTION_LIMIT, buildLaunchMessage, planLaunch, tokenMetadataUri } from '../src/lib/launch';
import { buildMemoMessage, type Lifetime } from '../src/lib/messages';

const endpoint = process.env.SIMULATE_RPC ?? 'https://api.devnet.solana.com';
const origin = process.env.SIMULATE_METADATA_ORIGIN ?? 'https://solana-firsts.pages.dev';
let failures = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(`${method}: ${payload.error.message ?? 'RPC error'}`);
  return payload.result as T;
}

// Any account with a balance works; simulation never verifies its signature.
// Validator identities are used because they are always funded and the public
// RPC rate-limits getBlock, which was the other way to find a live account.
async function borrowFeePayer(): Promise<Address> {
  const { current } = await rpc<{ current: Array<{ nodePubkey: string }> }>('getVoteAccounts', [{ commitment: 'confirmed' }]);
  for (const validator of current.slice(0, 25)) {
    const { value } = await rpc<{ value: number }>('getBalance', [validator.nodePubkey, { commitment: 'confirmed' }]);
    if (value > 100_000_000) return validator.nodePubkey as Address;
  }
  throw new Error('No funded account was available to simulate against.');
}

type AnyMessage = Parameters<typeof partiallySignTransactionMessageWithSigners>[0];

async function simulate(label: string, message: AnyMessage, limit: number, sign: boolean): Promise<void> {
  const transaction = sign ? await partiallySignTransactionMessageWithSigners(message) : compileTransaction(message);
  const wire = getBase64EncodedWireTransaction(transaction as Parameters<typeof getBase64EncodedWireTransaction>[0]);
  const size = Buffer.from(wire, 'base64').length;
  const { value } = await rpc<{ value: { err: unknown; unitsConsumed?: number; logs?: string[] } }>('simulateTransaction', [
    wire,
    { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', encoding: 'base64' },
  ]);
  const withinLimit = size <= limit;
  const ok = !value.err && withinLimit;
  if (!ok) failures += 1;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}: ${size}/${limit} bytes, ${(value.unitsConsumed ?? 0).toLocaleString('en-US')} CU`);
  if (value.err) console.log(`      ${JSON.stringify(value.err)}\n      ${(value.logs ?? []).slice(-4).join('\n      ')}`);
}

async function run(mode: TransactionMode, payer: Address, lifetime: Lifetime): Promise<void> {
  const limit = mode === 'v1' ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
  console.log(`\n${mode}`);

  const icon = await readFile(new URL('../public/favicon.svg', import.meta.url));
  const art = await planArtifact({ bytes: new Uint8Array(icon), kind: 'image', name: 'favicon.svg', mime: 'image/svg+xml', mode });
  await simulate(`artwork chunk 1 of ${art.encodedChunks.length}`, buildMemoMessage(mode, payer, lifetime, new TextDecoder().decode(art.encodedChunks[0])), limit, false);

  // A payload sized to fill one chunk exactly: the case a fixed compute budget breaks.
  const budget = mode === 'v1' ? V1_MEMO_BUDGET : LEGACY_MEMO_BUDGET;
  const full = await planArtifact({ bytes: new Uint8Array(Math.floor(budget * 0.7)).fill(0x41), kind: 'file', name: 'full.bin', mime: 'application/octet-stream', mode });
  await simulate('full-size chunk', buildMemoMessage(mode, payer, lifetime, new TextDecoder().decode(full.encodedChunks[0])), limit, false);

  const mint = await generateKeyPairSigner();
  const plan = await planLaunch({
    payer,
    mint,
    cluster: 'devnet',
    name: 'Simulated First',
    symbol: 'SIM',
    decimals: 6,
    amount: 1_000_000_000_000_000n,
    uri: tokenMetadataUri(origin, 'devnet', mint.address),
    description: 'A simulated launch used to verify transaction sizing and compute budgets.',
    links: { website: origin, x: 'https://x.com/solana', telegram: 'https://t.me/solana' },
    image: { hash: art.hash, signatures: ['4'.repeat(87)] },
    lockSupply: true,
    lockMetadata: true,
  }, mode, async bytes => BigInt(await rpc<number>('getMinimumBalanceForRentExemption', [bytes, { commitment: 'confirmed' }])));
  console.log(`      launch plan: ${plan.transactions.length} transaction(s), ${plan.accountBytes} account bytes, ${plan.rentLamports} lamports rent`);
  // Only the first transaction can simulate in isolation: the rest read the mint
  // that this one creates, and simulation never commits that state.
  await simulate(`launch transaction 1 of ${plan.transactions.length}`, buildLaunchMessage({ mode, payer, lifetime, instructions: plan.transactions[0] }), limit, true);
}

const payer = await borrowFeePayer();
console.log(`simulating on ${endpoint} with funded fee payer ${payer}`);
const { value } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
const lifetime: Lifetime = { blockhash: value.blockhash as Blockhash, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) };
for (const mode of (process.env.SIMULATE_MODES ?? 'v1,legacy').split(',') as TransactionMode[]) await run(mode, payer, lifetime);
if (failures) {
  console.error(`\n${failures} simulation(s) failed.`);
  process.exit(1);
}
console.log('\nall simulations passed');
