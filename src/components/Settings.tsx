import { useRef, useState } from 'react';
import { makeBackup, readBackup } from '../lib/backup';
import * as db from '../lib/db';
import { formatDate, todayISO } from '../lib/dates';
import { newId } from '../lib/id';
import { centsToInput, dollarsToCents } from '../lib/money';
import { categoryNecessity } from '../lib/outgoings';
import type { Category, CategoryKind, Necessity } from '../lib/types';
import { useStore } from '../store';
import { choiceSummary, commitChoice } from './ApplySheet';
import { planRetro } from '../lib/retro';
import { CaptureSettings } from './CaptureSettings';
import { LockSettings } from './LockSettings';
import { downloadText, transactionsToCsv } from '../lib/exportCsv';
import { CategorySelect, Icon, Sheet } from './ui';

const LAST_BACKUP = 'lastBackup';
const KIND_LABEL: Record<CategoryKind, string> = {
  expense: 'Spending',
  income: 'Income',
  transfer: 'Not counted',
};

export function Settings() {
  return (
    <div className="screen settings">
      <h2 className="screen-title">Settings</h2>
      <Categories />
      <Budgets />
      <Rules />
      <Accounts />
      <CaptureSettings />
      <LockSettings />
      <Backup />
      <About />
    </div>
  );
}

