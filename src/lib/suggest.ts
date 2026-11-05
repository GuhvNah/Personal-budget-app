import { ruleMatches, transferSuffix } from './categorise';
import { matchMerchant } from './merchants';
import type { BuiltinCategory, Category, CategorySource, Rule, Transaction } from './types';

/**
 * A category guess for a transaction.
 * - confident = true: obvious enough to apply automatically.
 * - confident = false: shown as "Suggested: X" for you to approve or change.
 */
export interface Suggestion {
  categoryId: string;
  confident: boolean;
  /** Short explanation shown in the UI, e.g. "Rule: ALDI" or "Like 3 past transactions". */
  reason: string;
  /** What the category's source becomes if this is applied automatically. */
  source: Exclude<CategorySource, 'user'>;
}

/** Built-in category key -> the name it had originally (fallback for older data). */
export const BUILTIN_NAMES: Record<BuiltinCategory, string> = {
  groceries: 'Groceries',
  rent: 'Rent/Mortgage',
  fuel: 'Fuel',
  bills: 'Bills',
  insurance: 'Insurance',
  'eating-out': 'Eating Out',
  entertainment: 'Entertainment',
  childcare: 'Childcare',
  other: 'Other',
  income: 'Income',
  transfers: 'Transfers',
};

export function findBuiltin(categories: Category[], key: BuiltinCategory): Category | undefined {
  return (
    categories.find((c) => c.builtin === key) ??
    categories.find((c) => !c.builtin && c.name.toLowerCase() === BUILTIN_NAMES[key].toLowerCase())
  );
}

// Bank wording that says nothing about the merchant.
const PREFIXES =
  /^(direct debit|direct credit|fast transfer (?:from|to)|transfer (?:from|to)|card xx\d{4}|visa (?:debit )?purchase|eftpos (?:purchase )?|debit card purchase|osko payment|payment to|payment from|bpay)\s+/i;
const NOISE = new Set(['COMMBANK', 'APP', 'NETBANK', 'AUS', 'AU', 'AUSTRALIA', 'PTY', 'LTD', 'THE', 'VALUE', 'DATE', 'CARD', 'PURCHASE']);

/**
 * Reduce a description to a merchant key for learning, e.g.
 * "Direct Debit 123456 BUDGET DIRECT" -> "BUDGET DIRECT",
 * "WOOLWORTHS 4021 PERTH AU" -> "WOOLWORTHS PERTH",
 * "Transfer to xx1111 CommBank app" -> "XX1111".
 * Returns [key of up to two words, first word] or null if nothing useful is left.
 */
export function merchantKeys(description: string): { key: string; first: string } | null {
  let s = description.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3 && PREFIXES.test(s); i++) s = s.replace(PREFIXES, '');
  const words = s
    .toUpperCase()
    .split(/[\s*/,.#:-]+/)
    .filter((w) => w && !NOISE.has(w) && (/^XX\d{4}$/.test(w) || !/\d/.test(w)) && w.length > 1);
  if (words.length === 0) return null;
  return { key: words.slice(0, 2).join(' '), first: words[0] };
}

interface Tally {
  counts: Map<string, number>;
  total: number;
}

/** What you've categorised before, indexed by merchant key. Build once, reuse. */
export interface History {
  byKey: Map<string, Tally>;
  byFirst: Map<string, Tally>;
}

function add(map: Map<string, Tally>, key: string, categoryId: string) {
  let t = map.get(key);
  if (!t) map.set(key, (t = { counts: new Map(), total: 0 }));
  t.counts.set(categoryId, (t.counts.get(categoryId) ?? 0) + 1);
  t.total++;
}

/**
 * Learn from transactions whose category you chose or approved. Ones the app
 * auto-categorised are left out, so a wrong guess can't reinforce itself.
 */
export function buildHistory(transactions: Pick<Transaction, 'description' | 'categoryId' | 'categorySource'>[]): History {
  const h: History = { byKey: new Map(), byFirst: new Map() };
  for (const t of transactions) {
    if (!t.categoryId || t.categorySource === 'auto') continue;
    const k = merchantKeys(t.description);
    if (!k) continue;
    add(h.byKey, k.key, t.categoryId);
    add(h.byFirst, k.first, t.categoryId);
  }
  return h;
}

function top(t: Tally | undefined): { categoryId: string; count: number; share: number } | null {
  if (!t) return null;
  let best: [string, number] | null = null;
  for (const e of t.counts) if (!best || e[1] > best[1]) best = e;
  return best && { categoryId: best[0], count: best[1], share: best[1] / t.total };
}

export interface SuggestContext {
  rules: Rule[];
  categories: Category[];
  ownSuffixes: string[];
  history: History;
}

/**
 * Work out the most likely category for a transaction. In order:
 * 1. your rules (longest match wins) – applied automatically
 * 2. transfers to/from your own accounts – applied automatically
 * 3. how you categorised the same merchant before
 * 4. the built-in merchant list
 * Returns null when there's nothing to go on.
 */
export function suggestCategory(description: string, amount: number, ctx: SuggestContext): Suggestion | null {
  const live = new Map(ctx.categories.map((c) => [c.id, c]));

  const rule = ctx.rules
    .filter((r) => live.has(r.categoryId) && ruleMatches(r, description))
    .sort((a, b) => b.pattern.trim().length - a.pattern.trim().length)[0];
  if (rule) return { categoryId: rule.categoryId, confident: true, reason: `Rule: “${rule.pattern}”`, source: 'rule' };

  const suffix = transferSuffix(description);
  if (suffix && ctx.ownSuffixes.includes(suffix)) {
    const t = ctx.categories.find((c) => c.kind === 'transfer');
    if (t) return { categoryId: t.id, confident: true, reason: `Transfer with your account xx${suffix}`, source: 'transfer' };
  }

  const keys = merchantKeys(description);
  const exact = keys ? top(ctx.history.byKey.get(keys.key)) : null;
  const plural = (n: number) => `${n} past transaction${n === 1 ? '' : 's'}`;
  let weak: Suggestion | null = null;

  if (exact && live.has(exact.categoryId)) {
    const s: Suggestion = {
      categoryId: exact.categoryId,
      confident: exact.count >= 2 && exact.share >= 0.75,
      reason: `Like ${plural(exact.count)}`,
      source: 'auto',
    };
    if (s.confident) return s;
    weak = s;
  }

  const m = matchMerchant(description, amount);
  const builtin = m && findBuiltin(ctx.categories, m.category);
  if (m && builtin) {
    const s: Suggestion = { categoryId: builtin.id, confident: m.strong, reason: `Looks like ${m.keyword}`, source: 'auto' };
    // Your own history beats a weak keyword guess.
    if (s.confident) return s;
    weak ??= s;
  }
  if (weak) return weak;

  const loose = keys ? top(ctx.history.byFirst.get(keys.first)) : null;
  if (loose && live.has(loose.categoryId) && loose.count >= 2 && loose.share >= 0.75) {
    return { categoryId: loose.categoryId, confident: false, reason: `Similar to ${plural(loose.count)}`, source: 'auto' };
  }
  return null;
}
