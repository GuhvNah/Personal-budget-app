import { describe, expect, it } from 'vitest';
import { makeBackup, readBackup } from './backup';
import { categorise, mentionedSuffixes, ruleMatches, samePattern, suggestPattern, transferSuffix } from './categorise';
import { addMonths, formatDate, parseDate, parseDayMonthName } from './dates';
import { dedupeKeys } from './dedupe';
import { buildRows, rowsToSave } from './importer';
import { buildHistory } from './suggest';
import { formatAUD, parseMoney } from './money';
import { budgetRows, summariseMonth } from './stats';
import type { Category, Rule, Transaction } from './types';
import { commbankTransactionSummary } from '../parsers/commbank';
import { PAGE_1, PAGE_2, STATEMENT } from '../parsers/__fixtures__/commbank';

describe('money', () => {
  it.each([
    ['-$1,234.56', -123456],
    ['$5.00', 500],
    ['+4913.92', 491392],
    ['(12.50)', -1250],
    ['12.50 DR', -1250],
    ['12.50 CR', 1250],
    ['1234', 123400],
    ['.5', 50],
    ['$-3.10', -310],
  ])('parses %s', (s, cents) => expect(parseMoney(s)).toBe(cents));
  it('rejects junk', () => {
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
  });
  it('formats AUD', () => {
    expect(formatAUD(-10295)).toBe('-$102.95');
    expect(formatAUD(123456789)).toBe('$1,234,567.89');
  });
});

