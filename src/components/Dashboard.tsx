import { useMemo } from 'react';
import { addMonths, formatMonth, todayISO } from '../lib/dates';
import { budgetPace } from '../lib/insights';
import { formatAUD } from '../lib/money';
import { budgetRows, recentMonths, summariseMonth } from '../lib/stats';
import { useStore } from '../store';
import { OutgoingsCard } from './OutgoingsCard';
import { SpendingChart } from './SpendingChart';
import { Empty, Icon } from './ui';
import type { TxFilters } from './Transactions';
import { NO_FILTERS } from './Transactions';

function monthRange(month: string): Pick<TxFilters, 'from' | 'to'> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function chartEnd(month: string, thisMonth: string): string {
  const later = addMonths(month, 2);
  if (month >= thisMonth) return month;
  return later > thisMonth ? thisMonth : later;
}

export function Dashboard({
  month,
  setMonth,
  openTransactions,
  goImport,
}: {
  month: string;
  setMonth(m: string): void;
  openTransactions(f: TxFilters): void;
  goImport(): void;
}) {
  const { transactions, categories, budgets } = useStore();
  const today = todayISO();
  const thisMonth = today.slice(0, 7);

  const summary = useMemo(() => summariseMonth(month, transactions, categories), [month, transactions, categories]);
  const rows = useMemo(() => budgetRows(summary, categories, budgets), [summary, categories, budgets]);
  const chart = useMemo(
    () =>
      // Six months ending at the selected month, or a little after it so the
      // selected bar isn't always pinned to the right edge.
      recentMonths(chartEnd(month, thisMonth), 6).map((m) => ({
        month: m,
        spending: summariseMonth(m, transactions, categories).spending,
      })),
    [month, thisMonth, transactions, categories],
  );
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  // How many purchases each category has this month (for the pace warning).
  const purchases = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.date.slice(0, 7) === month && t.amount < 0) m.set(t.categoryId ?? '', (m.get(t.categoryId ?? '') ?? 0) + 1);
    }
    return m;
  }, [transactions, month]);
  // Overall pace counts only spending in categories that have a budget.
  const budgetedSpend = rows.filter((r) => r.budget > 0).reduce((s, r) => s + r.spent, 0);
  const overall = budgetPace(budgetedSpend, totalBudget, month, today);
  const net = summary.income - summary.spending;

  if (transactions.length === 0) {
    return (
      <div className="screen">
        <Empty title="Welcome 👋">
          <p>Import a CommBank statement PDF (or a CSV) to get started. Everything stays on this phone.</p>
          <button className="btn primary" onClick={goImport}>
            Import a statement
          </button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="month-nav">
        <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          <Icon name="left" />
        </button>
        <h2>{formatMonth(month, true)}</h2>
        <button
          className="icon-btn"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month >= thisMonth}
          aria-label="Next month"
        >
          <Icon name="right" />
        </button>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">Income</span>
          <span className="tile-value">{formatAUD(summary.income, { whole: true })}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Spending</span>
          <span className="tile-value">{formatAUD(summary.spending, { whole: true })}</span>
          {totalBudget > 0 && <span className="tile-sub">of {formatAUD(totalBudget, { whole: true })} budget</span>}
        </div>
        <div className="tile">
          <span className="tile-label">Net</span>
          <span className={`tile-value ${net < 0 ? 'neg' : ''}`}>{formatAUD(net, { whole: true })}</span>
        </div>
      </div>

      <section className="card">
        <h3>Spending vs budget</h3>
        {overall && (
          <p className="pace-summary">
            {overall.left >= 0 ? (
              <>
                <b>{formatAUD(overall.left, { whole: true })}</b> of your budgets left for the next {overall.daysLeft} day
                {overall.daysLeft === 1 ? '' : 's'}, about <b>{formatAUD(overall.perDay, { whole: true })}</b> a day.
              </>
            ) : (
              <>
                You're <b>{formatAUD(-overall.left, { whole: true })}</b> over your budgets this month.
              </>
            )}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="hint">No spending this month. Set budgets in Settings.</p>
        ) : (
          <ul className="budget-list">
            {rows.map((r) => {
              const over = r.budget > 0 && r.spent > r.budget;
              const pct = r.budget > 0 ? Math.min(100, (Math.max(r.spent, 0) / r.budget) * 100) : 0;
              const pace = budgetPace(r.spent, r.budget, month, today, purchases.get(r.category?.id ?? '') ?? 0);
              return (
                <li key={r.category?.id ?? 'none'}>
                  <button
                    className="budget-row"
                    onClick={() =>
                      openTransactions({
                        ...NO_FILTERS,
                        ...monthRange(month),
                        category: r.category?.id ?? 'none',
                      })
                    }
                  >
                    <span className="budget-top">
                      <span className="budget-name">{r.category?.name ?? 'Uncategorised'}</span>
                      <span className="budget-nums">
                        {formatAUD(r.spent, { whole: true })}
                        {r.budget > 0 && <span className="muted"> / {formatAUD(r.budget, { whole: true })}</span>}
                      </span>
                    </span>
                    {r.budget > 0 && (
                      <span className="meter" aria-hidden="true">
                        <span className={`meter-fill ${over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                      </span>
                    )}
                    {over ? (
                      <span className="status critical">
                        <Icon name="alert" size={16} /> Over by {formatAUD(r.spent - r.budget, { whole: true })}
                      </span>
                    ) : pace ? (
                      <span className={`status ${pace.status === 'ahead' ? 'warning' : ''}`}>
                        {pace.status === 'ahead' && <Icon name="alert" size={16} />}
                        {formatAUD(pace.left, { whole: true })} left · {pace.daysLeft} day{pace.daysLeft === 1 ? '' : 's'} to
                        go · about {formatAUD(pace.perDay, { whole: true })} a day
                        {pace.status === 'ahead' ? ' · ahead of pace for this point in the month' : ''}
                      </span>
                    ) : r.budget > 0 ? (
                      <span className="status">{formatAUD(r.budget - r.spent, { whole: true })} left</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <OutgoingsCard month={month} openTransactions={(f) => openTransactions({ ...NO_FILTERS, ...f })} />

      <section className="card">
        <h3>Spending by month</h3>
        <SpendingChart data={chart} selected={month} onSelect={setMonth} />
      </section>
    </div>
  );
}
