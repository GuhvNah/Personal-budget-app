import { parseDate, type DateFormat } from '../lib/dates';
import { parseMoney } from '../lib/money';
import type { ParsedTransaction } from './types';

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes and CRLF. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface CsvMapping {
  hasHeader: boolean;
  dateCol: number;
  dateFormat: DateFormat;
  descCol: number;
  /** 'single' = one signed amount column; 'split' = separate debit & credit columns. */
  amountMode: 'single' | 'split';
  amountCol: number;
  debitCol: number;
  creditCol: number;
  /** -1 when the file has no balance column. */
  balanceCol: number;
  /** Flip the sign of single amounts (for banks that show spending as positive). */
  invert: boolean;
}

export interface CsvResult {
  transactions: ParsedTransaction[];
  errors: string[];
}

const FORMATS: DateFormat[] = ['DD/MM/YYYY', 'YYYY-MM-DD', 'D Mon YYYY', 'MM/DD/YYYY'];

function isDate(v: string, f: DateFormat) {
  return parseDate(v, f) !== null;
}
function isMoney(v: string) {
  return v.trim() !== '' && parseMoney(v) !== null;
}

/** Make a best guess at the column mapping. CommBank CSV: date, amount, description, balance. */
export function guessMapping(rows: string[][]): CsvMapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.slice(1, 21).length ? rows.slice(1, 21) : rows;
  const col = (i: number) => sample.map((r) => r[i] ?? '');
  const share = (vals: string[], pred: (v: string) => boolean) =>
    vals.filter(pred).length / Math.max(1, vals.filter((v) => v.trim()).length);

  let dateCol = 0;
  let dateFormat: DateFormat = 'DD/MM/YYYY';
  outer: for (let i = 0; i < width; i++) {
    for (const f of FORMATS) {
      if (share(col(i), (v) => isDate(v, f)) > 0.8) {
        dateCol = i;
        dateFormat = f;
        break outer;
      }
    }
  }
  const moneyCols: number[] = [];
  for (let i = 0; i < width; i++) {
    if (i !== dateCol && share(col(i), isMoney) > 0.8) moneyCols.push(i);
  }
  let descCol = -1;
  let longest = -1;
  for (let i = 0; i < width; i++) {
    if (i === dateCol || moneyCols.includes(i)) continue;
    const avg = col(i).reduce((s, v) => s + v.length, 0);
    if (avg > longest) {
      longest = avg;
      descCol = i;
    }
  }
  const first = rows[0] ?? [];
  const hasHeader = !isDate(first[dateCol] ?? '', dateFormat);
  return {
    hasHeader,
    dateCol,
    dateFormat,
    descCol: descCol === -1 ? Math.min(1, width - 1) : descCol,
    amountMode: 'single',
    amountCol: moneyCols[0] ?? -1,
    debitCol: moneyCols[0] ?? -1,
    creditCol: moneyCols[1] ?? -1,
    balanceCol: moneyCols[1] ?? -1,
    invert: false,
  };
}

export function applyMapping(rows: string[][], m: CsvMapping): CsvResult {
  const transactions: ParsedTransaction[] = [];
  const errors: string[] = [];
  const body = m.hasHeader ? rows.slice(1) : rows;
  body.forEach((r, idx) => {
    const rowNo = idx + 1 + (m.hasHeader ? 1 : 0);
    const date = parseDate(r[m.dateCol] ?? '', m.dateFormat);
    let amount: number | null;
    if (m.amountMode === 'single') {
      amount = parseMoney(r[m.amountCol] ?? '');
      if (amount !== null && m.invert) amount = -amount;
    } else {
      const debit = (r[m.debitCol] ?? '').trim() ? parseMoney(r[m.debitCol]) : 0;
      const credit = (r[m.creditCol] ?? '').trim() ? parseMoney(r[m.creditCol]) : 0;
      amount = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit);
    }
    const description = (r[m.descCol] ?? '').replace(/\s+/g, ' ').trim();
    if (!date) return errors.push(`Row ${rowNo}: couldn't read the date "${r[m.dateCol] ?? ''}"`);
    if (amount === null) return errors.push(`Row ${rowNo}: couldn't read the amount`);
    const balance = m.balanceCol >= 0 ? parseMoney(r[m.balanceCol] ?? '') : null;
    transactions.push({
      date,
      description,
      amount,
      balance: balance ?? undefined,
      warnings: description ? [] : ['No description.'],
    });
  });
  return { transactions, errors };
}
