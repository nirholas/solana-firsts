import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { getAddMemoInstruction } from '@solana-program/memo';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getInitializeMetadataPointerInstruction,
  getInitializeMint2Instruction,
  getInitializeTokenMetadataInstruction,
  getMintSize,
  getMintToInstruction,
  getSetAuthorityInstruction,
  getUpdateTokenMetadataFieldInstruction,
  getUpdateTokenMetadataUpdateAuthorityInstruction,
  tokenMetadataField,
} from '@solana-program/token-2022';
import {
  appendTransactionMessageInstructions,
  createNoopSigner,
  createTransactionMessage,
  getTransactionMessageSize,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { LAUNCH_PROTOCOL, METADATA_KEYS } from './chain-read';
import { asciiJson, type TransactionMode } from './artifacts';

export const LEGACY_TRANSACTION_LIMIT = 1_232;
export const V1_TRANSACTION_LIMIT = 4_096;
export const MAX_IMAGE_TRANSACTIONS = 8;
export const MAX_DESCRIPTION_CHARACTERS = 280;

// Token-2022 metadata writes reallocate the mint and the associated-token
// program loads large program accounts, so launches budget well above the
// memo-only v1 limits. Values were measured against devnet launches.
export const LAUNCH_V1_CONFIG = {
  computeUnitLimit: 400_000,
  loadedAccountsDataSizeLimit: 8 * 1024 * 1024,
  priorityFeeLamports: 10_000n,
} as const;

export interface LaunchSpec {
  payer: Address;
  mint: TransactionSigner;
  cluster: string;
  name: string;
  symbol: string;
  decimals: number;
  amount: bigint;
  uri: string;
  description?: string;
  links?: { website?: string; x?: string; telegram?: string };
  image?: { hash: string; signatures: readonly string[] };
  lockSupply: boolean;
  lockMetadata: boolean;
}

export interface LaunchPlan {
  mode: TransactionMode;
  mint: Address;
  rentLamports: bigint;
  accountBytes: number;
  transactions: Instruction[][];
}

const PLACEHOLDER_LIFETIME = {
  blockhash: '11111111111111111111111111111111' as Blockhash,
  lastValidBlockHeight: 0n,
};

export function tokenMetadataUri(origin: string, cluster: string, mint: string): string {
  return `${origin.replace(/\/+$/u, '')}/api/token/${cluster}/${mint}`;
}

function normalizeLink(label: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a full https:// URL.`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use https://.`);
  if (url.toString().length > 200) throw new Error(`${label} is limited to 200 characters.`);
  return url.toString();
}

export function launchMetadataPairs(spec: Pick<LaunchSpec, 'description' | 'links' | 'image'>): Array<[string, string]> {
  const pairs: Array<[string, string]> = [[METADATA_KEYS.protocol, LAUNCH_PROTOCOL]];
  const description = spec.description?.trim();
  if (description) {
    if ([...description].length > MAX_DESCRIPTION_CHARACTERS) throw new Error(`Descriptions are limited to ${MAX_DESCRIPTION_CHARACTERS} characters.`);
    pairs.push([METADATA_KEYS.description, description]);
  }
  const website = normalizeLink('Website', spec.links?.website);
  const x = normalizeLink('X link', spec.links?.x);
  const telegram = normalizeLink('Telegram link', spec.links?.telegram);
  if (website) pairs.push([METADATA_KEYS.website, website]);
  if (x) pairs.push([METADATA_KEYS.x, x]);
  if (telegram) pairs.push([METADATA_KEYS.telegram, telegram]);
  if (spec.image) {
    if (!/^[0-9a-f]{64}$/u.test(spec.image.hash)) throw new Error('Image digest must be a SHA-256 hex string.');
    if (!spec.image.signatures.length) throw new Error('Inscribed image has no transaction signatures.');
    if (spec.image.signatures.length > MAX_IMAGE_TRANSACTIONS) {
      throw new Error(`Token artwork is limited to ${MAX_IMAGE_TRANSACTIONS} inscription transactions. Choose a smaller size.`);
    }
    pairs.push([METADATA_KEYS.imageHash, spec.image.hash]);
    pairs.push([METADATA_KEYS.imageTransactions, spec.image.signatures.join(' ')]);
  }
  return pairs;
}

export function validateLaunchText(name: string, symbol: string): { name: string; symbol: string } {
  const cleanName = name.trim();
  const cleanSymbol = symbol.trim().toUpperCase();
  if (!cleanName) throw new Error('Token name is required.');
  if ([...cleanName].length > 32) throw new Error('Token name is limited to 32 characters.');
  if (!/^[A-Z0-9]{1,10}$/u.test(cleanSymbol)) throw new Error('Ticker must be 1 to 10 letters or digits.');
  return { name: cleanName, symbol: cleanSymbol };
}

export function launchAccountExtensions(spec: LaunchSpec) {
  return {
    pointer: extension('MetadataPointer', {
      authority: spec.lockMetadata ? null : spec.payer,
      metadataAddress: spec.mint.address,
    }),
    metadata: extension('TokenMetadata', {
      updateAuthority: spec.payer,
      mint: spec.mint.address,
      name: spec.name,
      symbol: spec.symbol,
      uri: spec.uri,
      additionalMetadata: new Map(launchMetadataPairs(spec)),
    }),
  };
}

export function launchAccountBytes(spec: LaunchSpec): { allocated: number; funded: number } {
  const { pointer, metadata } = launchAccountExtensions(spec);
  return { allocated: getMintSize([pointer]), funded: getMintSize([pointer, metadata]) };
}

// Ordered groups of instructions that must land in the same transaction.
export async function buildLaunchGroups(spec: LaunchSpec, rentLamports: bigint): Promise<Instruction[][]> {
  const { name, symbol } = validateLaunchText(spec.name, spec.symbol);
  if (!Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 9) throw new Error('Decimals must be an integer from 0 to 9.');
  if (spec.amount <= 0n) throw new Error('Initial supply must be greater than zero.');
  if (spec.uri.length > 200) throw new Error('Metadata URI is too long.');
  const payer = createNoopSigner(spec.payer);
  const mint = spec.mint.address;
  const { allocated } = launchAccountBytes(spec);
  const [ata] = await findAssociatedTokenPda({ owner: spec.payer, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });

  const create: Instruction[] = [
    getCreateAccountInstruction({ payer, newAccount: spec.mint, lamports: rentLamports, space: allocated, programAddress: TOKEN_2022_PROGRAM_ADDRESS }),
    getInitializeMetadataPointerInstruction({ mint, authority: spec.lockMetadata ? null : spec.payer, metadataAddress: mint }),
    getInitializeMint2Instruction({ mint, decimals: spec.decimals, mintAuthority: spec.payer, freezeAuthority: null }),
    getInitializeTokenMetadataInstruction({ metadata: mint, updateAuthority: spec.payer, mint, mintAuthority: payer, name, symbol, uri: spec.uri }),
    getAddMemoInstruction({ memo: asciiJson({ p: `firsts/${LAUNCH_PROTOCOL}`, mint, cluster: spec.cluster }) }),
  ];
  const fields = launchMetadataPairs(spec).map(([key, value]) => [
    getUpdateTokenMetadataFieldInstruction({ metadata: mint, updateAuthority: payer, field: tokenMetadataField('Key', [key]), value }),
  ]);
  const supply: Instruction[] = [
    getCreateAssociatedTokenInstruction({ payer, ata, owner: spec.payer, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
    getMintToInstruction({ mint, token: ata, mintAuthority: payer, amount: spec.amount }),
  ];
  const groups = [create, ...fields, supply];
  if (spec.lockSupply) {
    groups.push([getSetAuthorityInstruction({ owned: mint, owner: payer, authorityType: AuthorityType.MintTokens, newAuthority: null })]);
  }
  if (spec.lockMetadata) {
    groups.push([getUpdateTokenMetadataUpdateAuthorityInstruction({ metadata: mint, updateAuthority: payer, newUpdateAuthority: null })]);
  }
  return groups;
}

export function buildLaunchMessage(input: {
  mode: TransactionMode;
  payer: Address;
  lifetime: { blockhash: Blockhash; lastValidBlockHeight: bigint };
  instructions: readonly Instruction[];
}) {
  if (input.mode === 'v1') {
    return pipe(
      createTransactionMessage({ version: 1 }),
      message => setTransactionMessageFeePayer(input.payer, message),
      message => setTransactionMessageLifetimeUsingBlockhash(input.lifetime, message),
      message => appendTransactionMessageInstructions(input.instructions, message),
      message => setTransactionMessageConfig(LAUNCH_V1_CONFIG, message),
    );
  }
  // Legacy has no transactionConfig, so the budget the v1 path declares inline is
  // requested with an instruction instead. Token-2022 metadata writes realloc the
  // mint account and comfortably exceed the 200,000-unit default.
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(input.payer, message),
    message => setTransactionMessageLifetimeUsingBlockhash(input.lifetime, message),
    message => appendTransactionMessageInstructions([
      getSetComputeUnitLimitInstruction({ units: LAUNCH_V1_CONFIG.computeUnitLimit }),
      ...input.instructions,
    ], message),
  );
}

export function measureLaunchTransaction(mode: TransactionMode, payer: Address, instructions: readonly Instruction[]): number {
  return getTransactionMessageSize(buildLaunchMessage({ mode, payer, lifetime: PLACEHOLDER_LIFETIME, instructions }));
}

// Greedily packs ordered atomic groups into the fewest transactions that fit
// the wire limit for the chosen mode, never splitting or reordering a group.
export function packLaunchGroups(mode: TransactionMode, payer: Address, groups: readonly Instruction[][]): Instruction[][] {
  const limit = mode === 'v1' ? V1_TRANSACTION_LIMIT : LEGACY_TRANSACTION_LIMIT;
  const transactions: Instruction[][] = [];
  let current: Instruction[] = [];
  for (const [index, group] of groups.entries()) {
    const alone = measureLaunchTransaction(mode, payer, group);
    if (alone > limit) {
      throw new Error(`Launch step ${index + 1} needs ${alone} bytes, above the ${limit}-byte ${mode} limit. Shorten the description or links, or use a v1 wallet.`);
    }
    if (current.length && measureLaunchTransaction(mode, payer, [...current, ...group]) <= limit) {
      current = [...current, ...group];
    } else {
      if (current.length) transactions.push(current);
      current = [...group];
    }
  }
  if (current.length) transactions.push(current);
  return transactions;
}

export async function planLaunch(spec: LaunchSpec, mode: TransactionMode, getRent: (bytes: number) => Promise<bigint>): Promise<LaunchPlan> {
  const { funded } = launchAccountBytes(spec);
  const rentLamports = await getRent(funded);
  const groups = await buildLaunchGroups(spec, rentLamports);
  return {
    mode,
    mint: spec.mint.address,
    rentLamports,
    accountBytes: funded,
    transactions: packLaunchGroups(mode, spec.payer, groups),
  };
}
