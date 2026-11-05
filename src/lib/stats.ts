import { addMonths, monthOf } from './dates';
import type { Budget, Category, Cents, Transaction } from './types';

export interface MonthSummary {
  month: string;
  income: Cents;
  spending: Cents;
  /** Net spending per category id (refunds reduce it). Key "" = uncategorised. */
  byCategory: Map<string, Cents>;
}

/**
 * How each transaction counts:
 * - Transfer categories: ignored entirely.
 * - Income categories: income.
 * - Expense categories: spending (net – a refund in that category reduces it).
 * - Uncategorised: debits are spending, credits are income.
 */
export function summariseMonth(
  month: string,
  txs: Transaction[],
  categories: Category[],
): MonthSummary {
  const kind = new Map(categories.map((c) => [c.id, c.kind]));
  const out: MonthSummary = { month, income: 0, spending: 0, byCategory: new Map() };
  for (const t of txs) {
    if (monthOf(t.date) !== month) continue;
    const k = t.categoryId ? kind.get(t.categoryId) : undefined;
    if (k === 'transfer') continue;
    if (k === 'income') {
      out.income += t.amount;
    } else if (k === 'expense') {
      out.spending -= t.amount;
      out.byCategory.set(t.categoryId!, (out.byCategory.get(t.categoryId!) ?? 0) - t.amount);
    } else if (t.amount < 0) {
      out.spending -= t.amount;
      out.byCategory.set('', (out.byCategory.get('') ?? 0) - t.amount);
    } else {
      out.income += t.amount;
    }
  }
  return out;
}

export function recentMonths(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(endMonth, i - count + 1));
}

export interface BudgetRow {
  category: Category | null;
  spent: Cents;
  budget: Cents;
}

/** Expense categories with a budget or spending this month, biggest first. */
export function budgetRows(
  summary: MonthSummary,
  categories: Category[],
  budgets: Budget[],
): BudgetRow[] {
  const b = new Map(budgets.map((x) => [x.categoryId, x.amount]));
  const rows: BudgetRow[] = categories
    .filter((c) => c.kind === 'expense')
    .map((c) => ({ category: c, spent: summary.byCategory.get(c.id) ?? 0, budget: b.get(c.id) ?? 0 }))
    .filter((r) => r.budget > 0 || r.spent !== 0);
  const unc = summary.byCategory.get('') ?? 0;
  if (unc) rows.push({ category: null, spent: unc, budget: 0 });
  return rows.sort((x, y) => y.spent - x.spent);
}
