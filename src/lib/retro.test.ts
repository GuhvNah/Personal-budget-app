import { describe, expect, it } from 'vitest';
import { isManual, matches, planRetro, retroSource } from './retro';
import type { Transaction } from './types';

const t = (
  id: string,
  description: string,
  categoryId: string | null,
  categorySource?: Transaction['categorySource'],
) => ({ id, description, categoryId, categorySource });

describe('isManual', () => {
  it('only protects categories you picked yourself (or cleared on purpose)', () => {
    expect(isManual(t('1', 'x', 'a', 'user'))).toBe(true);
    expect(isManual(t('2', 'x', null, 'user'))).toBe(true);
    expect(isManual(t('3', 'x', 'a'))).toBe(false); // saved before categorySource existed
    expect(isManual(t('3b', 'x', 'a', 'approved'))).toBe(false); // approved suggestion
    expect(isManual(t('4', 'x', null))).toBe(false);
    expect(isManual(t('5', 'x', 'a', 'auto'))).toBe(false);
    expect(isManual(t('6', 'x', 'a', 'rule'))).toBe(false);
    expect(isManual(t('7', 'x', 'a', 'transfer'))).toBe(false);
  });
});

describe('matches', () => {
  it('by merchant ignores store numbers; by rule uses "contains"', () => {
    expect(matches('WOOLWORTHS 1234 PERTH', { merchantOf: 'WOOLWORTHS 4021 PERTH AU' })).toBe(true);
    expect(matches('WOOLWORTHS MIDLAND', { merchantOf: 'WOOLWORTHS 4021 PERTH' })).toBe(false);
    expect(matches('WOOLWORTHS MIDLAND', { pattern: 'woolworths' })).toBe(true);
  });
});

describe('planRetro', () => {
  const items = [
    t('src', 'WOOLWORTHS 1 PERTH', 'gifts', 'user'), // the one you just changed
    t('a', 'WOOLWORTHS 2 PERTH', 'groc', 'auto'), // auto-categorised -> changes
    t('b', 'WOOLWORTHS 3 PERTH', null), // pending -> changes
    t('c', 'WOOLWORTHS 4 PERTH', 'groc', 'user'), // your own choice -> skipped
    t('d', 'WOOLWORTHS 5 PERTH', 'gifts', 'auto'), // already there -> ignored
    t('g', 'WOOLWORTHS 6 PERTH', 'groc'), // older import -> changes
    t('h', 'WOOLWORTHS 7 PERTH', 'groc', 'approved'), // approved suggestion -> changes
    t('e', 'WOOLWORTHS MIDLAND', 'groc', 'rule'), // different merchant
    t('f', 'COLES PERTH', 'groc', 'auto'),
  ];

  it('changes matching transactions except ones you chose yourself', () => {
    const r = planRetro(items, { merchantOf: 'WOOLWORTHS 1 PERTH' }, 'gifts', (x) => x.id === 'src');
    expect(r.change.map((x) => x.id)).toEqual(['a', 'b', 'g', 'h']);
    expect(r).toMatchObject({ manual: 1, skipped: 1 });
  });

  it('can also change ones you picked yourself', () => {
    const r = planRetro(items, { merchantOf: 'WOOLWORTHS 1 PERTH' }, 'gifts', (x) => x.id === 'src', true);
    expect(r.change.map((x) => x.id)).toEqual(['a', 'b', 'c', 'g', 'h']);
    expect(r).toMatchObject({ manual: 1, skipped: 0 });
  });

  it('with a rule, matches everything containing the text', () => {
    const r = planRetro(items, { pattern: 'WOOLWORTHS' }, 'gifts', (x) => x.id === 'src');
    expect(r.change.map((x) => x.id)).toEqual(['a', 'b', 'g', 'h', 'e']);
    expect(r.skipped).toBe(1);
    expect(retroSource({ pattern: 'x' })).toBe('rule');
    expect(retroSource({ merchantOf: 'x' })).toBe('auto');
  });
});
