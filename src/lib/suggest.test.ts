import { describe, expect, it } from 'vitest';
import { tagBuiltins } from './db';
import { buildRows } from './importer';
import { matchMerchant } from './merchants';
import { buildHistory, merchantKeys, suggestCategory, type SuggestContext } from './suggest';
import type { Category, Rule, Transaction } from './types';

const cats: Category[] = [
  { id: 'groc', name: 'Groceries', kind: 'expense', order: 0, builtin: 'groceries' },
  { id: 'fuel', name: 'Fuel', kind: 'expense', order: 1, builtin: 'fuel' },
  { id: 'eat', name: 'Eating Out', kind: 'expense', order: 2, builtin: 'eating-out' },
  { id: 'ins', name: 'Insurance', kind: 'expense', order: 3, builtin: 'insurance' },
  { id: 'bills', name: 'Bills', kind: 'expense', order: 4, builtin: 'bills' },
  { id: 'fun', name: 'Entertainment', kind: 'expense', order: 5, builtin: 'entertainment' },
  { id: 'gym', name: 'Gym', kind: 'expense', order: 6 },
  { id: 'inc', name: 'Income', kind: 'income', order: 7, builtin: 'income' },
  { id: 'xfer', name: 'Transfers', kind: 'transfer', order: 8, builtin: 'transfers', system: true },
];

let n = 0;
const past = (description: string, categoryId: string, categorySource?: Transaction['categorySource']) => ({
  description,
  categoryId,
  categorySource,
  id: String(n++),
});

function ctx(over: Partial<SuggestContext> = {}): SuggestContext {
  return { rules: [], categories: cats, ownSuffixes: [], history: buildHistory([]), ...over };
}

describe('merchantKeys', () => {
  it('strips bank wording, numbers and noise', () => {
    expect(merchantKeys('Direct Debit 123456 BUDGET DIRECT')?.key).toBe('BUDGET DIRECT');
    expect(merchantKeys('WOOLWORTHS 4021 PERTH AU')?.key).toBe('WOOLWORTHS PERTH');
    expect(merchantKeys('Transfer to xx1111 CommBank app')?.key).toBe('XX1111');
    expect(merchantKeys('Transfer from CommBank app')).toBeNull();
  });
});

describe('matchMerchant', () => {
  it('matches common Australian merchants on word boundaries', () => {
    expect(matchMerchant('WOOLWORTHS 4021 PERTH', -5000)).toMatchObject({ category: 'groceries', strong: true });
    expect(matchMerchant('BP MIDLAND 1234', -6000)).toMatchObject({ category: 'fuel', strong: true });
    expect(matchMerchant('BPAY TELSTRA', -9000)).toMatchObject({ category: 'bills' });
    expect(matchMerchant('BPAY 12345 SOMETHING', -9000)).toBeNull();
  });
  it('prefers the longer keyword (Coles Express is fuel, not groceries)', () => {
    expect(matchMerchant('COLES EXPRESS 1234', -7000)?.category).toBe('fuel');
  });
  it('respects direction (salary only for money in)', () => {
    expect(matchMerchant('ACME PTY LTD SALARY', 300000)?.category).toBe('income');
    expect(matchMerchant('ACME PTY LTD SALARY', -300000)).toBeNull();
  });
  it('marks generic words as weak', () => {
    expect(matchMerchant('THE CORNER CAFE', -1200)).toMatchObject({ category: 'eating-out', strong: false });
  });
});