function Categories() {
  const store = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [necessity, setNecessity] = useState<Necessity>('necessary');
  const [deleting, setDeleting] = useState<Category | null>(null);

  async function add() {
    const n = name.trim();
    if (!n) return;
    if (store.categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      return store.toast(`There's already a category called ${n}`);
    }
    const order = Math.max(0, ...store.categories.map((c) => c.order)) + 1;
    await db.putCategory({ id: newId(), name: n, kind, order, ...(kind === 'expense' ? { necessity } : {}) });
    setName('');
    await store.reload();
    store.toast(`Added ${n}`);
  }

  async function rename(c: Category, value: string) {
    const n = value.trim();
    if (!n || n === c.name) return;
    await db.putCategory({ ...c, name: n });
    await store.reload();
    store.toast(`Renamed to ${n}`);
  }

  return (
    <section className="card">
      <h3>Categories</h3>
      <p className="hint">
        Tap a name to rename it. Tap <b>Necessary</b> / <b>Unnecessary</b> to change how that category's spending is
        split on the dashboard.
      </p>
      <ul className="settings-list">
        {store.categories.map((c) => (
          <li key={c.id + c.name} className="cat-row">
            <input
              className="inline-input"
              defaultValue={c.name}
              aria-label={`Rename ${c.name}`}
              onBlur={(e) => void rename(c, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {c.kind === 'expense' ? (
              <button
                className={`necessity-btn ${categoryNecessity(c)}`}
                aria-label={`${c.name} is ${categoryNecessity(c)}. Tap to change.`}
                onClick={async () => {
                  const next: Necessity = categoryNecessity(c) === 'necessary' ? 'unnecessary' : 'necessary';
                  await db.putCategory({ ...c, necessity: next });
                  await store.reload();
                  store.toast(`${c.name}: ${next}`);
                }}
              >
                {categoryNecessity(c) === 'necessary' ? 'Necessary' : 'Unnecessary'}
              </button>
            ) : (
              <span className="kind">{KIND_LABEL[c.kind]}</span>
            )}
            {c.system ? (
              <span className="icon-btn placeholder" />
            ) : (
              <button className="icon-btn" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
                <Icon name="trash" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="add-row cat-add">
        <input placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} aria-label="Type">
          <option value="expense">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Not counted</option>
        </select>
        {kind === 'expense' && (
          <select value={necessity} onChange={(e) => setNecessity(e.target.value as Necessity)} aria-label="Necessary?">
            <option value="necessary">Necessary</option>
            <option value="unnecessary">Unnecessary</option>
          </select>
        )}
        <button className="btn primary" onClick={add} disabled={!name.trim()}>
          Add
        </button>
      </div>
      {deleting && <DeleteCategory category={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function DeleteCategory({ category, onClose }: { category: Category; onClose(): void }) {
  const store = useStore();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const count = store.transactions.filter((t) => t.categoryId === category.id).length;
  const rules = store.rules.filter((r) => r.categoryId === category.id).length;
  return (
    <Sheet
      title={`Delete ${category.name}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn danger grow"
            onClick={async () => {
              const undo = await store.undoPoint();
              await db.deleteCategory(category.id, moveTo);
              await store.reload();
              store.toast(`Deleted ${category.name}`, undo);
              onClose();
            }}
          >
            Delete
          </button>
        </>
      }
    >
      <p>
        {count} transaction{count === 1 ? '' : 's'} and {rules} rule{rules === 1 ? '' : 's'} use this category.
      </p>
      <label className="field">
        <span>Move them to</span>
        <CategorySelect
          categories={store.categories.filter((c) => c.id !== category.id)}
          value={moveTo}
          onChange={setMoveTo}
          noneLabel="Uncategorised (rules are deleted)"
        />
      </label>
    </Sheet>
  );
}

function Budgets() {
  const store = useStore();
  const budget = new Map(store.budgets.map((b) => [b.categoryId, b.amount]));
  const expense = store.categories.filter((c) => c.kind === 'expense');
  const total = store.budgets.reduce((s, b) => s + b.amount, 0);
  return (
    <section className="card">
      <h3>Monthly budgets</h3>
      <p className="hint">Leave blank for no budget. Total: ${centsToInput(total)} / month</p>
      <ul className="settings-list">
        {expense.map((c) => (
          <li key={c.id + (budget.get(c.id) ?? 0)} className="budget-edit">
            <label htmlFor={`b-${c.id}`}>{c.name}</label>
            <span className="dollar">
              $
              <input
                id={`b-${c.id}`}
                inputMode="decimal"
                placeholder="0"
                defaultValue={budget.has(c.id) ? centsToInput(budget.get(c.id)!) : ''}
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  const cents = v ? dollarsToCents(v) : 0;
                  if (cents === null) return store.toast('Enter an amount like 450 or 450.00');
                  if (cents === (budget.get(c.id) ?? 0)) return;
                  await db.putBudget({ categoryId: c.id, amount: cents });
                  await store.reload();
                  store.toast(`${c.name} budget saved`);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Rules() {
  const store = useStore();
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [applyExisting, setApplyExisting] = useState(true);
  const [includeManual, setIncludeManual] = useState(false);
  const catName = new Map(store.categories.map((c) => [c.id, c.name]));
  const retro =
    pattern.trim().length >= 2 && categoryId
      ? planRetro(store.transactions, { pattern: pattern.trim() }, categoryId, undefined, includeManual)
      : { change: [], manual: 0, skipped: 0 };
  const rules = [...store.rules].sort((a, b) => a.pattern.localeCompare(b.pattern));

  async function add() {
    if (!pattern.trim() || !categoryId) return;
    const undo = await store.undoPoint();
    const changed = await commitChoice(
      { rule: pattern.trim(), applyExisting, by: { pattern: pattern.trim() }, includeManual },
      categoryId,
    );
    setPattern('');
    await store.reload();
    store.toast(choiceSummary(changed, pattern.trim(), false), undo);
  }

  async function reapply() {
    // Apply only confident guesses; the rest stay in the "To review" list as suggestions.
    const changed = store.transactions
      .filter((t) => t.categoryId === null)
      .flatMap((t) => {
        const s = store.suggest(t.description, t.amount);
        return s?.confident ? [{ ...t, categoryId: s.categoryId, categorySource: s.source }] : [];
      });
    const undo = await store.undoPoint();
    await db.putTransactions(changed);
    await store.reload();
    store.toast(`Categorised ${changed.length} transaction${changed.length === 1 ? '' : 's'}`, changed.length ? undo : undefined);
  }

  return (
    <section className="card">
      <h3>Auto-categorise rules</h3>
      <p className="hint">
        If a description contains the text, it gets that category. Rules aren't case-sensitive, and extra spaces and accents are ignored (“aldi” matches “ALDI STORES”, “cafe” matches “CAFÉ”). Longer matches win. Rules come first,
        then transfers between your accounts, then what you've categorised before, then a built-in list of common
        merchants. Strong matches are applied automatically (tagged “auto”); weaker ones are suggested for you to
        approve.
      </p>
      <ul className="settings-list">
        {rules.map((r) => (
          <li key={r.id} className="rule-row">
            <span className="rule-pattern">“{r.pattern}”</span>
            <span className="rule-arrow">→ {catName.get(r.categoryId) ?? '?'}</span>
            <button
              className="icon-btn"
              aria-label={`Delete rule ${r.pattern}`}
              onClick={async () => {
                const undo = await store.undoPoint();
                await db.deleteRule(r.id);
                await store.reload();
                store.toast(`Deleted rule “${r.pattern}”`, undo);
              }}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <div className="add-rule">
        <input placeholder="Description contains…" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <CategorySelect
          categories={store.categories}
          value={categoryId}
          onChange={setCategoryId}
          noneLabel="Choose category"
        />
        {pattern.trim().length >= 2 && categoryId && (
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={applyExisting}
              onChange={(e) => setApplyExisting(e.target.checked)}
            />
            <span>
              <b>Apply to existing transactions</b>
              <small>
                {retro.change.length === 0
                  ? 'No existing transactions to change'
                  : `${retro.change.length} will change to ${catName.get(categoryId)}`}
                {retro.skipped > 0 && ` · ${retro.skipped} you picked yourself are left as they are`}
              </small>
            </span>
          </label>
        )}
        {pattern.trim().length >= 2 && categoryId && applyExisting && retro.manual > 0 && (
          <label className="switch-row sub">
            <input
              type="checkbox"
              role="switch"
              checked={includeManual}
              onChange={(e) => setIncludeManual(e.target.checked)}
            />
            <span>
              <b>Also change ones I picked myself ({retro.manual})</b>
              <small>Off keeps categories you chose from the list.</small>
            </span>
          </label>
        )}
        <button className="btn primary" onClick={add} disabled={!pattern.trim() || !categoryId}>
          Add rule
        </button>
      </div>
      <button className="btn wide" onClick={reapply}>
        Auto-categorise uncategorised transactions
      </button>
    </section>
  );
}

function Accounts() {
  const store = useStore();
  const [suffix, setSuffix] = useState('');
  const own = store.settings.ownAccountSuffixes;

  async function setOwn(list: string[]) {
    await db.saveSettings({
      ...store.settings,
      ownAccountSuffixes: list,
      notOwnAccountSuffixes: store.settings.notOwnAccountSuffixes.filter((s) => !list.includes(s)),
    });
    await store.reload();
  }

  return (
    <section className="card">
      <h3>Accounts</h3>
      {store.accounts.length === 0 && <p className="hint">Accounts are added automatically when you import.</p>}
      <ul className="settings-list">
        {store.accounts.map((a) => {
          const n = store.transactions.filter((t) => t.accountId === a.id).length;
          return (
            <li key={a.id + a.name} className="cat-row">
              <input
                className="inline-input"
                defaultValue={a.name}
                aria-label={`Rename ${a.name}`}
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  if (!v || v === a.name) return;
                  await db.putAccount({ ...a, name: v });
                  await store.reload();
                }}
              />
              <span className="kind">{n} txns</span>
              <button
                className="icon-btn"
                aria-label={`Delete ${a.name}`}
                onClick={async () => {
                  if (!confirm(`Delete ${a.name} and its ${n} transactions?`)) return;
                  const undo = await store.undoPoint();
                  await db.deleteAccount(a.id);
                  await store.reload();
                  store.toast(`Deleted ${a.name} and ${n} transaction${n === 1 ? '' : 's'}`, undo);
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          );
        })}
      </ul>
      <h4>My account numbers</h4>
      <p className="hint">
        “Transfer to/from xxNNNN” with these last 4 digits counts as a transfer between your own accounts (not
        spending or income).
      </p>
      <div className="chips">
        {own.map((s) => (
          <span key={s} className="chip">
            xx{s}
            <button aria-label={`Remove xx${s}`} onClick={() => setOwn(own.filter((x) => x !== s))}>
              <Icon name="close" size={16} />
            </button>
          </span>
        ))}
      </div>
      <div className="add-row">
        <input
          inputMode="numeric"
          maxLength={4}
          placeholder="Last 4 digits"
          value={suffix}
          onChange={(e) => setSuffix(e.target.value.replace(/\D/g, ''))}
        />
        <button
          className="btn primary"
          disabled={suffix.length !== 4 || own.includes(suffix)}
          onClick={async () => {
            await setOwn([...own, suffix]);
            setSuffix('');
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}

function Backup() {
  const store = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [last, setLast] = useState(() => localStorage.getItem(LAST_BACKUP));

  function backupFile(): File {
    const { accounts, transactions, categories, rules, budgets, settings, goals } = store;
    const json = makeBackup({ accounts, transactions, categories, rules, budgets, settings, goals });
    return new File([json], `budget-backup-${todayISO()}.json`, { type: 'application/json' });
  }
  function markDone() {
    const d = todayISO();
    localStorage.setItem(LAST_BACKUP, d);
    setLast(d);
  }

  function download() {
    const f = backupFile();
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markDone();
  }

  async function share() {
    const f = backupFile();
    try {
      await navigator.share({ files: [f], title: 'Budget backup' });
      markDone();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') store.toast("Couldn't share – try Download instead");
    }
  }

  async function restore(f: File) {
    try {
      const data = readBackup(await f.text());
      if (
        !confirm(
          `Restore ${data.transactions.length} transactions from this backup? This REPLACES everything currently in the app.`,
        )
      )
        return;
      const undo = await store.undoPoint();
      await db.replaceAll(data);
      await store.reload();
      store.toast('Backup restored', undo);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const canShare =
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });

  return (
    <section className="card">
      <h3>Backup & restore</h3>
      <p className="hint">
        Your data only lives on this phone. Save a backup regularly (e.g. to Google Drive) so clearing Chrome's data
        or changing phones doesn't lose it.
        <br />
        Last backup: <b>{last ? formatDate(last) : 'never'}</b>
      </p>
      <div className="button-row">
        <button className="btn primary grow" onClick={download}>
          Download backup
        </button>
        {canShare && (
          <button className="btn grow" onClick={share}>
            Share / save to Drive
          </button>
        )}
      </div>
      <button className="btn wide" onClick={() => file.current?.click()}>
        Restore from backup…
      </button>
      <button
        className="btn wide"
        disabled={store.transactions.length === 0}
        onClick={() => {
          downloadText(
            `budget-transactions-${todayISO()}.csv`,
            transactionsToCsv(store.transactions, store.categories, store.accounts),
          );
          store.toast(`Exported ${store.transactions.length} transactions`);
        }}
      >
        Export all transactions as CSV (spreadsheet)
      </button>
      <p className="hint">
        The CSV is for spreadsheets or tax time. It can't be restored into the app. Use a backup for that. To export
        only some transactions, filter the Transactions list and tap Export CSV there.
      </p>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void restore(f);
        }}
      />
    </section>
  );
}

function About() {
  const store = useStore();
  async function eraseAll() {
    if (!confirm('Erase ALL data from this phone? Make a backup first. This cannot be undone.')) return;
    if (!confirm('Really erase everything?')) return;
    await db.replaceAll({
      accounts: [],
      transactions: [],
      categories: db.defaultCategories(),
      rules: [],
      budgets: [],
      settings: { ownAccountSuffixes: [], notOwnAccountSuffixes: [] },
      goals: [],
    });
    await store.reload();
    store.toast('All data erased');
  }
  return (
    <section className="card">
      <h3>About</h3>
      <p className="hint">
        Budget · v{__APP_VERSION__}. Works offline. No accounts, no servers – nothing leaves this device unless you
        export a backup.
      </p>
      <button className="btn danger wide" onClick={eraseAll}>
        Erase all data
      </button>
    </section>
  );
}
