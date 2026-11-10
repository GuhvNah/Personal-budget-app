import { formatDate } from './dates';
import { categoryNecessity } from './outgoings';
import type { Account, Category, Transaction } from './types';

/** Quote a CSV cell; text that a spreadsheet would run as a formula gets a leading apostrophe. */
function cell(v: string, text = true): string {
  const safe = text && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Transactions as CSV text (Excel/Sheets friendly): one row each, newest first as given. */
export function transactionsToCsv(txs: Transaction[], categories: Category[], accounts: Account[]): string {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const rows = [['Date', 'Description', 'Amount', 'Category', 'Type', 'Necessary', 'Account', 'Balance', 'Status', 'Notes']];
  for (const t of txs) {
    const c = t.categoryId ? cat.get(t.categoryId) : undefined;
    const necessity = t.necessity ?? (c?.kind === 'expense' ? categoryNecessity(c) : '');
    rows.push([
      formatDate(t.date),
      t.description,
      (t.amount / 100).toFixed(2),
      c?.name ?? 'Uncategorised',
      c ? { expense: 'Spending', income: 'Income', transfer: 'Transfer' }[c.kind] : t.amount < 0 ? 'Spending' : 'Income',
      necessity,
      acc.get(t.accountId) ?? '',
      t.balance === undefined ? '' : (t.balance / 100).toFixed(2),
      t.pending ? 'Pending' : '',
      t.notes ?? '',
    ]);
  }
  // Amount and balance (columns 2 and 7) are numbers, so they keep their minus sign.
  return rows.map((r) => r.map((v, i) => cell(v, i !== 2 && i !== 7)).join(',')).join('\r\n') + '\r\n';
}

/** Save text as a file download. The BOM makes Excel read accents correctly. */
export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
