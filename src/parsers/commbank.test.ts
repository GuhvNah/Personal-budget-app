import { describe, expect, it } from 'vitest';
import { commbankTransactionSummary as parser } from './commbank';
import { parseStatementPages } from './registry';
import { itemsToLines } from './pdfText';
import { ParseError } from './types';
import { PAGE_1, PAGE_2, PAGE_3, STATEMENT } from './__fixtures__/commbank';

describe('CommBank Transaction Summary parser', () => {
  const result = parser.parse(STATEMENT);
  const txs = result.transactions;

  it('detects the format', () => {
    expect(parser.detect(STATEMENT)).toBe(true);
    expect(parser.detect([['Some other bank statement', 'Date Description Debit Credit']])).toBe(false);
  });

  it('reads the account details', () => {
    expect(result.account).toEqual({
      bsb: '062000',
      number: '12345678',
      name: 'JANE CITIZEN',
      type: 'Everyday Offset',
    });
    expect(result.bankName).toBe('CommBank');
  });

  it('extracts every transaction across pages and ignores letter text', () => {
    expect(txs).toHaveLength(10);
    expect(result.warnings).toEqual([]);
  });

  it('parses dates, signed amounts and balances in cents', () => {
    expect(txs[0]).toMatchObject({
      date: '2026-01-02',
      description: 'Direct Debit 123456 BUDGET DIRECT',
      amount: -10295,
      balance: 511392,
    });
    expect(txs[3]).toMatchObject({ date: '2026-02-16', amount: 85242, balance: 584634 });
  });

  it('handles thousands separators', () => {
    expect(txs[6]).toMatchObject({ amount: 250000, balance: 804634 });
    expect(txs[7]).toMatchObject({ amount: -250000, balance: 554634 });
  });

  it('splits reference numbers out of the description', () => {
    expect(txs[0].reference).toBe('900000000000000001');
    expect(txs[9].reference).toBe('900000000000000002');
  });

  it('appends note continuation lines to the description', () => {
    expect(txs[6].description).toBe('Transfer from xx2222 CommBank app wage');
    expect(txs[8].description).toBe('Fast Transfer From STRIPE PAYMENTS CO EXAMPLESHOP');
    expect(txs[8].reference).toBe('AB12CD34EF56');
  });

  it('drops "Value Date" lines', () => {
    expect(txs[2].description).toBe('Transfer to xx1111 CommBank app');
    expect(txs[2].reference).toBeUndefined();
  });

  it('keeps genuine identical transactions on the same day', () => {
    const same = txs.filter((t) => t.date === '2026-03-26');
    expect(same).toHaveLength(2);
    expect(same.map((t) => t.balance)).toEqual([569634, 554634]);
  });

  it('passes the running-balance check when everything adds up', () => {
    expect(txs.every((t) => t.warnings.length === 0)).toBe(true);
  });

  it('flags a row whose balance does not add up', () => {
    const broken = [PAGE_1.map((l) => l.replace('-$100.00 $5,013.92', '-$10.00 $5,013.92')), PAGE_2];
    const out = parser.parse(broken).transactions;
    expect(out[1].warnings[0]).toMatch(/Balance doesn't add up/);
    expect(out.filter((t) => t.warnings.length)).toHaveLength(1);
  });

  it('copes with newest-first ordering', () => {
    const lines = PAGE_1.slice(14, 22);
    // Re-order groups of (row + its continuation lines) newest first.
    const groups: string[][] = [];
    for (const l of lines) {
      if (/^\d{2} \w{3} \d{4}/.test(l)) groups.push([l]);
      else groups[groups.length - 1].push(l);
    }
    const page = ['Transaction Summary v1.0.5', 'Date Transaction details Amount Balance', ...groups.reverse().flat()];
    const out = parser.parse([page]).transactions;
    expect(out[0].date).toBe('2026-03-26');
    expect(out.every((t) => t.warnings.length === 0)).toBe(true);
  });

  it('does not carry continuation lines across a page break', () => {
    const page2 = ['Date Transaction details Amount Balance', 'stray text before any row', ...PAGE_2.slice(3)];
    const out = parser.parse([PAGE_1, page2]);
    expect(out.transactions[5].description).toBe('Transfer to xx1111 CommBank app');
    expect(out.warnings[0]).toMatch(/ignored unexpected text "stray text before any row"/);
  });

  it('handles indented rows (extra spaces between columns)', () => {
    const page = [
      'Transaction Summary v1.0.5',
      'Date    Transaction details     Amount    Balance',
      '01 Apr 2026              Transfer to xx1111 CommBank app                  -$60.00                 $3,537.86',
    ];
    expect(parser.parse([page]).transactions[0]).toMatchObject({
      date: '2026-04-01',
      description: 'Transfer to xx1111 CommBank app',
      amount: -6000,
    });
  });

  it('handles a negative (overdrawn) balance', () => {
    const page = [
      'Transaction Summary v1.0.5',
      'Date Transaction details Amount Balance',
      '01 Apr 2026 Direct Debit 1 GYM -$60.00 -$12.50',
    ];
    expect(parser.parse([page]).transactions[0]).toMatchObject({ amount: -6000, balance: -1250 });
  });

  it('reports a row it cannot read instead of silently dropping it', () => {
    const page = [
      'Transaction Summary v1.0.5',
      'Date Transaction details Amount Balance',
      '01 Apr 2026 Something odd with no amount',
      '02 Apr 2026 Direct Debit 1 GYM -$60.00 $100.00',
    ];
    const out = parser.parse([page]);
    expect(out.transactions).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/couldn't read "01 Apr 2026 Something odd/);
  });

  it('throws a helpful error when there are no transactions', () => {
    expect(() => parser.parse([PAGE_3.concat('Date Transaction details Amount Balance')])).toThrow(ParseError);
  });
});

describe('parseStatementPages (registry)', () => {
  it('picks the CommBank parser', () => {
    expect(parseStatementPages(STATEMENT).parserId).toBe('commbank-transaction-summary');
  });

  it('explains when a PDF has no text (scanned image)', () => {
    expect(() => parseStatementPages([[], []])).toThrow(/scanned image/);
  });

  it('explains when the format is not recognised', () => {
    expect(() => parseStatementPages([['ACME Bank', 'Your statement']])).toThrow(/isn't a statement format I recognise/);
  });
});

describe('itemsToLines', () => {
  it('groups pdf.js text items into lines, top to bottom and left to right', () => {
    const lines = itemsToLines([
      { str: '$5,113.92', x: 491.5, y: 476.4 },
      { str: '02 Jan 2026', x: 59.5, y: 476.4 },
      { str: '900000000000000001', x: 124.1, y: 464.9 },
      { str: '-$102.95', x: 418.6, y: 476.4 },
      { str: ' ', x: 114.6, y: 476.4 },
      { str: 'Direct Debit 123456 BUDGET DIRECT', x: 124.1, y: 476.4 },
      { str: 'Date', x: 59.5, y: 495.4 },
      { str: 'Transaction details', x: 124.1, y: 495.4 },
      { str: 'Amount', x: 420, y: 495.4 },
      { str: 'Balance', x: 497.5, y: 495.4 },
    ]);
    expect(lines).toEqual([
      'Date Transaction details Amount Balance',
      '02 Jan 2026 Direct Debit 123456 BUDGET DIRECT -$102.95 $5,113.92',
      '900000000000000001',
    ]);
  });

  it('treats slightly offset baselines as the same line', () => {
    expect(itemsToLines([
      { str: 'reliance on this information.', x: 56, y: 14.9 },
      { str: 'Transaction Summary v1.0.5', x: 458, y: 14.4 },
    ])).toEqual(['reliance on this information. Transaction Summary v1.0.5']);
  });
});
