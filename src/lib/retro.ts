import { ruleMatches } from './categorise';
import { merchantKeys, sameMerchant } from './suggest';
import type { CategorySource } from './types';

/** Which existing transactions a decision should reach: same merchant, or a rule's text. */
export type MatchBy = { merchantOf: string } | { pattern: string };

export function matches(description: string, by: MatchBy): boolean {
  return 'pattern' in by
    ? ruleMatches({ pattern: by.pattern } as never, description)
    : sameMerchant(description, by.merchantOf);
}

/** Can this description be matched to others by merchant at all? */
export function hasMerchant(description: string): boolean {
  return merchantKeys(description) !== null;
}

interface Categorised {
  description: string;
  categoryId: string | null;
  categorySource?: CategorySource;
}

/**
 * Categorised (or deliberately left uncategorised) by you. Transactions saved
 * before categorySource existed count as yours too.
 */
export function isManual(t: Categorised): boolean {
  return t.categorySource === 'user' || (t.categorySource === undefined && t.categoryId !== null);
}

/**
 * Plan a retroactive change: which matching transactions would move to
 * `categoryId`. Ones already in that category are ignored; ones you
 * categorised yourself are counted as skipped and left alone.
 */
export function planRetro<T extends Categorised>(
  items: T[],
  by: MatchBy,
  categoryId: string,
  exclude: (t: T) => boolean = () => false,
): { change: T[]; skipped: number } {
  const change: T[] = [];
  let skipped = 0;
  for (const t of items) {
    if (exclude(t) || t.categoryId === categoryId || !matches(t.description, by)) continue;
    if (isManual(t)) skipped++;
    else change.push(t);
  }
  return { change, skipped };
}

/** The category source to record for a retroactive change. */
export function retroSource(by: MatchBy): CategorySource {
  return 'pattern' in by ? 'rule' : 'auto';
}
