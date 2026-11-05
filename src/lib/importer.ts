import { dedupeKeys } from './dedupe';
import type { AllData } from './db';
import { newId } from './id';
import { sameMerchant, suggestCategory, type History, type Suggestion } from './suggest';
import type { Account, CategorySource, Transaction } from './types';
import type { ParsedAccount, ParsedTransaction } from '../parsers/types';

export interface ReviewRow extends ParsedTransaction {
  rowId: string;
  accountId: string;
  categoryId: string | null;
  /** How categoryId was set; undefined while uncategorised. */
  categorySource?: CategorySource;
  /** The app's best guess (kept for confident ones too, to show the reason). */
  suggestion: Suggestion | null;
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
 * categorise: confident guesses are applied, others are left as suggestions.
 */
export function buildRows(
  parsed: ParsedTransaction[],
  accountId: string,
  source: 'pdf' | 'csv',
  data: Pick<AllData, 'rules' | 'categories' | 'settings'> & { history: History },
  existingKeys: Set<string>,
  seenInImport: Set<string>,
): ReviewRow[] {
  const keys = dedupeKeys(accountId, parsed);
  return parsed.map((p, i) => {
    const duplicate = existingKeys.has(keys[i]) || seenInImport.has(keys[i]);
    seenInImport.add(keys[i]);
    const suggestion = suggestCategory(p.description, p.amount, {
      rules: data.rules,
      categories: data.categories,
      ownSuffixes: data.settings.ownAccountSuffixes,
      history: data.history,
    });
    return {
      ...p,
      warnings: [...p.warnings],
      rowId: newId(),
      accountId,
      categoryId: suggestion?.confident ? suggestion.categoryId : null,
      categorySource: suggestion?.confident ? suggestion.source : undefined,
      suggestion,
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
        categorySource: r.categoryId ? (r.categorySource ?? 'approved') : undefined,
        dedupeKey: r.dedupeKey,
        source: r.source,
        createdAt: now + i,
      })),
  );
}

/**
 * After you approve or choose a category for one row, give the same category
 * to the other pending rows from the same merchant (not ones already
 * categorised, removed or duplicates). Returns the new batches and how many
 * rows changed.
 */
export function applyToSimilar(
  batches: ReviewBatch[],
  source: ReviewRow,
  categoryId: string,
): { batches: ReviewBatch[]; count: number } {
  let count = 0;
  const next = batches.map((b) => ({
    ...b,
    rows: b.rows.map((r) => {
      if (r.rowId === source.rowId || r.categoryId !== null || r.duplicate || r.removed) return r;
      if (!sameMerchant(r.description, source.description)) return r;
      count++;
      return {
        ...r,
        categoryId,
        categorySource: 'auto' as const,
        suggestion: { categoryId, confident: true, reason: 'Same as one you approved', source: 'auto' as const },
      };
    }),
  }));
  return { batches: next, count };
}
