import { addMonths, monthOf } from './dates';
import { summariseMonth } from './stats';
import { merchantKeys } from './suggest';
import type { Account, Category, Cents, Goal, ISODate, Transaction } from './types';

const DAY = 86_400_000;
const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/* ---------- Budget pace ---------- */

export interface Pace {
  /** Budget minus spending (negative when over). */
  left: Cents;
  /** Days left in the month, including today. */
  daysLeft: number;
  /** What you can spend per remaining day and still land on budget. */
  perDay: Cents;
  /**
   * over = past the budget; ahead = spending faster than the month is
   * passing (only for categories with several purchases – a single bill paid
   * early in the month isn't a sign of overspending).
   */
  status: 'on-track' | 'ahead' | 'over';
}

/**
 * How a category is tracking against its budget part-way through the
 * current month. Null for other months or when there's no budget.
 */
export function budgetPace(spent: Cents, budget: Cents, month: string, today: ISODate, purchases = Infinity): Pace | null {
  if (budget <= 0 || monthOf(today) !== month) return null;
  const day = Number(today.slice(8, 10));
  const total = daysInMonth(month);
  const daysLeft = total - day + 1;
  const left = budget - spent;
  const expected = (budget * day) / total;
  const fast = purchases >= 3 && spent > expected * 1.1 && spent - expected > 500;
  const status = spent > budget ? 'over' : fast ? 'ahead' : 'on-track';
  return { left, daysLeft, perDay: left > 0 ? Math.floor(left / daysLeft) : 0, status };
}

/* ---------- Recurring payments ---------- */

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';

const FREQ: { name: Frequency; min: number; max: number; days: number; perMonth: number }[] = [
  { name: 'weekly', min: 5, max: 9, days: 7, perMonth: 52 / 12 },
  { name: 'fortnightly', min: 12, max: 16, days: 14, perMonth: 26 / 12 },
  { name: 'monthly', min: 26, max: 35, days: 30, perMonth: 1 },
  { name: 'quarterly', min: 80, max: 100, days: 91, perMonth: 1 / 3 },
  { name: 'yearly', min: 350, max: 380, days: 365, perMonth: 1 / 12 },
];

