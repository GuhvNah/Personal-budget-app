import { describe, expect, it } from 'vitest';
import { captureLink, isRepeatCapture, matchCaptured, parseCaptureFragment, parseNotification } from './capture';
import { attachCaptures, buildRows, replacedCaptureIds, rowsToSave, type ReviewBatch } from './importer';
import { buildHistory } from './suggest';
import type { Category, Transaction } from './types';

describe('parseCaptureFragment', () => {
  it('reads an encoded link', () => {
    const link = captureLink('https://x/app/', 'k3y', encodeURIComponent('ALDI Midland'), encodeURIComponent('$12.50 with Visa •• 1234'));
    expect(link.startsWith('https://x/app/#capture=k3y&t=')).toBe(true);
    expect(parseCaptureFragment(link.slice(link.indexOf('#')))).toEqual({
      key: 'k3y',
      title: 'ALDI Midland',
      body: '$12.50 with Visa •• 1234',
    });
  });
  it('copes with text that was not URL-encoded, including "&" and "%"', () => {
    expect(parseCaptureFragment('#capture=k&t=Coles & Co&b=$5.00 off 50% with Visa')).toEqual({
      key: 'k',
      title: 'Coles & Co',
      body: '$5.00 off 50% with Visa',
    });
  });
  it('ignores other links', () => {
    expect(parseCaptureFragment('#something')).toBeNull();
    expect(parseCaptureFragment('')).toBeNull();
  });
});

describe('parseNotification', () => {
  it.each([
    ['ALDI Midland', '$12.50 with Visa •• 1234', -1250, 'ALDI Midland'],
    ['Woolworths Metro', 'A$1,234.56 with Mastercard ••5678', -123456, 'Woolworths Metro'],
    ['Google Wallet', '$8.00 at Muzz Buzz Midvale', -800, 'Muzz Buzz Midvale'],
    ['CommBank', 'You spent $42.10 at BP MIDLAND using your debit card', -4210, 'BP MIDLAND'],
    ['$6.50 at The Corner Cafe', 'Paid with Visa ••1234', -650, 'The Corner Cafe'],
    ['Refund from Kmart', '$20.00 refunded to Visa ••1234', 2000, 'Kmart'],
    ['Google Wallet', '$15.00 paid', -1500, 'Card purchase'],
  ])('%s / %s', (title, body, amount, merchant) => {
    expect(parseNotification(title, body)).toEqual({ amount, merchant });
  });
  it('ignores declined payments and non-payment notifications', () => {
    expect(parseNotification('Payment declined', '$12.50 at ALDI')).toBeNull();
    expect(parseNotification('Google Wallet', 'Your card is ready to use')).toBeNull();
    expect(parseNotification('Hello', 'No money here')).toBeNull();
  });
});

describe('isRepeatCapture', () => {
  const t0 = 1_800_000_000_000;
  const existing = [{ source: 'capture' as const, amount: -1250, createdAt: t0 }];
  it('treats the same amount within 10 minutes as the same purchase', () => {
    expect(isRepeatCapture(-1250, t0 + 60_000, existing)).toBe(true);
    expect(isRepeatCapture(-1250, t0 + 11 * 60_000, existing)).toBe(false);
    expect(isRepeatCapture(-1300, t0 + 60_000, existing)).toBe(false);
  });
});

describe('matchCaptured', () => {
  const pending = [
    { id: 'a', amount: -1250, date: '2026-10-01' },
    { id: 'b', amount: -1250, date: '2026-10-05' },
    { id: 'c', amount: -999, date: '2026-10-01' },
  ];
  it('pairs by amount and closest date, using each capture once', () => {
    const m = matchCaptured(
      [
        { amount: -1250, date: '2026-10-06' }, // -> b (1 day)
        { amount: -1250, date: '2026-10-02' }, // -> a (1 day)
        { amount: -1250, date: '2026-10-03' }, // nothing left
        { amount: -999, date: '2026-10-20' }, // too late for c
      ],
      pending,
    );
    expect([...m].map(([i, c]) => [i, c.id])).toEqual([
      [0, 'b'],
      [1, 'a'],
    ]);
  });
});

describe('attachCaptures', () => {
  const cats: Category[] = [
    { id: 'groc', name: 'Groceries', kind: 'expense', order: 0, builtin: 'groceries' },
    { id: 'gift', name: 'Gifts', kind: 'expense', order: 1 },
  ];
  const capture: Transaction = {
    id: 'cap1',
    accountId: 'acc',
    date: '2026-10-01',
    description: 'ALDI Midland',
    amount: -1250,
    categoryId: 'gift',
    categorySource: 'user',
    necessity: 'unnecessary',
    notes: 'present for Sam',
    dedupeKey: 'capture|cap1',
    source: 'capture',
    pending: true,
    createdAt: 0,
  };
  const rows = buildRows(
    [
      { date: '2026-10-02', description: 'ALDI STORES MIDLAND AU', amount: -1250, balance: 100000, warnings: [] },
      { date: '2026-10-02', description: 'COLES 123', amount: -500, balance: 99500, warnings: [] },
    ],
    'acc',
    'pdf',
    { rules: [], categories: cats, settings: { ownAccountSuffixes: [], notOwnAccountSuffixes: [] }, history: buildHistory([]) },
    new Set(),
    new Set(),
  );
  const batches: ReviewBatch[] = attachCaptures([{ fileName: 'a.pdf', accountId: 'acc', warnings: [], rows }], [capture]);

  it('links the statement line and keeps your category, override and notes', () => {
    const r = batches[0].rows[0];
    expect(r.replacesCapture?.id).toBe('cap1');
    expect(r).toMatchObject({ categoryId: 'gift', categorySource: 'user', necessity: 'unnecessary', notes: 'present for Sam' });
    expect(batches[0].rows[1].replacesCapture).toBeUndefined();
  });

  it('saves the statement version and removes the pending capture', () => {
    expect(replacedCaptureIds(batches)).toEqual(['cap1']);
    const saved = rowsToSave(batches);
    expect(saved[0]).toMatchObject({ description: 'ALDI STORES MIDLAND AU', categoryId: 'gift', necessity: 'unnecessary', source: 'pdf' });
    expect(saved[0].pending).toBeUndefined();
  });

  it('a removed line does not replace the capture', () => {
    const removed = batches.map((b) => ({ ...b, rows: b.rows.map((r, i) => (i === 0 ? { ...r, removed: true } : r)) }));
    expect(replacedCaptureIds(removed)).toEqual([]);
  });
});
