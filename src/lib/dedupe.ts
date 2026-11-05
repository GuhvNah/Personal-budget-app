import type { Cents, ISODate } from './types';

export function normaliseDescription(d: string): string {
  return d.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface KeyInput {
  date: ISODate;
  amount: Cents;
  balance?: Cents;
  description: string;
}

/**
 * Build duplicate-detection keys for a batch of transactions from one account.
 *
 * With a running balance, account+date+amount+balance identifies a
 * transaction exactly, even when two identical payments happen on the same
 * day (their balances differ) and even if the description text changes
 * slightly between PDF and CSV exports.
 *
 * Without a balance we fall back to account+date+amount+description plus an
 * occurrence counter, so two genuine identical payments on the same day in one
 * file are both kept, and re-importing the same file skips both.
 */
export function dedupeKeys(accountId: string, txs: KeyInput[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    if (t.balance !== undefined) return `${accountId}|${t.date}|${t.amount}|b${t.balance}`;
    const base = `${accountId}|${t.date}|${t.amount}|${normaliseDescription(t.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}
