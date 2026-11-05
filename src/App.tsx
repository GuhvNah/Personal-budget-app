import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Import } from './components/Import';
import { Settings } from './components/Settings';
import { NO_FILTERS, Transactions, type TxFilters } from './components/Transactions';
import { Icon } from './components/ui';
import { todayISO } from './lib/dates';
import { useStore } from './store';
import { useCapture } from './lib/useCapture';

type Tab = 'home' | 'transactions' | 'import' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'transactions', label: 'Transactions', icon: 'list' },
  { id: 'import', label: 'Import', icon: 'upload' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export default function App() {
  const { ready, error, toastMessage, transactions } = useStore();
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
  else if (tab === 'import') body = <Import onDone={() => go('transactions')} />;
  else body = <Settings />;

  return (
    <>
      <main>{body}</main>
      {toastMessage && (
        <div className="toast" role="status">
          {toastMessage}
        </div>
      )}
      <nav className="bottom-nav">
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
