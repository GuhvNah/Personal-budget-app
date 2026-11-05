import { categorise } from './categorise';
import { dedupeKeys } from './dedupe';
import type { AllData } from './db';
import { newId } from './id';
import type { Account, Transaction } from './types';
import type { ParsedAccount, ParsedTransaction } from '../parsers/types';

export interface ReviewRow extends ParsedTransaction {
  rowId: string;
  accountId: string;
  categoryId: string | null;
  dedupeKey: string;
  /** Already saved, or repeated earlier in this same import. */
  duplicate: boolean;
  /** User removed the line on the review screen. */
  removed: boolean;
  source: 'pdf' | 'csv';
}

export interface ReviewBatch {
  fileName: string;
  /** Account to save to. For a new account `newAccount` is set and created on save. */
  accountId: string;
  newAccount?: Account;
  warnings: string[];
  rows: ReviewRow[];
}

export function accountIdFor(acc: ParsedAccount): string | null {
  return acc.number ? `${acc.bsb ? acc.bsb + '-' : ''}${acc.number}` : null;
}

export function defaultAccountName(acc: ParsedAccount, bank: string): string {
  const last4 = acc.number?.slice(-4) ?? '????';
  return `${acc.type ?? bank} ••${last4}`;
}

/**
 * Turn parsed transactions into review rows: work out dedupe keys, mark
 * duplicates (against the database and earlier rows in the same import) and
 * auto-categorise.
 */
export function buildRows(
  parsed: ParsedTransaction[],
  accountId: string,
  source: 'pdf' | 'csv',
  data: Pick<AllData, 'rules' | 'categories' | 'settings'>,
  existingKeys: Set<string>,
  seenInImport: Set<string>,
): ReviewRow[] {
  const keys = dedupeKeys(accountId, parsed);
  return parsed.map((p, i) => {
    const duplicate = existingKeys.has(keys[i]) || seenInImport.has(keys[i]);
    seenInImport.add(keys[i]);
    return {
      ...p,
      warnings: [...p.warnings],
      rowId: newId(),
      accountId,
      categoryId: categorise(p.description, data.rules, data.categories, data.settings.ownAccountSuffixes),
      dedupeKey: keys[i],
      duplicate,
      removed: false,
      source,
    };
  });
}

/** The transactions that will actually be saved from a set of batches. */
export function rowsToSave(batches: ReviewBatch[]): Transaction[] {
  const now = Date.now();
  return batches.flatMap((b) =>
    b.rows
      .filter((r) => !r.duplicate && !r.removed)
      .map((r, i) => ({
        id: newId(),
        accountId: b.accountId,
        date: r.date,
        description: r.description,
        reference: r.reference,
        amount: r.amount,
        balance: r.balance,
        categoryId: r.categoryId,
        dedupeKey: r.dedupeKey,
        source: r.source,
        createdAt: now + i,
      })),
  );
}
