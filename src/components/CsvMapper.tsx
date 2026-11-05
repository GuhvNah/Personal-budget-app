import { useMemo, useState } from 'react';
import { applyMapping, type CsvMapping } from '../parsers/csv';
import type { ParsedTransaction } from '../parsers/types';
import type { DateFormat } from '../lib/dates';
import { formatDate } from '../lib/dates';
import { useStore } from '../store';
import { Amount } from './ui';

export const NEW_ACCOUNT = '__new__';

export function CsvMapper({
  fileName,
  rows,
  initial,
  onCancel,
  onContinue,
}: {
  fileName: string;
  rows: string[][];
  initial: CsvMapping;
  onCancel(): void;
  onContinue(txs: ParsedTransaction[], accountId: string, newAccountName: string): void;
}) {
  const { accounts } = useStore();
  const [m, setM] = useState(initial);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? NEW_ACCOUNT);
  const [newName, setNewName] = useState(fileName.replace(/\.csv$/i, ''));
  const set = (patch: Partial<CsvMapping>) => setM({ ...m, ...patch });
  const width = Math.max(...rows.map((r) => r.length));
  const header = m.hasHeader ? rows[0] : null;
  const colLabel = (i: number) => {
    const sample = (m.hasHeader ? rows[1] : rows[0])?.[i] ?? '';
    return `${String.fromCharCode(65 + i)}${header?.[i] ? ` – ${header[i]}` : ''}${sample ? ` (e.g. ${sample.slice(0, 24)})` : ''}`;
  };
  const result = useMemo(() => applyMapping(rows, m), [rows, m]);

  const colSelect = (value: number, onChange: (v: number) => void, optional = false) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {optional && <option value={-1}>(none)</option>}
      {Array.from({ length: width }, (_, i) => (
        <option key={i} value={i}>
          {colLabel(i)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="screen">
      <h2 className="screen-title">Map CSV columns</h2>
      <p className="hint">{fileName} · {rows.length} rows</p>

      <div className="card">
        <label className="field">
          <span>Import into account</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value={NEW_ACCOUNT}>+ New account…</option>
          </select>
        </label>
        {accountId === NEW_ACCOUNT && (
          <label className="field">
            <span>New account name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={m.hasHeader} onChange={(e) => set({ hasHeader: e.target.checked })} />
          <span>First row is a header</span>
        </label>
        <label className="field">
          <span>Date column</span>
          {colSelect(m.dateCol, (v) => set({ dateCol: v }))}
        </label>
        <label className="field">
          <span>Date format</span>
          <select value={m.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="D Mon YYYY">02 Jan 2026</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          </select>
        </label>
        <label className="field">
          <span>Description column</span>
          {colSelect(m.descCol, (v) => set({ descCol: v }))}
        </label>
        <div className="segmented">
          <button aria-pressed={m.amountMode === 'single'} onClick={() => set({ amountMode: 'single' })}>
            One amount column
          </button>
          <button aria-pressed={m.amountMode === 'split'} onClick={() => set({ amountMode: 'split' })}>
            Debit & credit columns
          </button>
        </div>
        {m.amountMode === 'single' ? (
          <>
            <label className="field">
              <span>Amount column</span>
              {colSelect(m.amountCol, (v) => set({ amountCol: v }))}
            </label>
            <label className="check">
              <input type="checkbox" checked={m.invert} onChange={(e) => set({ invert: e.target.checked })} />
              <span>Spending is shown as positive numbers (flip signs)</span>
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Debit (money out) column</span>
              {colSelect(m.debitCol, (v) => set({ debitCol: v }))}
            </label>
            <label className="field">
              <span>Credit (money in) column</span>
              {colSelect(m.creditCol, (v) => set({ creditCol: v }))}
            </label>
          </>
        )}
        <label className="field">
          <span>Balance column (optional – improves duplicate detection)</span>
          {colSelect(m.balanceCol, (v) => set({ balanceCol: v }), true)}
        </label>
      </div>

      <div className="card">
        <h3>Preview</h3>
        {result.errors.length > 0 && (
          <div className="banner warn">
            {result.errors.length} row{result.errors.length === 1 ? '' : 's'} can't be read and will be skipped
            {result.errors.length <= 3 ? `: ${result.errors.join('; ')}` : ` (first: ${result.errors[0]})`}
          </div>
        )}
        <ul className="preview-list">
          {result.transactions.slice(0, 5).map((t, i) => (
            <li key={i}>
              <span>{formatDate(t.date)}</span>
              <span className="tx-desc">{t.description}</span>
              <Amount cents={t.amount} />
            </li>
          ))}
        </ul>
      </div>

      <div className="action-bar">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary grow"
          disabled={result.transactions.length === 0 || (accountId === NEW_ACCOUNT && !newName.trim())}
          onClick={() => onContinue(result.transactions, accountId, newName.trim())}
        >
          Review {result.transactions.length}
        </button>
      </div>
    </div>
  );
}
