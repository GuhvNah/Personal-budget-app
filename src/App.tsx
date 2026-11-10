import { useEffect, useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Import } from './components/Import';
import { Insights } from './components/Insights';
import { LockScreen, useAppLock } from './components/LockScreen';
import { Settings } from './components/Settings';
import { NO_FILTERS, Transactions, type TxFilters } from './components/Transactions';
import { Icon } from './components/ui';
import { todayISO } from './lib/dates';
import { useStore } from './store';
import { useCapture } from './lib/useCapture';
import { onUpdateReady, updateReady } from './lib/update';

type Tab = 'home' | 'transactions' | 'insights' | 'import' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'transactions', label: 'Transactions', icon: 'list' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'import', label: 'Import', icon: 'upload' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export default function App() {
  const { ready, error, toastMessage, toastAction, transactions } = useStore();
  const lock = useAppLock();
  const [update, setUpdate] = useState(updateReady());
  useEffect(() => onUpdateReady(() => setUpdate(true)), []);
  const toReview = transactions.filter((t) => t.categoryId === null).length;
  const [tab, setTab] = useState<Tab>('home');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [filters, setFilters] = useState<TxFilters>(NO_FILTERS);
  useCapture();

  function go(t: Tab) {
    setTab(t);
    window.scrollTo(0, 0);
  }

  let body;
  if (error) body = <div className="screen"><div className="banner error">{error}</div></div>;
  else if (!ready) body = <div className="screen center-screen"><div className="spinner" /></div>;
  else if (tab === 'home')
    body = (
      <Dashboard
        month={month}
        setMonth={setMonth}
        goImport={() => go('import')}
        openTransactions={(f) => {
          setFilters(f);
          go('transactions');
        }}
      />
    );
  else if (tab === 'transactions') body = <Transactions filters={filters} setFilters={setFilters} />;
  else if (tab === 'insights')
    body = (
      <Insights
        openTransactions={(f) => {
          setFilters(f);
          go('transactions');
        }}
      />
    );
  else if (tab === 'import') body = <Import onDone={() => go('transactions')} />;
  else body = <Settings />;

  return (
    <>
      {update && !lock.locked && (
        <button className="update-banner" onClick={() => window.location.reload()}>
          A new version is ready. <b>Tap to update</b>
        </button>
      )}
      <main inert={lock.locked}>{body}</main>
      {toastMessage && !lock.locked && (
        <div className={`toast ${toastAction ? 'with-action' : ''}`} role="status">
          <span>{toastMessage}</span>
          {toastAction && (
            <button className="toast-action" onClick={() => void toastAction.run()}>
              {toastAction.label}
            </button>
          )}
        </div>
      )}
      {lock.locked && <LockScreen cfg={lock.cfg} onUnlock={lock.unlock} />}
      <nav className="bottom-nav" inert={lock.locked}>
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <span className="nav-icon">
              <Icon name={t.icon} />
              {t.id === 'transactions' && toReview > 0 && (
                <span className="nav-badge" aria-label={`${toReview} to review`}>
                  {toReview > 99 ? '99+' : toReview}
                </span>
              )}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
