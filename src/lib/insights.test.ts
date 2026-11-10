import { describe, expect, it } from 'vitest';
import { stalePending } from './capture';
import { transactionsToCsv } from './exportCsv';
import { accountBalances, balanceSeries, budgetPace, categoryTrends, findRecurring, goalProgress } from './insights';
import { checkPin, loadLock, lockEnabled, makePin, saveLock, shouldRelock, validPin } from './lock';
import type { Category, Transaction } from './types';

const cats: Category[] = [
  { id: 'groc', name: 'Groceries', kind: 'expense', order: 0, builtin: 'groceries' },
  { id: 'ins', name: 'Insurance', kind: 'expense', order: 1, builtin: 'insurance' },
  { id: 'fun', name: 'Entertainment', kind: 'expense', order: 2, builtin: 'entertainment' },
  { id: 'xfer', name: 'Transfers', kind: 'transfer', order: 3, builtin: 'transfers' },
];

let n = 0;
const tx = (date: string, amount: number, description: string, categoryId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id: String(n++),
  accountId: 'acc',
  date,
  description,
  amount,
  categoryId,
  dedupeKey: '',
  source: 'pdf',
  createdAt: n,
  ...extra,
});

describe('budgetPace', () => {
  it('only applies to the current month with a budget', () => {
    expect(budgetPace(1000, 10000, '2026-10', '2026-11-10')).toBeNull();
    expect(budgetPace(1000, 0, '2026-11', '2026-11-10')).toBeNull();
  });
  it('works out what is left per day', () => {
    // 30-day month, day 10: 21 days left including today.
    expect(budgetPace(9000, 30000, '2026-11', '2026-11-10')).toEqual({ left: 21000, daysLeft: 21, perDay: 1000, status: 'on-track' });
  });
  it('flags spending faster than the month is passing, and going over', () => {
    expect(budgetPace(20000, 30000, '2026-11', '2026-11-10')?.status).toBe('ahead');
    // One or two big payments (e.g. the mortgage) aren't "spending too fast".
    expect(budgetPace(20000, 30000, '2026-11', '2026-11-10', 1)?.status).toBe('on-track');
    expect(budgetPace(20000, 30000, '2026-11', '2026-11-10', 3)?.status).toBe('ahead');
    expect(budgetPace(31000, 30000, '2026-11', '2026-11-10')).toMatchObject({ status: 'over', left: -1000, perDay: 0 });
  });
});

describe('findRecurring', () => {
  const insurer = [
    tx('2026-05-01', -10295, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-06-01', -10295, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-07-01', -10295, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-08-03', -10908, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-08-03', -8995, 'Direct Debit 123456 BUDGET DIRECT', 'ins'), // second policy that day
    tx('2026-09-01', -10884, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-10-01', -10884, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
    tx('2026-11-02', -10884, 'Direct Debit 123456 BUDGET DIRECT', 'ins'),
  ];
  const groceries = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'].map((d, i) =>
    tx(d, -(4000 + i * 3700), 'WOOLWORTHS 1 PERTH', 'groc'),
  );
  const stopped = ['2026-01-05', '2026-02-05', '2026-03-05'].map((d) => tx(d, -1999, 'OLD GYM', 'fun'));
  const transfers = ['2026-09-01', '2026-10-01', '2026-11-01'].map((d) => tx(d, -50000, 'Transfer to xx1111 CommBank app', 'xfer'));
  const weekly = ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06'].map((d) => tx(d, -1500, 'POOL SWIM CLUB', 'fun'));

  const found = findRecurring([...insurer, ...groceries, ...stopped, ...transfers, ...weekly], cats, '2026-11-10');

  it('finds steady monthly and weekly payments only', () => {
    expect(found.map((r) => [r.key, r.frequency])).toEqual([
      ['POOL SWIM', 'weekly'],
      ['BUDGET DIRECT', 'monthly'],
    ]);
  });
  it('predicts the next date and monthly cost', () => {
    const [swim, ins] = found;
    expect(swim).toMatchObject({ nextDate: '2026-11-13', amount: 1500, monthly: 6500 });
    expect(ins).toMatchObject({ nextDate: '2026-12-02', amount: 10884, monthly: 10884, count: 7 });
  });
  it('reports a recent change in amount', () => {
    expect(found[1]).toMatchObject({ previousAmount: 10295, changedOn: '2026-08-03' });
    expect(found[0].previousAmount).toBeUndefined();
  });
});

describe('balances', () => {
  // Same day, three transactions, saved newest-first (as a CommBank CSV lists them).
  const txs = [
    tx('2026-10-02', -500, 'c', null, { balance: 8500, createdAt: 1 }),
    tx('2026-10-02', -1000, 'b', null, { balance: 9000, createdAt: 2 }),
    tx('2026-10-02', 2000, 'a', null, { balance: 10000, createdAt: 3 }),
    tx('2026-10-01', -2000, 'z', null, { balance: 8000, createdAt: 4 }),
    tx('2026-10-05', -100, 'manual, no balance', null, { source: 'manual' }),
    tx('2026-10-03', -700, 'other account', null, { accountId: 'other', balance: 300 }),
  ];
  it('uses the closing balance of each day whichever way the statement was ordered', () => {
    expect(balanceSeries(txs, 'acc')).toEqual([
      { date: '2026-10-01', balance: 8000 },
      { date: '2026-10-02', balance: 8500 },
    ]);
  });
  it('gives the latest balance per account', () => {
    const accounts = [
      { id: 'acc', name: 'Offset', createdAt: 0 },
      { id: 'other', name: 'Spending', createdAt: 0 },
      { id: 'cash', name: 'Cash', createdAt: 0 },
    ];
    expect(accountBalances(txs, accounts).map((b) => [b.account.name, b.balance, b.asOf])).toEqual([
      ['Offset', 8500, '2026-10-02'],
      ['Spending', 300, '2026-10-03'],
    ]);
  });
});

