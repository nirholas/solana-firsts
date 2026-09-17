// Funded devnet round trip for the full launch path: inscribe token artwork,
// launch a Token-2022 mint with embedded metadata in v1 and legacy modes, then
// read every byte back through the same readers the studio and resolver use.
//
//   SMOKE_KEYPAIR=~/devnet.json npm run smoke:devnet
//
// SMOKE_KEYPAIR is a JSON secret-key array for a devnet-only throwaway key. When
// omitted, a fresh key is generated and funded from the devnet faucet.
import { readFile } from 'node:fs/promises';
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionEncoder,
  lamports,
  partiallySignTransactionMessageWithSigners,
  signTransaction,
  type Address,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { planArtifact, type TransactionMode } from '../src/lib/artifacts';
import { readArtifactFrom, readLaunchedToken, readTokenImage } from '../src/lib/chain-read';
import { buildLaunchMessage, planLaunch, tokenMetadataUri } from '../src/lib/launch';
import { buildMemoMessage } from '../src/lib/messages';

const endpoint = process.env.SMOKE_RPC ?? 'https://api.devnet.solana.com';
const origin = process.env.SMOKE_METADATA_ORIGIN ?? 'https://solana-firsts.pages.dev';
const rpc = createSolanaRpc(endpoint);

async function loadPayer(): Promise<KeyPairSigner> {
  if (process.env.SMOKE_KEYPAIR) {
    const bytes = JSON.parse(await readFile(process.env.SMOKE_KEYPAIR.replace(/^~/u, process.env.HOME ?? ''), 'utf8')) as number[];
    return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
  }
  const signer = await generateKeyPairSigner();
  console.log(`funding throwaway payer ${signer.address} from the devnet faucet`);
  await rpc.requestAirdrop(signer.address, lamports(1_000_000_000n)).send();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { value } = await rpc.getBalance(signer.address, { commitment: 'confirmed' }).send();
    if (value > 0n) return signer;
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  throw new Error('Devnet faucet did not fund the payer. Retry later or pass SMOKE_KEYPAIR.');
}

async function confirm(signature: Signature): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const [status] = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value;
    if (status?.err) throw new Error(`${signature} failed: ${JSON.stringify(status.err, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error(`${signature} was not confirmed in time.`);
}

async function send(message: Parameters<typeof partiallySignTransactionMessageWithSigners>[0], payer: KeyPairSigner, label: string): Promise<string> {
  const partial = await partiallySignTransactionMessageWithSigners(message);
  const signed = await signTransaction([payer.keyPair], partial);
  const bytes = getTransactionEncoder().encode(signed).length;
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  await confirm(signature);
  console.log(`  ${label}: ${bytes} bytes  ${signature}`);
  return signature;
}

async function roundTrip(payer: KeyPairSigner, mode: TransactionMode): Promise<void> {
  console.log(`\n${mode} launch`);
  const image = await readFile(new URL('../public/favicon.svg', import.meta.url));
  const art = await planArtifact({ bytes: new Uint8Array(image), kind: 'image', name: 'smoke.svg', mime: 'image/svg+xml', mode });
  const imageSignatures: string[] = [];
  for (const [index, chunk] of art.encodedChunks.entries()) {
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const message = buildMemoMessage(mode, payer.address, lifetime, new TextDecoder().decode(chunk));
    imageSignatures.push(await send(message, payer, `art ${index + 1}/${art.encodedChunks.length}`));
  }
  const recoveredArt = await readArtifactFrom(endpoint, imageSignatures, 'devnet');
  if (recoveredArt.hash !== art.hash) throw new Error('artwork digest mismatch');

  const mint = await generateKeyPairSigner();
  const plan = await planLaunch({
    payer: payer.address as Address,
    mint,
    cluster: 'devnet',
    name: `Firsts Smoke ${mode}`,
    symbol: 'SMOKE',
    decimals: 6,
    amount: 1_000_000_000_000n,
    uri: tokenMetadataUri(origin, 'devnet', mint.address),
    description: 'Automated devnet round trip for the Firsts launch path.',
    links: { website: origin },
    image: { hash: art.hash, signatures: imageSignatures },
    lockSupply: true,
    lockMetadata: true,
  }, mode, async bytes => rpc.getMinimumBalanceForRentExemption(BigInt(bytes)).send());
  console.log(`  mint ${mint.address}: ${plan.accountBytes} account bytes, ${plan.rentLamports} lamports rent, ${plan.transactions.length} transaction(s)`);
  for (const [index, instructions] of plan.transactions.entries()) {
    const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    await send(buildLaunchMessage({ mode, payer: payer.address as Address, lifetime, instructions }), payer, `launch ${index + 1}/${plan.transactions.length}`);
  }

  const token = await readLaunchedToken(endpoint, mint.address);
  if (token.symbol !== 'SMOKE' || token.mintAuthority !== null || token.updateAuthority !== null) {
    throw new Error(`unexpected token state ${JSON.stringify(token)}`);
  }
  const verified = await readTokenImage(endpoint, token, 'devnet');
  console.log(`  verified ${token.name} supply=${token.supply} image=${verified.mime} ${verified.bytes.length}B sha256=${verified.hash.slice(0, 12)}`);
  console.log(`  metadata uri ${token.uri}`);
}

const payer = await loadPayer();
const modes = (process.env.SMOKE_MODES ?? 'v1,legacy').split(',') as TransactionMode[];
for (const mode of modes) await roundTrip(payer, mode);
console.log('\ndevnet smoke passed');
