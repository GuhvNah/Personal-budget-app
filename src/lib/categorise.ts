import type { Category, Rule } from './types';

/** "Transfer to xx1111 CommBank app" -> "1111" */
export function transferSuffix(description: string): string | null {
  const m = /\btransfer\s+(?:to|from)\s+xx(\d{4})\b/i.exec(description);
  return m ? m[1] : null;
}

/** All distinct xxNNNN account suffixes mentioned in the descriptions. */
export function mentionedSuffixes(descriptions: string[]): string[] {
  const set = new Set<string>();
  for (const d of descriptions) {
    const s = transferSuffix(d);
    if (s) set.add(s);
  }
  return [...set].sort();
}

export function ruleMatches(rule: Rule, description: string): boolean {
  const p = rule.pattern.trim().toLowerCase();
  return p !== '' && description.toLowerCase().includes(p);
}

/**
 * Pick a category for a description.
 * 1. Your rules come first (longest/most specific pattern wins), so a rule
 *    like "xx1234" -> Rent/Mortgage beats the transfer detection below.
 * 2. Transfers to/from your own accounts go to the Transfers category.
 * 3. Otherwise uncategorised (null).
 */
export function categorise(
  description: string,
  rules: Rule[],
  categories: Category[],
  ownSuffixes: string[],
): string | null {
  const known = new Set(categories.map((c) => c.id));
  const match = rules
    .filter((r) => known.has(r.categoryId) && ruleMatches(r, description))
    .sort((a, b) => b.pattern.trim().length - a.pattern.trim().length)[0];
  if (match) return match.categoryId;

  const suffix = transferSuffix(description);
  if (suffix && ownSuffixes.includes(suffix)) {
    const transfers = categories.find((c) => c.kind === 'transfer');
    if (transfers) return transfers.id;
  }
  return null;
}

/**
 * Suggest a rule pattern from a description: drop the leading bank wording
 * and trailing reference numbers, keep the merchant-ish part.
 * "Direct Debit 123456 BUDGET DIRECT" -> "BUDGET DIRECT"
 */
export function suggestPattern(description: string): string {
  let s = description.replace(/\s+/g, ' ').trim();
  s = s.replace(
    /^(direct debit|direct credit|fast transfer from|fast transfer to|card xx\d{4}|eftpos|visa purchase|debit card purchase)\s+/i,
    '',
  );
  s = s.replace(/^\d{4,}\s+/, '');
  const xx = /\bxx\d{4}\b/i.exec(s);
  if (xx) return xx[0];
  s = s.replace(/\s+(value date:.*|aus card.*|au\b.*|\d[\d\s]{5,}.*)$/i, '');
  return s.split(' ').slice(0, 4).join(' ');
}
