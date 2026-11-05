import { useState } from 'react';
import { ruleMatches } from '../lib/categorise';
import * as db from '../lib/db';
import { todayISO } from '../lib/dates';
import { newId } from '../lib/id';
import { centsToInput, dollarsToCents } from '../lib/money';
import type { Category, Transaction } from '../lib/types';
import { useStore } from '../store';
import { RulePrompt } from './RulePrompt';
import { CategoryPicker } from './CategoryPicker';
import { categoryNecessity } from '../lib/outgoings';
import type { Necessity } from '../lib/types';
import { Sheet } from './ui';

export const MANUAL_ACCOUNT_ID = 'manual';

/** Add (tx = null) or edit a transaction. */
export function TransactionEditor({ tx, onClose }: { tx: Transaction | null; onClose(): void }) {
  const store = useStore();
  const { categories, accounts, transactions } = store;
  const [date, setDate] = useState(tx?.date ?? todayISO());
  const [description, setDescription] = useState(tx?.description ?? '');
  const [amount, setAmount] = useState(tx ? centsToInput(tx.amount) : '');
  const [direction, setDirection] = useState<'out' | 'in'>(tx && tx.amount > 0 ? 'in' : 'out');
  const [categoryId, setCategoryId] = useState<string | null>(tx?.categoryId ?? null);
  // True when the category came from approving the app's suggestion.
  const [approved, setApproved] = useState(false);
  const [accountId, setAccountId] = useState(tx?.accountId ?? accounts[0]?.id ?? MANUAL_ACCOUNT_ID);
  const [notes, setNotes] = useState(tx?.notes ?? '');
  const [necessity, setNecessity] = useState<Necessity | undefined>(tx?.necessity);
  const [rulePrompt, setRulePrompt] = useState<{ description: string; category: Category } | null>(null);
  const [error, setError] = useState('');

  const cents = dollarsToCents(amount);
  const signed = cents ? (direction === 'out' ? -cents : cents) : 0;
  const suggestion = description.trim() ? store.suggest(description, signed) : null;
  const fromStatement = tx !== null && tx.source !== 'manual';
  const currentCat = categories.find((c) => c.id === categoryId);

  async function save() {
    if (!date) return setError('Enter a date.');
    if (!description.trim()) return setError('Enter a description.');
    if (cents === null || cents === 0) return setError('Enter an amount, e.g. 12.50');
    if (accountId === MANUAL_ACCOUNT_ID && !accounts.some((a) => a.id === MANUAL_ACCOUNT_ID)) {
      await db.putAccount({ id: MANUAL_ACCOUNT_ID, name: 'Cash / manual', createdAt: Date.now() });
    }
    const id = tx?.id ?? newId();
    const saved: Transaction = {
      ...(tx ?? { source: 'manual', createdAt: Date.now(), dedupeKey: `manual|${id}` }),
      id,
      date,
      description: description.trim(),
      amount: direction === 'out' ? -cents : cents,
      categoryId,
      // Clearing a category on purpose is remembered, so it isn't auto-categorised again.
      categorySource:
        categoryId === null
          ? tx?.categoryId
            ? 'user'
            : tx?.categorySource
          : categoryId === tx?.categoryId
            ? (tx.categorySource ?? 'user')
            : 'user',
      accountId,
      notes: notes.trim() || undefined,
      necessity,
    } as Transaction;
    await db.putTransactions([saved]);
    const similar = await store.reload();
    store.toast(
      `${tx ? 'Transaction updated' : 'Transaction added'}${similar ? ` · ${similar} similar categorised too` : ''}`,
    );

    const changed = categoryId && categoryId !== (tx?.categoryId ?? null);
    const cat = categories.find((c) => c.id === categoryId);
    if (changed && cat && !approved) {
      setRulePrompt({ description: saved.description, category: cat });
    } else onClose();
  }

  async function remove() {
    if (!tx || !confirm('Delete this transaction?')) return;
    await db.deleteTransaction(tx.id);
    await store.reload();
    store.toast('Transaction deleted');
    onClose();
  }

  if (rulePrompt) {
    const others = (p: string) =>
      transactions.filter((t) => t.categoryId === null && ruleMatches({ pattern: p } as never, t.description));
    return (
      <RulePrompt
        description={rulePrompt.description}
        category={rulePrompt.category}
        countMatches={(p) => others(p).length}
        onCreate={async (pattern, apply) => {
          await db.putRule({ id: newId(), pattern, categoryId: rulePrompt.category.id, createdAt: Date.now() });
          if (apply) {
            await db.putTransactions(others(pattern).map((t) => ({ ...t, categoryId: rulePrompt.category.id })));
          }
          await store.reload();
          store.toast('Rule created');
        }}
        onClose={onClose}
      />
    );
  }

  const accountOptions = accounts.some((a) => a.id === MANUAL_ACCOUNT_ID)
    ? accounts
    : [...accounts, { id: MANUAL_ACCOUNT_ID, name: 'Cash / manual', createdAt: 0 }];

  return (
    <Sheet
      title={tx ? 'Edit transaction' : 'Add transaction'}
      onClose={onClose}
      footer={
        <>
          {tx && (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
          <button className="btn primary grow" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="segmented" role="radiogroup" aria-label="Direction">
        <button aria-pressed={direction === 'out'} onClick={() => setDirection('out')}>
          Money out
        </button>
        <button aria-pressed={direction === 'in'} onClick={() => setDirection('in')}>
          Money in
        </button>
      </div>
      <label className="field">
        <span>Amount ($)</span>
        <input
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="field">
        <span>Category</span>
        <CategoryPicker
          categories={categories}
          value={categoryId}
          source={categoryId === tx?.categoryId ? tx?.categorySource : 'user'}
          suggestion={suggestion}
          onApprove={(id) => {
            setCategoryId(id);
            setApproved(true);
          }}
          onChange={(id) => {
            setCategoryId(id);
            setApproved(false);
          }}
        />
      </div>
      {direction === 'out' && (!currentCat || currentCat.kind === 'expense') && (
        <div className="field">
          <span>Necessary or unnecessary?</span>
          <div className="segmented" role="radiogroup" aria-label="Necessary or unnecessary">
            <button aria-pressed={necessity === undefined} onClick={() => setNecessity(undefined)}>
              {currentCat ? `As category (${categoryNecessity(currentCat) === 'necessary' ? 'nec.' : 'unnec.'})` : 'Not set'}
            </button>
            <button aria-pressed={necessity === 'necessary'} onClick={() => setNecessity('necessary')}>
              Necessary
            </button>
            <button aria-pressed={necessity === 'unnecessary'} onClick={() => setNecessity('unnecessary')}>
              Unnecessary
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>Account</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {fromStatement && tx?.reference && <p className="hint">Reference: {tx.reference}</p>}
      {fromStatement && (
        <p className="hint">Imported from a {tx?.source.toUpperCase()} statement.</p>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
