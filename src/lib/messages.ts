import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { getAddMemoInstruction } from '@solana-program/memo';
import {
  address,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getTransactionMessageSize,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { memoComputeUnitLimit, type TransactionMode } from './artifacts';

export type Lifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

export const MEMO_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 256 * 1024;
export const MEMO_PRIORITY_FEE_LAMPORTS = 5_000n;

// The Memo program charges per byte, so the compute limit is sized from the memo
// itself. A fixed limit either starves a full chunk or overpays for a short one.
export function buildMemoMessage(mode: TransactionMode, payer: string, lifetime: Lifetime, memo: string) {
  const computeUnitLimit = memoComputeUnitLimit(new TextEncoder().encode(memo));
  if (mode === 'v1') {
    return pipe(
      createTransactionMessage({ version: 1 }),
      message => setTransactionMessageFeePayer(address(payer), message),
      message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
      message => appendTransactionMessageInstruction(getAddMemoInstruction({ memo }), message),
      message => setTransactionMessageConfig({
        computeUnitLimit,
        loadedAccountsDataSizeLimit: MEMO_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
        priorityFeeLamports: MEMO_PRIORITY_FEE_LAMPORTS,
      }, message),
    );
  }
  // Legacy transactions carry no transactionConfig, so the same budget has to be
  // requested with an instruction. The 200,000-unit default covers about 560 bytes.
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    message => setTransactionMessageFeePayer(address(payer), message),
    message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    message => appendTransactionMessageInstructions([
      getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
      getAddMemoInstruction({ memo }),
    ], message),
  );
}

export function getMemoTransactionSize(input: { mode: TransactionMode; payer: string; lifetime: Lifetime; memo: string }): number {
  return getTransactionMessageSize(buildMemoMessage(input.mode, input.payer, input.lifetime, input.memo));
}