describe('suggestCategory', () => {
  it('applies rules first, confidently', () => {
    const rules: Rule[] = [{ id: 'r', pattern: 'WOOLWORTHS', categoryId: 'gym', createdAt: 0 }];
    expect(suggestCategory('WOOLWORTHS PERTH', -100, ctx({ rules }))).toMatchObject({
      categoryId: 'gym',
      confident: true,
      source: 'rule',
    });
  });

  it('detects transfers between own accounts', () => {
    expect(suggestCategory('Transfer to xx1111 CommBank app', -100, ctx({ ownSuffixes: ['1111'] }))).toMatchObject({
      categoryId: 'xfer',
      confident: true,
      source: 'transfer',
    });
  });

  it('auto-applies strong built-in merchants', () => {
    expect(suggestCategory('NETFLIX.COM SYDNEY', -1999, ctx())).toMatchObject({
      categoryId: 'fun',
      confident: true,
      source: 'auto',
    });
  });

  it('only suggests for weak keywords', () => {
    expect(suggestCategory('THE CORNER CAFE PERTH', -1200, ctx())).toMatchObject({ categoryId: 'eat', confident: false });
  });

  it('learns from your choices and beats the built-in list', () => {
    const history = buildHistory([
      past('WOOLWORTHS 1234 PERTH AU', 'gym'),
      past('WOOLWORTHS 9999 PERTH AU', 'gym'),
    ]);
    expect(suggestCategory('WOOLWORTHS 5555 PERTH', -100, ctx({ history }))).toMatchObject({
      categoryId: 'gym',
      confident: true,
      reason: 'Like 2 past transactions',
    });
  });

  it('a single past example is only a suggestion', () => {
    const history = buildHistory([past('JIMS MOWING 12345', 'bills')]);
    expect(suggestCategory('JIMS MOWING 999', -8000, ctx({ history }))).toMatchObject({
      categoryId: 'bills',
      confident: false,
    });
  });

  it('mixed history is only a suggestion', () => {
    const history = buildHistory([
      past('Transfer to xx4444 CommBank app', 'bills'),
      past('Transfer to xx4444 CommBank app', 'bills'),
      past('Transfer to xx4444 CommBank app', 'fun'),
    ]);
    expect(suggestCategory('Transfer to xx4444 CommBank app', -100, ctx({ history }))).toMatchObject({
      categoryId: 'bills',
      confident: false,
    });
  });

  it("does not learn from the app's own auto guesses", () => {
    const history = buildHistory([past('MYSTERY SHOP', 'gym', 'auto'), past('MYSTERY SHOP', 'gym', 'auto')]);
    expect(suggestCategory('MYSTERY SHOP', -100, ctx({ history }))).toBeNull();
  });

  it('falls back to the first word of the merchant as a weak suggestion', () => {
    const history = buildHistory([past('BUNNINGS 1 MIDVALE', 'gym'), past('BUNNINGS 2 JOONDALUP', 'gym')]);
    expect(suggestCategory('BUNNINGS 3 CANNINGTON', -100, ctx({ history }))).toMatchObject({
      categoryId: 'gym',
      confident: false,
      reason: 'Similar to 2 past transactions',
    });
  });

  it('keeps working after a built-in category is renamed', () => {
    const renamed = cats.map((c) => (c.id === 'groc' ? { ...c, name: 'Food shopping' } : c));
    expect(suggestCategory('ALDI STORES', -100, ctx({ categories: renamed }))?.categoryId).toBe('groc');
  });

  it('returns null when there is nothing to go on', () => {
    expect(suggestCategory('Transfer from CommBank app', 500, ctx())).toBeNull();
  });
});

describe('tagBuiltins', () => {
  it('tags older default categories by name, once', () => {
    const old: Category[] = [
      { id: 'a', name: 'Groceries', kind: 'expense', order: 0 },
      { id: 'b', name: 'Holidays', kind: 'expense', order: 1 },
    ];
    expect(tagBuiltins(old).map((c) => c.id)).toEqual(['a']);
    expect(old[0].builtin).toBe('groceries');
    expect(tagBuiltins(old)).toEqual([]);
  });
});

describe('import with suggestions', () => {
  it('auto-applies confident guesses and leaves weak ones as suggestions', () => {
    const rows = buildRows(
      [
        { date: '2026-03-01', description: 'WOOLWORTHS 4021 PERTH', amount: -5000, warnings: [] },
        { date: '2026-03-02', description: 'THE CORNER CAFE', amount: -1200, warnings: [] },
        { date: '2026-03-03', description: 'SOMETHING UNKNOWN', amount: -1000, warnings: [] },
      ],
      'acc',
      'csv',
      { rules: [], categories: cats, settings: { ownAccountSuffixes: [], notOwnAccountSuffixes: [] }, history: buildHistory([]) },
      new Set(),
      new Set(),
    );
    expect(rows[0]).toMatchObject({ categoryId: 'groc', categorySource: 'auto' });
    expect(rows[1]).toMatchObject({ categoryId: null, suggestion: { categoryId: 'eat', confident: false } });
    expect(rows[2]).toMatchObject({ categoryId: null, suggestion: null });
  });
});
