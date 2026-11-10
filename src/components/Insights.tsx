import { useMemo, useState } from 'react';
import * as db from '../lib/db';
import { addMonths, formatDate, formatMonth, todayISO } from '../lib/dates';
import { newId } from '../lib/id';
import {
  accountBalances,
  balanceSeries,
  categoryTrends,
  findRecurring,
  goalProgress,
  type AccountBalance,
} from '../lib/insights';
import { centsToInput, dollarsToCents, formatAUD } from '../lib/money';
import type { Goal } from '../lib/types';
import { useStore } from '../store';
import { BalanceChart } from './BalanceChart';
import { NO_FILTERS, type TxFilters } from './Transactions';
import { Empty, Icon, Sheet } from './ui';

export function Insights({ openTransactions }: { openTransactions(f: TxFilters): void }) {
  const { transactions, accounts } = useStore();
  const balances = useMemo(() => accountBalances(transactions, accounts), [transactions, accounts]);

  if (transactions.length === 0) {
    return (
      <div className="screen">
        <h2 className="screen-title">Insights</h2>
        <Empty title="Nothing to show yet">
          <p>Import a statement to see balances, regular payments and trends.</p>
        </Empty>
      </div>
    );
  }
  return (
    <div className="screen insights">
      <h2 className="screen-title">Insights</h2>
      <Balances balances={balances} />
      <Goals balances={balances} />
      <RecurringCard />
      <Trends openTransactions={openTransactions} />
    </div>
  );
}

const RANGES: [string, number | null][] = [
  ['3 months', 3],
  ['6 months', 6],
  ['1 year', 12],
  ['All', null],
];

function Balances({ balances }: { balances: AccountBalance[] }) {
  const { transactions } = useStore();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [months, setMonths] = useState<number | null>(6);
  const selected = balances.find((b) => b.account.id === accountId) ?? balances[0];
  const series = useMemo(() => {
    if (!selected) return [];
    const all = balanceSeries(transactions, selected.account.id);
    if (months === null || all.length === 0) return all;
    const from = `${addMonths(all[all.length - 1].date.slice(0, 7), -months)}-${all[all.length - 1].date.slice(8)}`;
    return all.filter((p) => p.date >= from);
  }, [transactions, selected, months]);
  const total = balances.reduce((s, b) => s + b.balance, 0);

  return (
    <section className="card">
      <h3>Account balances</h3>
      {balances.length === 0 ? (
        <p className="hint">
          Balances come from your statements. Import a PDF statement, or a CSV with a balance column, to see them here.
        </p>
      ) : (
        <>
          <ul className="plain-list">
            {balances.map((b) => (
              <li key={b.account.id}>
                <button
                  className={`row-btn ${b.account.id === selected.account.id ? 'active' : ''}`}
                  onClick={() => setAccountId(b.account.id)}
                  aria-pressed={b.account.id === selected.account.id}
                >
                  <span className="row-main">
                    <span>{b.account.name}</span>
                    <small>as of {formatDate(b.asOf)}</small>
                  </span>
                  <span className="amount">{formatAUD(b.balance)}</span>
                </button>
              </li>
            ))}
          </ul>
          {balances.length > 1 && (
            <p className="total-line">
              <span>Total</span>
              <b>{formatAUD(total)}</b>
            </p>
          )}
          <h4>{selected.account.name} over time</h4>
          <div className="segmented small" role="radiogroup" aria-label="Time range">
            {RANGES.map(([label, m]) => (
              <button key={label} aria-pressed={months === m} onClick={() => setMonths(m)}>
                {label}
              </button>
            ))}
          </div>
          <BalanceChart points={series} />
        </>
      )}
    </section>
  );
}

