import { parseDayMonthName } from '../lib/dates';
import { parseMoney } from '../lib/money';
import {
  ParseError,
  type ParsedAccount,
  type ParsedStatement,
  type ParsedTransaction,
  type StatementParser,
  type StatementPages,
} from './types';

/*
 * CommBank "Transaction Summary" PDF (exported from the CommBank app / NetBank).
 *
 * Layout, once pdf.js text is grouped into lines:
 *
 *   Account Number 062000 12345678
 *   Page 1 of 6
 *   ...
 *   BSB 062000
 *   Account number 12345678
 *   Account type Everyday Offset
 *   Date Transaction details Amount Balance
 *   02 Jan 2026 Direct Debit 123456 SOME COMPANY -$102.95 $5,113.92
 *   900000000000000001                      <- continuation: reference number
 *   18 May 2026 Transfer from xx1234 CommBank app $2,500.00 $4,762.87
 *   wage                                    <- continuation: user's note
 *   Created 05/11/26 09:03pm (Sydney/Melbourne time)   <- page footer
 *   ...
 *
 * Amounts are signed (debits start with "-"). Each row carries a running
 * balance which we use to verify the parse and to detect duplicates.
 */

const MONEY = String.raw`-?\$[\d,]+\.\d{2}`;
const DATE = String.raw`\d{1,2} [A-Za-z]{3} \d{4}`;
const TX_LINE = new RegExp(String.raw`^(${DATE})\s+(.*?)\s*(${MONEY})\s+(${MONEY})$`);
const STARTS_WITH_DATE = new RegExp(String.raw`^${DATE}\b`);
const TABLE_HEADER = /^Date\s+Transaction details\s+Amount\s+Balance$/i;
const TABLE_END = [/^Created \d{2}\/\d{2}\/\d{2}/i, /^Any pending transactions/i];
const VALUE_DATE = /^Value Date:\s*\d{2}\/\d{2}\/\d{4}$/i;
/** Long upper-case/digit tokens containing a digit are bank reference numbers. */
const REFERENCE = /^(?=.*\d)[A-Z0-9]{8,}$/;

function norm(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function readAccount(lines: string[]): ParsedAccount {
  const acc: ParsedAccount = {};
  for (const raw of lines) {
    const line = norm(raw);
    let m = /Account Number (\d{3}-?\d{3}) (\d{4,})/.exec(line);
    if (m && !acc.number) {
      acc.bsb = m[1].replace('-', '');
      acc.number = m[2];
      continue;
    }
    if ((m = /^BSB (\d{3}-?\d{3})$/.exec(line))) acc.bsb ??= m[1].replace('-', '');
    else if ((m = /^Account number (\d{4,})$/.exec(line))) acc.number ??= m[1];
    else if ((m = /^Account type (.+)$/.exec(line))) acc.type ??= m[1];
    else if ((m = /^Account name (.+)$/.exec(line))) acc.name ??= m[1];
  }
  return acc;
}

/** Flag rows whose running balance doesn't match previous balance + amount. */
export function checkBalances(txs: ParsedTransaction[]): void {
  if (txs.length < 2 || txs.some((t) => t.balance === undefined)) return;
  const bal = (i: number) => txs[i].balance as number;
  // Statements are normally oldest-first, but tolerate newest-first exports.
  const asc: number[] = [];
  const desc: number[] = [];
  for (let i = 1; i < txs.length; i++) {
    if (bal(i - 1) + txs[i].amount !== bal(i)) asc.push(i);
    if (bal(i) + txs[i - 1].amount !== bal(i - 1)) desc.push(i - 1);
  }
  const bad = desc.length < asc.length ? desc : asc;
  for (const i of bad) {
    txs[i].warnings.push("Balance doesn't add up – check this amount against your statement.");
  }
}

export const commbankTransactionSummary: StatementParser = {
  id: 'commbank-transaction-summary',
  name: 'CommBank – Transaction Summary',

  detect(pages: StatementPages): boolean {
    const all = pages.flat().map(norm);
    return (
      all.some((l) => /Transaction Summary v\d/i.test(l) || /commbank/i.test(l)) &&
      all.some((l) => TABLE_HEADER.test(l))
    );
  },

  parse(pages: StatementPages): ParsedStatement {
    const transactions: ParsedTransaction[] = [];
    const warnings: string[] = [];
    let current: ParsedTransaction | null = null;

    pages.forEach((page, p) => {
      let inTable = false;
      current = null; // a transaction never continues across a page break
      for (const raw of page) {
        const line = norm(raw);
        if (!line) continue;
        if (TABLE_HEADER.test(line)) {
          inTable = true;
          continue;
        }
        if (TABLE_END.some((re) => re.test(line))) {
          inTable = false;
          current = null;
          continue;
        }
        if (!inTable) continue;

        const m = TX_LINE.exec(line);
        if (m) {
          const date = parseDayMonthName(m[1]);
          const amount = parseMoney(m[3]);
          const balance = parseMoney(m[4]);
          if (!date || amount === null || balance === null) {
            warnings.push(`Page ${p + 1}: couldn't read "${line}"`);
            current = null;
            continue;
          }
          current = { date, description: m[2], amount, balance, warnings: [] };
          if (!m[2]) current.warnings.push('No description found.');
          transactions.push(current);
          continue;
        }
        if (STARTS_WITH_DATE.test(line)) {
          // Looks like a transaction row but we couldn't split it up.
          warnings.push(`Page ${p + 1}: couldn't read "${line}"`);
          current = null;
          continue;
        }
        if (!current) {
          warnings.push(`Page ${p + 1}: ignored unexpected text "${line}"`);
          continue;
        }
        if (VALUE_DATE.test(line)) continue;
        if (REFERENCE.test(line)) {
          current.reference = current.reference ? `${current.reference} ${line}` : line;
        } else {
          current.description = `${current.description} ${line}`.trim();
        }
      }
    });

    if (transactions.length === 0) {
      throw new ParseError(
        'This looks like a CommBank Transaction Summary, but no transactions were found in it.',
      );
    }
    checkBalances(transactions);

    return {
      parserId: this.id,
      bankName: 'CommBank',
      account: readAccount(pages.flat()),
      transactions,
      warnings,
    };
  },
};
