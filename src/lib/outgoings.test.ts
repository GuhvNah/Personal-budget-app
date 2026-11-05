import { describe, expect, it } from 'vitest';
import { categoryNecessity, periodContaining, periodDates, shiftPeriod, summariseOutgoings } from './outgoings';
import type { Category, Transaction } from './types';

const cats: Category[] = [
  { id: 'groc', name: 'Groceries', kind: 'expense', order: 0, builtin: 'groceries' },
  { id: 'eat', name: 'Eating Out', kind: 'expense', order: 1, builtin: 'eating-out' },
  { id: 'fun', name: 'Entertainment', kind: 'expense', order: 2, builtin: 'entertainment', necessity: 'necessary' },
  { id: 'gym', name: 'Gym', kind: 'expense', order: 3 },
  { id: 'inc', name: 'Income', kind: 'income', order: 4, builtin: 'income' },
  { id: 'xfer', name: 'Transfers', kind: 'transfer', order: 5, builtin: 'transfers' },
];

let n = 0;
const tx = (date: string, amount: number, categoryId: string | null, necessity?: Transaction['necessity']): Transaction => ({
  id: String(n++),
  accountId: 'a',
  date,
  description: '',
  amount,
  categoryId,
  necessity,
  dedupeKey: '',
  source: 'manual',
  createdAt: 0,
});

describe('categoryNecessity', () => {
  it('uses defaults for built-ins, your setting when given, and necessary for your own', () => {
    expect(categoryNecessity(cats[0])).toBe('necessary');
    expect(categoryNecessity(cats[1])).toBe('unnecessary');
    expect(categoryNecessity(cats[2])).toBe('necessary');
    expect(categoryNecessity(cats[3])).toBe('necessary');
  });
});

describe('periods', () => {
  it('finds the calendar period containing a month', () => {
    expect(periodContaining('2026-11', 'month')).toMatchObject({ start: '2026-11', end: '2026-11', label: 'November 2026' });
    expect(periodContaining('2026-11', 'quarter')).toMatchObject({ start: '2026-10', end: '2026-12', label: 'Q4 2026 (Oct–Dec 2026)' });
    expect(periodContaining('2026-05', 'half')).toMatchObject({ start: '2026-01', end: '2026-06', label: 'H1 2026 (Jan–Jun 2026)' });
    expect(periodContaining('2026-07', 'half')).toMatchObject({ start: '2026-07', end: '2026-12' });
    expect(periodContaining('2026-03', 'year')).toMatchObject({ start: '2026-01', end: '2026-12', label: '2026' });
  });
  it('steps backwards and forwards across years', () => {
    expect(shiftPeriod(periodContaining('2026-02', 'quarter'), -1)).toMatchObject({ start: '2025-10', end: '2025-12' });
    expect(shiftPeriod(periodContaining('2026-08', 'half'), 1)).toMatchObject({ start: '2027-01', end: '2027-06' });
  });
  it('gives the first and last day', () => {
    expect(periodDates(periodContaining('2028-02', 'month'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodDates(periodContaining('2026-05', 'quarter'))).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });
});

describe('summariseOutgoings', () => {
  const txs = [
    tx('2026-10-01', -10000, 'groc'),
    tx('2026-10-02', -2000, 'eat'),
    tx('2026-10-03', -3000, 'eat', 'necessary'), // override: necessary
    tx('2026-10-04', -500, 'groc', 'unnecessary'), // override: unnecessary
    tx('2026-10-05', 1000, 'groc'), // refund reduces groceries
    tx('2026-10-06', -4000, null), // uncategorised -> not sorted yet
    tx('2026-10-07', -700, null, 'unnecessary'), // uncategorised with override
    tx('2026-10-08', 9999, null), // uncategorised credit: income, ignored
    tx('2026-10-09', -50000, 'xfer'), // transfers ignored
    tx('2026-10-10', 300000, 'inc'), // income ignored
    tx('2026-11-01', -8000, 'groc'), // outside the period
  ];
  const out = summariseOutgoings(txs, cats, '2026-10-01', '2026-10-31');

  it('splits necessary / unnecessary / not sorted and by category', () => {
    expect(out.groups.map((g) => [g.group, g.amount])).toEqual([
      ['necessary', 9000 + 3000],
      ['unnecessary', 2000 + 500 + 700],
      ['unsorted', 4000],
    ]);
    expect(out.total).toBe(12000 + 3200 + 4000);
    expect(out.groups[0].slices.map((s) => [s.name, s.amount])).toEqual([
      ['Groceries', 9000],
      ['Eating Out', 3000],
    ]);
    expect(out.groups[1].slices.map((s) => [s.name, s.amount])).toEqual([
      ['Eating Out', 2000],
      ['Uncategorised', 700],
      ['Groceries', 500],
    ]);
  });

  it('drops slices where refunds outweigh spending', () => {
    const r = summariseOutgoings([tx('2026-10-01', -100, 'gym'), tx('2026-10-02', 500, 'gym')], cats, '2026-10-01', '2026-10-31');
    expect(r).toEqual({ total: 0, groups: [] });
  });
});
