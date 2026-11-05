import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, parseCSV } from './csv';

// CommBank NetBank CSV export: no header; date, amount, description, balance.
const COMMBANK_CSV = `02/01/2026,"-102.95","Direct Debit 123456 BUDGET DIRECT 900000000000000001","+5113.92"
05/01/2026,"-100.00","Transfer to xx1111 CommBank app","+5013.92"
16/02/2026,"+852.42","Transfer from CommBank app","+5866.34"
`;

describe('parseCSV', () => {
  it('handles quotes, embedded commas, escaped quotes and CRLF', () => {
    expect(parseCSV('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
  it('skips blank lines and a BOM', () => {
    expect(parseCSV('﻿x,y\n\n1,2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });
});

describe('guessMapping + applyMapping', () => {
  it('auto-detects the CommBank CSV layout', () => {
    const rows = parseCSV(COMMBANK_CSV);
    const m = guessMapping(rows);
    expect(m).toMatchObject({ hasHeader: false, dateCol: 0, amountCol: 1, descCol: 2, balanceCol: 3 });
    const { transactions, errors } = applyMapping(rows, m);
    expect(errors).toEqual([]);
    expect(transactions[0]).toMatchObject({ date: '2026-01-02', amount: -10295, balance: 511392 });
    expect(transactions[2]).toMatchObject({ amount: 85242, description: 'Transfer from CommBank app' });
  });

  it('supports a header row and separate debit/credit columns', () => {
    const rows = parseCSV('Date,Narrative,Debit,Credit\n2026-03-01,Coffee,4.50,\n2026-03-02,Pay,,"1,000.00"\n');
    const m = { ...guessMapping(rows), amountMode: 'split' as const, debitCol: 2, creditCol: 3, balanceCol: -1 };
    expect(m.hasHeader).toBe(true);
    expect(m.dateFormat).toBe('YYYY-MM-DD');
    const { transactions } = applyMapping(rows, m);
    expect(transactions.map((t) => t.amount)).toEqual([-450, 100000]);
  });

  it('can flip signs for banks that show spending as positive', () => {
    const rows = parseCSV('01/03/2026,Coffee,4.50');
    const m = { ...guessMapping(rows), amountCol: 2, descCol: 1, balanceCol: -1, invert: true };
    expect(applyMapping(rows, m).transactions[0].amount).toBe(-450);
  });

  it('reports rows it cannot read', () => {
    const rows = parseCSV('01/03/2026,-4.50,Coffee\n31/02/2026,-1.00,Bad date\n02/03/2026,abc,Bad amount');
    const { transactions, errors } = applyMapping(rows, { ...guessMapping(rows), hasHeader: false, amountCol: 1, descCol: 2 });
    expect(transactions).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Row 2: couldn't read the date/);
  });
});