describe('goalProgress', () => {
  const balances = [{ account: { id: 'acc', name: 'Offset', createdAt: 0 }, balance: 250000, asOf: '2026-11-02' }];
  const goal = { id: 'g', name: 'Buffer', target: 1000000, accountId: 'acc', createdAt: 0 };
  it('follows the account balance', () => {
    expect(goalProgress(goal, balances, '2026-11-10')).toMatchObject({ fraction: 0.25, remaining: 750000, perMonth: null, reached: false });
  });
  it('works out a monthly amount for a target date', () => {
    const p = goalProgress({ ...goal, targetDate: '2027-05-10' }, balances, '2026-11-10');
    expect(p.perMonth).toBeGreaterThan(120000);
    expect(p.perMonth).toBeLessThan(130000);
  });
  it('handles reached goals and accounts without a balance', () => {
    expect(goalProgress({ ...goal, target: 200000 }, balances, '2026-11-10')).toMatchObject({ reached: true, fraction: 1, remaining: 0 });
    expect(goalProgress({ ...goal, accountId: 'none' }, balances, '2026-11-10')).toMatchObject({ balance: null, fraction: 0 });
  });
});

describe('categoryTrends', () => {
  const txs = [
    tx('2026-11-03', -6000, 'x', 'groc'),
    tx('2026-10-03', -4000, 'x', 'groc'),
    tx('2026-09-03', -2000, 'x', 'groc'),
    tx('2026-10-05', -1500, 'x', 'fun'),
    tx('2026-11-05', -900, 'x', null),
    tx('2026-10-06', -99999, 'x', 'xfer'),
  ];
  it('compares with last month and the average of months you have data for', () => {
    expect(categoryTrends(txs, cats, '2026-11').map((t) => [t.category?.name ?? 'Uncategorised', t.current, t.previous, t.average])).toEqual([
      ['Groceries', 6000, 4000, 3000],
      ['Uncategorised', 900, 0, 0],
      ['Entertainment', 0, 1500, 750],
    ]);
  });
});

describe('stalePending', () => {
  it('finds captures older than 10 days', () => {
    const list = [
      tx('2026-10-25', -100, 'old', null, { pending: true }),
      tx('2026-11-05', -100, 'recent', null, { pending: true }),
      tx('2026-10-01', -100, 'not pending', null),
    ];
    expect(stalePending(list, '2026-11-10').map((t) => t.description)).toEqual(['old']);
  });
});

describe('transactionsToCsv', () => {
  it('writes one row per transaction with safe quoting', () => {
    const csv = transactionsToCsv(
      [
        tx('2026-11-02', -10884, 'BUDGET DIRECT, "Gold"', 'ins', { balance: 95808, notes: 'car' }),
        tx('2026-11-03', 50000, '=HYPERLINK("x")', null, { pending: true }),
        tx('2026-11-04', -1999, 'NETFLIX', 'fun', { necessity: 'necessary' }),
      ],
      cats,
      [{ id: 'acc', name: 'Offset', createdAt: 0 }],
    );
    expect(csv.split('\r\n')).toEqual([
      'Date,Description,Amount,Category,Type,Necessary,Account,Balance,Status,Notes',
      '02/11/2026,"BUDGET DIRECT, ""Gold""",-108.84,Insurance,Spending,necessary,Offset,958.08,,car',
      '03/11/2026,"\'=HYPERLINK(""x"")",500.00,Uncategorised,Income,,Offset,,Pending,',
      '04/11/2026,NETFLIX,-19.99,Entertainment,Spending,necessary,Offset,,,',
      '',
    ]);
  });
});

describe('app lock', () => {
  it('validates and checks a PIN', async () => {
    expect(validPin('1234')).toBe(true);
    expect(validPin('12')).toBe(false);
    expect(validPin('12ab')).toBe(false);
    const cfg = { timeoutMinutes: 1, ...(await makePin('2580')) };
    expect(cfg.pinHash).not.toContain('2580');
    expect(await checkPin('2580', cfg)).toBe(true);
    expect(await checkPin('2581', cfg)).toBe(false);
    expect(await checkPin('2580', { timeoutMinutes: 1 })).toBe(false);
  });
  it('is off unless a PIN or fingerprint is set', () => {
    expect(lockEnabled({ timeoutMinutes: 1 })).toBe(false);
    expect(lockEnabled({ timeoutMinutes: 1, credentialId: 'abc' })).toBe(true);
    expect(lockEnabled({ timeoutMinutes: 1, pinHash: 'x', salt: 'y' })).toBe(true);
  });
  it('locks again after the timeout in the background', () => {
    const cfg = { timeoutMinutes: 1, pinHash: 'x', salt: 'y' };
    expect(shouldRelock(cfg, 0, 59_000)).toBe(false);
    expect(shouldRelock(cfg, 0, 60_000)).toBe(true);
    expect(shouldRelock(cfg, null, 999_999)).toBe(false);
    expect(shouldRelock({ timeoutMinutes: 0, pinHash: 'x', salt: 'y' }, 5, 5)).toBe(true);
    expect(shouldRelock({ timeoutMinutes: 1 }, 0, 999_999)).toBe(false);
  });
  it('saves and loads settings, tolerating junk', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadLock(storage)).toEqual({ timeoutMinutes: 1 });
    saveLock({ timeoutMinutes: 5, credentialId: 'abc' }, storage);
    expect(loadLock(storage)).toEqual({ timeoutMinutes: 5, credentialId: 'abc' });
    mem.set('budget-lock', '{not json');
    expect(loadLock(storage)).toEqual({ timeoutMinutes: 1 });
  });
});