export interface Recurring {
  key: string;
  /** Most recent description. */
  name: string;
  categoryId: string | null;
  frequency: Frequency;
  /** Latest amount, positive cents. */
  amount: Cents;
  /** Set when the amount changed recently: what it was before. */
  previousAmount?: Cents;
  /** First date at the current amount (when it changed). */
  changedOn?: ISODate;
  lastDate: ISODate;
  nextDate: ISODate;
  count: number;
  /** Cost averaged per month. */
  monthly: Cents;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Find regular payments: the same merchant, at least 3 times, at a steady
 * interval and a steady amount (so weekly grocery shops of varying size
 * don't count). Payments that have stopped are left out.
 */
export function findRecurring(txs: Transaction[], categories: Category[], today: ISODate): Recurring[] {
  const kind = new Map(categories.map((c) => [c.id, c.kind]));
  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const k = t.categoryId ? kind.get(t.categoryId) : 'expense';
    if (k !== 'expense') continue;
    const key = merchantKeys(t.description)?.key;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: Recurring[] = [];
  for (const [key, list] of groups) {
    const med = median(list.map((t) => -t.amount));
    // One entry per date: the payment closest to the usual amount.
    const byDate = new Map<ISODate, Transaction>();
    for (const t of list) {
      const cur = byDate.get(t.date);
      if (!cur || Math.abs(-t.amount - med) < Math.abs(-cur.amount - med)) byDate.set(t.date, t);
    }
    const occ = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (occ.length < 3) continue;

    const gaps = occ.slice(1).map((t, i) => daysBetween(occ[i].date, t.date));
    const f = FREQ.find((x) => median(gaps) >= x.min && median(gaps) <= x.max);
    if (!f) continue;
    if (gaps.filter((g) => g >= f.min && g <= f.max).length / gaps.length < 0.7) continue;
    if (occ.filter((t) => Math.abs(-t.amount - med) <= med * 0.2).length / occ.length < 0.7) continue;

    const last = occ[occ.length - 1];
    if (daysBetween(last.date, today) > f.days * 1.5) continue; // stopped
    const amount = -last.amount;

    // Did the amount change within the last few payments?
    let previousAmount: Cents | undefined;
    let changedOn: ISODate | undefined;
    for (let i = occ.length - 2; i >= Math.max(0, occ.length - 5); i--) {
      const a = -occ[i].amount;
      if (Math.abs(a - amount) > amount * 0.01) {
        previousAmount = a;
        changedOn = occ[i + 1].date;
        break;
      }
    }

    let nextDate: ISODate;
    if (f.name === 'monthly' || f.name === 'quarterly' || f.name === 'yearly') {
      const months = f.name === 'monthly' ? 1 : f.name === 'quarterly' ? 3 : 12;
      const m = addMonths(monthOf(last.date), months);
      const day = Math.min(Number(last.date.slice(8, 10)), daysInMonth(m));
      nextDate = `${m}-${String(day).padStart(2, '0')}`;
    } else nextDate = addDays(last.date, f.days);

    out.push({
      key,
      name: last.description,
      categoryId: last.categoryId,
      frequency: f.name,
      amount,
      previousAmount,
      changedOn,
      lastDate: last.date,
      nextDate,
      count: occ.length,
      monthly: Math.round(amount * f.perMonth),
    });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/* ---------- Account balances ---------- */

export interface BalancePoint {
  date: ISODate;
  balance: Cents;
}

/**
 * End-of-day balance for each day an account has statement transactions,
 * oldest first. Within a day, the closing balance is the one that no other
 * transaction that day starts from (works whichever way round the statement
 * was listed).
 */
export function balanceSeries(txs: Transaction[], accountId: string): BalancePoint[] {
  const byDate = new Map<ISODate, Transaction[]>();
  for (const t of txs) {
    if (t.accountId !== accountId || t.balance === undefined) continue;
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }
  const out: BalancePoint[] = [];
  for (const [date, list] of byDate) {
    const starts = new Set(list.map((t) => (t.balance as number) - t.amount));
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
    const closing = sorted.find((t) => !starts.has(t.balance as number)) ?? sorted[0];
    out.push({ date, balance: closing.balance as number });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface AccountBalance {
  account: Account;
  balance: Cents;
  asOf: ISODate;
}

/** Latest known balance of each account that has statement balances. */
export function accountBalances(txs: Transaction[], accounts: Account[]): AccountBalance[] {
  return accounts.flatMap((account) => {
    const s = balanceSeries(txs, account.id);
    const last = s[s.length - 1];
    return last ? [{ account, balance: last.balance, asOf: last.date }] : [];
  });
}

/* ---------- Savings goals ---------- */

export interface GoalProgress {
  goal: Goal;
  /** Latest balance of the linked account, if known. */
  balance: Cents | null;
  asOf: ISODate | null;
  /** 0–1 */
  fraction: number;
  remaining: Cents;
  /** With a target date: how much to add per month from now to get there. */
  perMonth: Cents | null;
  reached: boolean;
}

export function goalProgress(goal: Goal, balances: AccountBalance[], today: ISODate): GoalProgress {
  const b = balances.find((x) => x.account.id === goal.accountId);
  const balance = b ? b.balance : null;
  const remaining = Math.max(0, goal.target - (balance ?? 0));
  let perMonth: Cents | null = null;
  if (goal.targetDate && remaining > 0 && goal.targetDate > today) {
    const months = Math.max(1, daysBetween(today, goal.targetDate) / 30.44);
    perMonth = Math.ceil(remaining / months);
  }
  return {
    goal,
    balance,
    asOf: b?.asOf ?? null,
    fraction: balance === null || goal.target <= 0 ? 0 : Math.min(1, Math.max(0, balance / goal.target)),
    remaining,
    perMonth,
    reached: balance !== null && balance >= goal.target,
  };
}

/* ---------- Trends ---------- */

export interface Trend {
  /** null = uncategorised */
  category: Category | null;
  current: Cents;
  previous: Cents;
  /** Average of up to `avgMonths` months before this one (only months you have data for). */
  average: Cents;
}

/** Spending per category for a month, against the month before and the recent average. */
export function categoryTrends(txs: Transaction[], categories: Category[], month: string, avgMonths = 6): Trend[] {
  const first = txs.reduce((m, t) => (monthOf(t.date) < m ? monthOf(t.date) : m), month);
  const cur = summariseMonth(month, txs, categories).byCategory;
  const prev = summariseMonth(addMonths(month, -1), txs, categories).byCategory;
  const earlier: Map<string, Cents>[] = [];
  for (let i = 1; i <= avgMonths; i++) {
    const m = addMonths(month, -i);
    if (m < first) break;
    earlier.push(summariseMonth(m, txs, categories).byCategory);
  }
  const ids = new Set<string>([...cur.keys(), ...prev.keys(), ...earlier.flatMap((e) => [...e.keys()])]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  return [...ids]
    .map((id) => ({
      category: id ? (byId.get(id) ?? null) : null,
      current: cur.get(id) ?? 0,
      previous: prev.get(id) ?? 0,
      average: earlier.length ? Math.round(earlier.reduce((s, e) => s + (e.get(id) ?? 0), 0) / earlier.length) : 0,
    }))
    .filter((t) => t.current || t.previous || t.average)
    .sort((a, b) => b.current - a.current || b.average - a.average);
}
