import { addMonths, formatMonth } from './dates';
import type { BuiltinCategory, Category, Cents, Necessity, Transaction } from './types';

const UNNECESSARY_BY_DEFAULT: BuiltinCategory[] = ['eating-out', 'entertainment', 'other'];

/** A spending category's necessary/unnecessary setting, with defaults for built-ins. */
export function categoryNecessity(c: Pick<Category, 'necessity' | 'builtin'>): Necessity {
  if (c.necessity) return c.necessity;
  return c.builtin && UNNECESSARY_BY_DEFAULT.includes(c.builtin) ? 'unnecessary' : 'necessary';
}

export type PeriodKind = 'month' | 'quarter' | 'half' | 'year';

export interface Period {
  kind: PeriodKind;
  /** First month, "YYYY-MM" */
  start: string;
  /** Last month, "YYYY-MM" */
  end: string;
  label: string;
}

const LENGTH: Record<PeriodKind, number> = { month: 1, quarter: 3, half: 6, year: 12 };
// Fixed abbreviations: Intl's en-AU short months vary between runtimes ("Jun"/"June", "Sep"/"Sept").
const ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar month / quarter / half-year / year that contains `month`. */
export function periodContaining(month: string, kind: PeriodKind): Period {
  const [y, m] = month.split('-').map(Number);
  const len = LENGTH[kind];
  const firstMonth = Math.floor((m - 1) / len) * len + 1;
  const start = `${y}-${String(firstMonth).padStart(2, '0')}`;
  const end = addMonths(start, len - 1);
  let label: string;
  if (kind === 'month') label = formatMonth(start, true);
  else if (kind === 'year') label = String(y);
  else {
    const prefix = kind === 'quarter' ? `Q${(firstMonth - 1) / 3 + 1}` : `H${firstMonth === 1 ? 1 : 2}`;
    label = `${prefix} ${y} (${ABBR[firstMonth - 1]}–${ABBR[firstMonth + len - 2]} ${y})`;
  }
  return { kind, start, end, label };
}

/** The period before (-1) or after (+1). */
export function shiftPeriod(p: Period, by: number): Period {
  return periodContaining(addMonths(p.start, by * LENGTH[p.kind]), p.kind);
}

/** First and last ISO dates of a period, for filtering transactions. */
export function periodDates(p: Period): { from: string; to: string } {
  const [y, m] = p.end.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${p.start}-01`, to: `${p.end}-${String(last).padStart(2, '0')}` };
}

export type OutgoingGroup = Necessity | 'unsorted';

export interface OutgoingSlice {
  group: OutgoingGroup;
  /** null = uncategorised */
  categoryId: string | null;
  name: string;
  amount: Cents;
}

export interface Outgoings {
  total: Cents;
  groups: { group: OutgoingGroup; amount: Cents; slices: OutgoingSlice[] }[];
}

export const GROUP_ORDER: OutgoingGroup[] = ['necessary', 'unnecessary', 'unsorted'];
export const GROUP_LABEL: Record<OutgoingGroup, string> = {
  necessary: 'Necessary',
  unnecessary: 'Unnecessary',
  unsorted: 'Not sorted yet',
};

/**
 * Spending in a date range, split into necessary / unnecessary / not sorted
 * yet, and by category within each. Counts the same money as the rest of the
 * dashboard: spending categories (net of refunds) plus uncategorised debits;
 * income and transfers are left out. A transaction's own override beats its
 * category's setting; uncategorised debits without an override are "not
 * sorted yet".
 */
export function summariseOutgoings(
  txs: Transaction[],
  categories: Category[],
  from: string,
  to: string,
): Outgoings {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sums = new Map<string, OutgoingSlice>();
  for (const t of txs) {
    if (t.date < from || t.date > to) continue;
    const cat = t.categoryId ? byId.get(t.categoryId) : undefined;
    if (cat && cat.kind !== 'expense') continue;
    if (!cat && t.amount >= 0) continue; // uncategorised credits are income
    const group: OutgoingGroup = t.necessity ?? (cat ? categoryNecessity(cat) : 'unsorted');
    const key = `${group}|${cat?.id ?? ''}`;
    const slice = sums.get(key) ?? { group, categoryId: cat?.id ?? null, name: cat?.name ?? 'Uncategorised', amount: 0 };
    slice.amount -= t.amount;
    sums.set(key, slice);
  }
  const groups = GROUP_ORDER.map((group) => {
    const slices = [...sums.values()]
      .filter((s) => s.group === group && s.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    return { group, amount: slices.reduce((n, s) => n + s.amount, 0), slices };
  }).filter((g) => g.amount > 0);
  return { total: groups.reduce((n, g) => n + g.amount, 0), groups };
}
