import { useMemo, useState } from 'react';
import { matchText } from '../lib/categorise';
import { formatDate } from '../lib/dates';
import { dollarsToCents, formatAUD } from '../lib/money';
import type { Transaction } from '../lib/types';
import { useStore } from '../store';
import { ReviewQueue } from './ReviewQueue';
import { TransactionEditor } from './TransactionEditor';
import { Amount, Empty, Icon, Sheet } from './ui';

export interface TxFilters {
  from: string;
  to: string;
  /** '' = any, 'none' = uncategorised, otherwise a category id */
  category: string;
  account: string;
  min: string;
  max: string;
  direction: '' | 'out' | 'in';
}

export const NO_FILTERS: TxFilters = {
  from: '',
  to: '',
  category: '',
  account: '',
  min: '',
  max: '',
  direction: '',
};

export function filterTransactions(txs: Transaction[], q: string, f: TxFilters): Transaction[] {
  const query = matchText(q);
  const min = dollarsToCents(f.min);
  const max = dollarsToCents(f.max);
  return txs.filter((t) => {
    if (query && !matchText(`${t.description} ${t.notes ?? ''} ${t.reference ?? ''}`).includes(query))
      return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.category === 'none' ? t.categoryId !== null : f.category && t.categoryId !== f.category) return false;
    if (f.account && t.accountId !== f.account) return false;
    if (f.direction === 'out' && t.amount >= 0) return false;
    if (f.direction === 'in' && t.amount <= 0) return false;
    const abs = Math.abs(t.amount);
    if (min !== null && abs < min) return false;
    if (max !== null && abs > max) return false;
    return true;
  });
}

const PAGE = 150;

export function Transactions({
  filters,
  setFilters,
}: {
  filters: TxFilters;
  setFilters(f: TxFilters): void;
}) {
  const { transactions, categories, accounts } = useStore();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Transaction | null | 'new'>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [queue, setQueue] = useState(false);
  const toReview = useMemo(() => transactions.filter((t) => t.categoryId === null).length, [transactions]);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const results = useMemo(
    () => filterTransactions(transactions, query, filters),
    [transactions, query, filters],
  );
  const activeFilters = Object.entries(filters).filter(([, v]) => v !== '').length;
  const total = results.reduce((s, t) => s + t.amount, 0);

  const grouped: [string, Transaction[]][] = [];
  for (const t of results.slice(0, limit)) {
    const last = grouped[grouped.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else grouped.push([t.date, [t]]);
  }

  if (queue) return <ReviewQueue onBack={() => setQueue(false)} />;

  return (
    <div className="screen">
      {toReview > 0 && (
        <button className="review-banner" onClick={() => setQueue(true)}>
          <span>
            <b>{toReview}</b> transaction{toReview === 1 ? '' : 's'} to review
            <small>Approve suggested categories or choose your own</small>
          </span>
          <Icon name="right" />
        </button>
      )}
      <div className="toolbar sticky">
        <label className="search">
          <Icon name="search" size={20} />
          <input
            type="search"
            placeholder="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`icon-btn bordered ${activeFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(true)}
          aria-label="Filters"
        >
          <Icon name="filter" />
          {activeFilters > 0 && <span className="badge">{activeFilters}</span>}
        </button>
      </div>

      {transactions.length > 0 && (
        <p className="result-summary">
          {results.length} transaction{results.length === 1 ? '' : 's'} · net {formatAUD(total)}
          {activeFilters > 0 && (
            <button className="link" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </button>
          )}
        </p>
      )}

      {transactions.length === 0 ? (
        <Empty title="No transactions yet">
          <p>Import a bank statement or tap + to add one.</p>
        </Empty>
      ) : results.length === 0 ? (
        <Empty title="Nothing matches" />
      ) : (
        <ul className="tx-list">
          {grouped.map(([date, txs]) => (
            <li key={date}>
              <div className="tx-date">{formatDate(date)}</div>
              {txs.map((t) => (
                <button key={t.id} className="tx-row" onClick={() => setEditing(t)}>
                  <span className="tx-main">
                    <span className="tx-desc">{t.description}</span>
                    <span className={`tx-cat ${t.categoryId ? '' : 'none'}`}>
                      {t.categoryId ? catName.get(t.categoryId) : 'Uncategorised'}
                      {t.categoryId && t.categorySource === 'auto' && <span className="tag">auto</span>}
                      {t.necessity && <span className={`tag ${t.necessity}`}>{t.necessity}</span>}
                      {t.pending && <span className="tag pending">pending</span>}
                      {accounts.length > 1 && ` · ${accounts.find((a) => a.id === t.accountId)?.name ?? ''}`}
                    </span>
                  </span>
                  <Amount cents={t.amount} />
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
      {results.length > limit && (
        <button className="btn wide" onClick={() => setLimit(limit + PAGE)}>
          Show more ({results.length - limit} left)
        </button>
      )}

      <button className="fab" onClick={() => setEditing('new')} aria-label="Add transaction">
        <Icon name="plus" size={28} />
      </button>

      {editing && (
        <TransactionEditor tx={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {showFilters && (
        <FilterSheet
          value={filters}
          onApply={(f) => {
            setFilters(f);
            setShowFilters(false);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}

function FilterSheet({
  value,
  onApply,
  onClose,
}: {
  value: TxFilters;
  onApply(f: TxFilters): void;
  onClose(): void;
}) {
  const { categories, accounts } = useStore();
  const [f, setF] = useState(value);
  const set = (patch: Partial<TxFilters>) => setF({ ...f, ...patch });
  return (
    <Sheet
      title="Filter"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onApply(NO_FILTERS)}>
            Clear all
          </button>
          <button className="btn primary grow" onClick={() => onApply(f)}>
            Apply
          </button>
        </>
      }
    >
      <div className="row2">
        <label className="field">
          <span>From</span>
          <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Category</span>
        <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Any category</option>
          <option value="none">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {accounts.length > 1 && (
        <label className="field">
          <span>Account</span>
          <select value={f.account} onChange={(e) => set({ account: e.target.value })}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="segmented" role="radiogroup" aria-label="Direction">
        {(
          [
            ['', 'All'],
            ['out', 'Money out'],
            ['in', 'Money in'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} aria-pressed={f.direction === v} onClick={() => set({ direction: v })}>
            {label}
          </button>
        ))}
      </div>
      <div className="row2">
        <label className="field">
          <span>Min amount ($)</span>
          <input inputMode="decimal" value={f.min} onChange={(e) => set({ min: e.target.value })} />
        </label>
        <label className="field">
          <span>Max amount ($)</span>
          <input inputMode="decimal" value={f.max} onChange={(e) => set({ max: e.target.value })} />
        </label>
      </div>
    </Sheet>
  );
}

