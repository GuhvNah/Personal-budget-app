import { describe, expect, it } from 'vitest';
import { tagBuiltins } from './db';
import { applyToSimilar, buildRows, type ReviewBatch } from './importer';
import { matchMerchant } from './merchants';
import { autoApplyPending, buildHistory, merchantKeys, sameMerchant, suggestCategory, type SuggestContext } from './suggest';
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
      reason: 'Same as 2 you approved',
    });
  });

  it('one approved transaction from the same merchant is enough', () => {
    const history = buildHistory([past('JIMS MOWING 12345', 'bills')]);
    expect(suggestCategory('JIMS MOWING 999', -8000, ctx({ history }))).toMatchObject({
      categoryId: 'bills',
      confident: true,
      reason: 'Same as one you approved',
    });
  });

  it('a different merchant with the same first word is only a suggestion', () => {
    const history = buildHistory([past('JIMS MOWING 12345', 'bills'), past('JIMS MOWING 5', 'bills')]);
    expect(suggestCategory('JIMS PLUMBING 7', -8000, ctx({ history }))).toMatchObject({ confident: false });
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

const txn = (id: string, description: string, categoryId: string | null, categorySource?: Transaction['categorySource']): Transaction => ({
  id,
  accountId: 'a',
  date: '2026-10-01',
  description,
  amount: -1000,
  categoryId,
  categorySource,
  dedupeKey: id,
  source: 'csv',
  createdAt: 0,
});

describe('auto-approving like transactions', () => {
  it('sameMerchant ignores store numbers but not different suburbs', () => {
    expect(sameMerchant('WOOLWORTHS 4021 PERTH AU', 'WOOLWORTHS 1234 PERTH')).toBe(true);
    expect(sameMerchant('WOOLWORTHS 4021 PERTH', 'WOOLWORTHS MIDLAND')).toBe(false);
    expect(sameMerchant('Transfer to xx4444 CommBank app', 'Transfer to xx4444 NetBank')).toBe(true);
    expect(sameMerchant('Transfer from CommBank app', 'Transfer from CommBank app')).toBe(false);
  });

  it('applies an approval to pending transactions from the same merchant', () => {
    const all = [
      txn('1', 'LOCAL SPORTS CLUB 1', 'fun', 'user'),
      txn('2', 'LOCAL SPORTS CLUB 2', null),
      txn('3', 'LOCAL SPORTS CLUB 3', null, 'user'), // you cleared it on purpose
      txn('4', 'SOMETHING ELSE', null),
      txn('5', 'LOCAL SPORTS CLUB 4', 'gym', 'user'), // already categorised: left alone
    ];
    // Mixed history (fun, gym) for this merchant -> not confident; drop #5 to make it unanimous.
    expect(autoApplyPending(all, { rules: [], categories: cats, ownSuffixes: [] })).toEqual([]);
    const applied = autoApplyPending(all.slice(0, 4), { rules: [], categories: cats, ownSuffixes: [] });
    expect(applied.map((t) => [t.id, t.categoryId, t.categorySource])).toEqual([['2', 'fun', 'auto']]);
  });

  it('applies to similar rows on the import review screen', () => {
    const rows = buildRows(
      [
        { date: '2026-10-01', description: 'LOCAL SPORTS CLUB 1', amount: -1200, warnings: [] },
        { date: '2026-10-08', description: 'LOCAL SPORTS CLUB 2', amount: -1200, warnings: [] },
        { date: '2026-10-09', description: 'LOCAL SPORTS CLUB 3', amount: -1200, warnings: [] },
        { date: '2026-10-10', description: 'OTHER PLACE', amount: -500, warnings: [] },
      ],
      'acc',
      'csv',
      { rules: [], categories: cats, settings: { ownAccountSuffixes: [], notOwnAccountSuffixes: [] }, history: buildHistory([]) },
      new Set(),
      new Set(),
    );
    rows[2].removed = true;
    const batches: ReviewBatch[] = [{ fileName: 'a', accountId: 'acc', warnings: [], rows }];
    const { batches: next, count } = applyToSimilar(batches, rows[0], 'fun');
    expect(count).toBe(1);
    expect(next[0].rows.map((r) => r.categoryId)).toEqual([null, 'fun', null, null]);
    expect(next[0].rows[1]).toMatchObject({ categorySource: 'auto', suggestion: { reason: 'Same as one you approved' } });
  });
});