describe('dates', () => {
  it('parses and formats Australian dates', () => {
    expect(parseDate('05/11/2026')).toBe('2026-11-05');
    expect(parseDate('5/1/26')).toBe('2026-01-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDayMonthName('02 Jan 2026')).toBe('2026-01-02');
    expect(parseDayMonthName('2 September 2026')).toBe('2026-09-02');
    expect(formatDate('2026-01-02')).toBe('02/01/2026');
  });
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

const cats: Category[] = [
  { id: 'groc', name: 'Groceries', kind: 'expense', order: 0 },
  { id: 'ins', name: 'Insurance', kind: 'expense', order: 1 },
  { id: 'mort', name: 'Rent/Mortgage', kind: 'expense', order: 2 },
  { id: 'inc', name: 'Income', kind: 'income', order: 3 },
  { id: 'xfer', name: 'Transfers', kind: 'transfer', order: 4, system: true },
];
const rule = (pattern: string, categoryId: string): Rule => ({ id: pattern, pattern, categoryId, createdAt: 0 });

describe('rule matching is not case-sensitive', () => {
  it.each([
    ['aldi', 'ALDI STORES MIDLAND'],
    ['ALDI', 'Aldi Stores'],
    ['Budget Direct', 'Direct Debit 123456 BUDGET DIRECT'],
    ['budget direct', 'Direct Debit 123456 BUDGET  DIRECT'], // extra space in description
    ['budget direct', 'Direct Debit 123456 BUDGET\u00a0DIRECT'], // non-breaking space
    ['  budget   direct ', 'Direct Debit 123456 BUDGET DIRECT'], // extra spaces in rule
    ['cafe', 'THE CORNER CAFÉ'], // accents ignored
    ['café', 'the corner cafe'],
    ['\uff43\uff4f\uff4c\uff45\uff53', 'COLES 123'], // full-width pasted text
  ])('%j matches %j', (pattern, description) => {
    expect(ruleMatches({ pattern }, description)).toBe(true);
  });
  it('still needs the text to be there', () => {
    expect(ruleMatches({ pattern: 'aldi' }, 'COLES')).toBe(false);
    expect(ruleMatches({ pattern: '   ' }, 'anything')).toBe(false);
  });
  it('treats rules differing only in case or spacing as the same rule', () => {
    expect(samePattern('ALDI', ' aldi ')).toBe(true);
    expect(samePattern('Budget  Direct', 'BUDGET DIRECT')).toBe(true);
    expect(samePattern('ALDI', 'ALDI STORES')).toBe(false);
  });
  it('categorise uses the same matching', () => {
    expect(categorise('Direct Debit 1 BUDGET\u00a0DIRECT', [rule('budget direct', 'ins')], cats, [])).toBe('ins');
  });
});

describe('categorise', () => {
  const rules = [rule('ALDI', 'groc'), rule('budget direct', 'ins'), rule('xx5555', 'mort')];
  it('matches rules case-insensitively', () => {
    expect(categorise('ALDI STORES PERTH', rules, cats, [])).toBe('groc');
    expect(categorise('Direct Debit 123456 BUDGET DIRECT', rules, cats, [])).toBe('ins');
    expect(categorise('Woolworths', rules, cats, [])).toBeNull();
  });
  it('prefers the longest matching rule', () => {
    const r = [rule('DIRECT', 'groc'), rule('BUDGET DIRECT', 'ins')];
    expect(categorise('Direct Debit BUDGET DIRECT', r, cats, [])).toBe('ins');
  });
  it('treats transfers between own accounts as Transfers', () => {
    expect(categorise('Transfer to xx1111 CommBank app', rules, cats, ['1111'])).toBe('xfer');
    expect(categorise('Transfer to xx4444 CommBank app', rules, cats, ['1111'])).toBeNull();
  });
  it('lets a rule override transfer detection (e.g. mortgage account)', () => {
    expect(categorise('Transfer to xx5555 CommBank app', rules, cats, ['5555'])).toBe('mort');
  });
  it('ignores rules pointing at deleted categories', () => {
    expect(categorise('ALDI', [rule('ALDI', 'gone')], cats, [])).toBeNull();
  });
  it('finds account suffixes and suggests patterns', () => {
    expect(transferSuffix('Transfer from xx2222 CommBank app wage')).toBe('2222');
    expect(mentionedSuffixes(['Transfer to xx1111 x', 'Transfer from xx2222 y', 'Transfer to xx1111 z'])).toEqual(['1111', '2222']);
    expect(suggestPattern('Direct Debit 123456 BUDGET DIRECT')).toBe('BUDGET DIRECT');
    expect(suggestPattern('Transfer to xx1111 CommBank app')).toBe('xx1111');
    expect(suggestPattern('ALDI STORES - PERTH AU')).toBe('ALDI STORES - PERTH');
    expect(suggestPattern('WOOLWORTHS 4021 PERTH AU')).toBe('WOOLWORTHS');
    expect(suggestPattern('JIMS MOWING #12 MIDVALE')).toBe('JIMS MOWING');
  });
});

describe('dedupe', () => {
  it('uses the running balance so same-day identical payments stay distinct', () => {
    const k = dedupeKeys('acc', [
      { date: '2026-03-26', amount: -15000, balance: 378786, description: 'x' },
      { date: '2026-03-26', amount: -15000, balance: 363786, description: 'x' },
    ]);
    expect(new Set(k).size).toBe(2);
  });
  it('without a balance, numbers repeated identical rows', () => {
    const k = dedupeKeys('acc', [
      { date: '2026-03-26', amount: -500, description: 'Coffee' },
      { date: '2026-03-26', amount: -500, description: 'COFFEE ' },
    ]);
    expect(k).toEqual(['acc|2026-03-26|-500|coffee#1', 'acc|2026-03-26|-500|coffee#2']);
  });
});

describe('importing overlapping statements', () => {
  const data = {
    rules: [rule('BUDGET DIRECT', 'ins')],
    categories: cats,
    settings: { ownAccountSuffixes: ['1111'], notOwnAccountSuffixes: [] },
    history: buildHistory([]),
  };

  it('skips transactions already saved and repeats within one import', () => {
    const first = commbankTransactionSummary.parse([PAGE_1]).transactions; // Jan–Mar
    const saved = rowsToSave([{ fileName: 'a.pdf', accountId: 'acc', warnings: [], rows: buildRows(first, 'acc', 'pdf', data, new Set(), new Set()) }]);
    expect(saved).toHaveLength(6);

    // The second statement covers everything (overlaps the first completely).
    const second = commbankTransactionSummary.parse(STATEMENT).transactions;
    const rows = buildRows(second, 'acc', 'pdf', data, new Set(saved.map((t) => t.dedupeKey)), new Set());
    expect(rows.filter((r) => r.duplicate)).toHaveLength(6);
    expect(rowsToSave([{ fileName: 'b.pdf', accountId: 'acc', warnings: [], rows }])).toHaveLength(4);

    // Choosing two copies of the same file at once only saves one set.
    const seen = new Set<string>();
    const a = buildRows(second, 'acc', 'pdf', data, new Set(), seen);
    const b = buildRows(commbankTransactionSummary.parse([PAGE_1, PAGE_2]).transactions, 'acc', 'pdf', data, new Set(), seen);
    expect(b.every((r) => r.duplicate)).toBe(true);
    expect(a.some((r) => r.duplicate)).toBe(false);
  });

  it('auto-categorises during import', () => {
    const rows = buildRows(commbankTransactionSummary.parse(STATEMENT).transactions, 'acc', 'pdf', data, new Set(), new Set());
    expect(rows[0]).toMatchObject({ categoryId: 'ins', categorySource: 'rule' });
    expect(rows[1]).toMatchObject({ categoryId: 'xfer', categorySource: 'transfer' });
    expect(rows[3]).toMatchObject({ categoryId: null, suggestion: null });
    const saved = rowsToSave([{ fileName: 'a', accountId: 'acc', warnings: [], rows }]);
    expect(saved[0].categorySource).toBe('rule');
    expect(saved[3].categorySource).toBeUndefined();
  });

  it('does not save removed lines', () => {
    const rows = buildRows(commbankTransactionSummary.parse([PAGE_1]).transactions, 'acc', 'pdf', data, new Set(), new Set());
    rows[0].removed = true;
    expect(rowsToSave([{ fileName: 'a', accountId: 'acc', warnings: [], rows }])).toHaveLength(5);
  });
});

describe('monthly summary', () => {
  const tx = (date: string, amount: number, categoryId: string | null): Transaction => ({
    id: Math.random().toString(),
    accountId: 'a',
    date,
    description: '',
    amount,
    categoryId,
    dedupeKey: '',
    source: 'manual',
    createdAt: 0,
  });
  const txs = [
    tx('2026-03-02', -10295, 'ins'),
    tx('2026-03-10', 2597, 'ins'), // refund reduces Insurance spending
    tx('2026-03-11', -5000, 'groc'),
    tx('2026-03-12', -100000, 'xfer'), // ignored
    tx('2026-03-15', 300000, 'inc'),
    tx('2026-03-16', -1000, null), // uncategorised spending
    tx('2026-03-17', 600, null), // uncategorised income
    tx('2026-04-01', -9999, 'groc'), // other month
  ];

  it('totals income and spending, excluding transfers', () => {
    const s = summariseMonth('2026-03', txs, cats);
    expect(s.income).toBe(300600);
    expect(s.spending).toBe(10295 - 2597 + 5000 + 1000);
    expect(s.byCategory.get('ins')).toBe(7698);
  });

  it('builds budget rows, biggest spend first, flagging uncategorised', () => {
    const s = summariseMonth('2026-03', txs, cats);
    const rows = budgetRows(s, cats, [{ categoryId: 'groc', amount: 4000 }, { categoryId: 'mort', amount: 200000 }]);
    expect(rows.map((r) => [r.category?.name ?? 'Uncategorised', r.spent, r.budget])).toEqual([
      ['Insurance', 7698, 0],
      ['Groceries', 5000, 4000],
      ['Uncategorised', 1000, 0],
      ['Rent/Mortgage', 0, 200000],
    ]);
  });
});

describe('backup', () => {
  const data = {
    accounts: [{ id: 'a', name: 'Offset', createdAt: 1 }],
    transactions: [],
    categories: cats,
    rules: [],
    budgets: [{ categoryId: 'groc', amount: 50000 }],
    settings: { ownAccountSuffixes: ['1111'], notOwnAccountSuffixes: [] },
    goals: [{ id: 'g', name: 'Buffer', target: 1000000, accountId: 'a', createdAt: 2 }],
  };
  it('reads older backups without goals', () => {
    const old = JSON.parse(makeBackup(data));
    delete old.goals;
    expect(readBackup(JSON.stringify(old)).goals).toEqual([]);
  });
  it('round-trips', () => {
    expect(readBackup(makeBackup(data))).toEqual(data);
  });
  it('rejects files that are not backups', () => {
    expect(() => readBackup('not json')).toThrow(/isn't valid JSON/);
    expect(() => readBackup('{"app":"other"}')).toThrow(/isn't a backup/);
    expect(() => readBackup(JSON.stringify({ ...JSON.parse(makeBackup(data)), version: 99 }))).toThrow(/newer version/);
  });
});