function Goals({ balances }: { balances: AccountBalance[] }) {
  const store = useStore();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const today = todayISO();
  return (
    <section className="card">
      <h3>Savings goals</h3>
      {store.goals.length === 0 && (
        <p className="hint">Set a target for an account, such as your offset, and track how close its balance is.</p>
      )}
      <ul className="plain-list">
        {store.goals.map((g) => {
          const p = goalProgress(g, balances, today);
          const account = store.accounts.find((a) => a.id === g.accountId);
          return (
            <li key={g.id}>
              <button className="goal-row" onClick={() => setEditing(g)}>
                <span className="budget-top">
                  <span className="budget-name">{g.name}</span>
                  <span className="budget-nums">
                    {p.balance === null ? '—' : formatAUD(p.balance, { whole: true })}
                    <span className="muted"> / {formatAUD(g.target, { whole: true })}</span>
                  </span>
                </span>
                <span className="meter" aria-hidden="true">
                  <span className="meter-fill" style={{ width: `${p.fraction * 100}%` }} />
                </span>
                <span className="status">
                  {p.balance === null ? (
                    `No balance yet for ${account?.name ?? 'that account'}. Import a statement.`
                  ) : p.reached ? (
                    <>
                      <Icon name="check" size={16} /> Reached
                    </>
                  ) : (
                    <>
                      {Math.round(p.fraction * 100)}% · {formatAUD(p.remaining, { whole: true })} to go
                      {p.perMonth !== null && ` · ${formatAUD(p.perMonth, { whole: true })} a month to reach it by ${formatDate(g.targetDate!)}`}
                      {g.targetDate && g.targetDate <= today && ' · target date has passed'}
                    </>
                  )}
                </span>
                <small className="muted">
                  {account?.name ?? 'Account removed'}
                  {p.asOf && ` · balance as of ${formatDate(p.asOf)}`}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn wide" onClick={() => setEditing('new')}>
        Add a goal
      </button>
      {editing && <GoalEditor goal={editing === 'new' ? null : editing} balances={balances} onClose={() => setEditing(null)} />}
    </section>
  );
}

function GoalEditor({ goal, balances, onClose }: { goal: Goal | null; balances: AccountBalance[]; onClose(): void }) {
  const store = useStore();
  // Accounts with a known balance first: a goal can only track those.
  const options = [
    ...balances.map((b) => b.account),
    ...store.accounts.filter((a) => !balances.some((b) => b.account.id === a.id)),
  ];
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToInput(goal.target) : '');
  const [accountId, setAccountId] = useState(goal?.accountId ?? options[0]?.id ?? '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '');
  const [error, setError] = useState('');

  async function save() {
    const cents = dollarsToCents(target);
    if (!name.trim()) return setError('Give the goal a name.');
    if (!cents) return setError('Enter a target amount, e.g. 10000');
    if (!accountId) return setError('Choose an account.');
    await db.putGoal({
      id: goal?.id ?? newId(),
      name: name.trim(),
      target: cents,
      accountId,
      targetDate: targetDate || undefined,
      createdAt: goal?.createdAt ?? Date.now(),
    });
    await store.reload();
    store.toast(goal ? 'Goal updated' : 'Goal added');
    onClose();
  }

  return (
    <Sheet
      title={goal ? 'Edit goal' : 'Add a goal'}
      onClose={onClose}
      footer={
        <>
          {goal && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Delete the goal “${goal.name}”?`)) return;
                await db.deleteGoal(goal.id);
                await store.reload();
                store.toast('Goal deleted');
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button className="btn primary grow" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} placeholder="e.g. Emergency buffer" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Target balance ($)</span>
        <input inputMode="decimal" value={target} placeholder="10000" onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label className="field">
        <span>Account to track</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {options.map((a) => {
            const b = balances.find((x) => x.account.id === a.id);
            return (
              <option key={a.id} value={a.id}>
                {a.name} {b ? `(${formatAUD(b.balance, { whole: true })})` : '(no balance yet)'}
              </option>
            );
          })}
        </select>
      </label>
      <label className="field">
        <span>Reach it by (optional)</span>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </label>
      <p className="hint">Progress follows the account's latest balance each time you import a statement.</p>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

const FREQUENCY_LABEL = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

function RecurringCard() {
  const { transactions, categories } = useStore();
  const today = todayISO();
  const items = useMemo(() => findRecurring(transactions, categories, today), [transactions, categories, today]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const monthly = items.reduce((s, r) => s + r.monthly, 0);
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);

  return (
    <section className="card">
      <h3>Regular payments</h3>
      {items.length === 0 ? (
        <p className="hint">
          None found yet. A payment shows here once the same merchant has charged a similar amount at a steady interval
          at least 3 times.
        </p>
      ) : (
        <>
          <p className="hint">
            {items.length} regular payment{items.length === 1 ? '' : 's'}, about <b>{formatAUD(monthly, { whole: true })}</b> a
            month. Next dates are estimates from past payments.
          </p>
          <ul className="plain-list">
            {items.map((r) => {
              const d = days(r.nextDate);
              return (
                <li key={r.key} className="recurring-row">
                  <span className="row-main">
                    <span className="tx-desc">{r.name}</span>
                    <small>
                      {FREQUENCY_LABEL[r.frequency]}
                      {r.categoryId && ` · ${catName.get(r.categoryId) ?? ''}`} · next {formatDate(r.nextDate)}{' '}
                      {d < 0 ? `(expected ${-d} day${d === -1 ? '' : 's'} ago)` : d === 0 ? '(today)' : `(in ${d} day${d === 1 ? '' : 's'})`}
                    </small>
                    {r.previousAmount !== undefined && (
                      <span className="status warning">
                        <Icon name="alert" size={16} /> {r.amount > r.previousAmount ? 'Went up' : 'Went down'} from{' '}
                        {formatAUD(r.previousAmount)} on {formatDate(r.changedOn!)}
                      </span>
                    )}
                  </span>
                  <span className="amount">{formatAUD(r.amount)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Trends({ openTransactions }: { openTransactions(f: TxFilters): void }) {
  const { transactions, categories } = useStore();
  const thisMonth = todayISO().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const rows = useMemo(() => categoryTrends(transactions, categories, month), [transactions, categories, month]);
  const prevLabel = formatMonth(addMonths(month, -1)).split(' ')[0];
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

  return (
    <section className="card">
      <h3>Trends by category</h3>
      <div className="period-nav">
        <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month (trends)">
          <Icon name="left" />
        </button>
        <span>{formatMonth(month, true)}</span>
        <button
          className="icon-btn"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month >= thisMonth}
          aria-label="Next month (trends)"
        >
          <Icon name="right" />
        </button>
      </div>
      {month === thisMonth && <p className="hint">This month is still in progress, so it will look low until it ends.</p>}
      {rows.length === 0 ? (
        <p className="hint center">No spending to compare.</p>
      ) : (
        <ul className="plain-list trends">
          {rows.map((t) => {
            const diff = t.current - t.previous;
            return (
              <li key={t.category?.id ?? 'none'}>
                <button
                  className="row-btn"
                  onClick={() =>
                    openTransactions({
                      ...NO_FILTERS,
                      from: `${month}-01`,
                      to: `${month}-${String(lastDay).padStart(2, '0')}`,
                      category: t.category?.id ?? 'none',
                    })
                  }
                >
                  <span className="row-main">
                    <span>{t.category?.name ?? 'Uncategorised'}</span>
                    <small className="trend-line">
                      {diff === 0 ? (
                        `Same as ${prevLabel}`
                      ) : (
                        <>
                          <Icon name={diff > 0 ? 'up' : 'down'} size={14} />
                          {formatAUD(Math.abs(diff), { whole: true })} {diff > 0 ? 'more' : 'less'} than {prevLabel}
                        </>
                      )}
                      {t.average > 0 && ` · usually ${formatAUD(t.average, { whole: true })}`}
                    </small>
                  </span>
                  <span className="amount">{formatAUD(t.current, { whole: true })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
