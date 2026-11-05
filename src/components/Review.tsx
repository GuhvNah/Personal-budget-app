import { useState } from 'react';
import { mentionedSuffixes, ruleMatches, transferSuffix } from '../lib/categorise';
import * as db from '../lib/db';
import { formatDate } from '../lib/dates';
import { newId } from '../lib/id';
import { centsToInput, dollarsToCents, formatAUD } from '../lib/money';
import { rowsToSave, type ReviewBatch, type ReviewRow } from '../lib/importer';
import type { Category } from '../lib/types';
import { useStore } from '../store';
import { RulePrompt } from './RulePrompt';
import { Amount, CategorySelect, Icon, Sheet } from './ui';

type Tab = 'new' | 'check' | 'dupes';

export function Review({
  initial,
  fileErrors,
  onCancel,
  onSaved,
}: {
  initial: ReviewBatch[];
  fileErrors: { fileName: string; message: string }[];
  onCancel(): void;
  onSaved(): void;
}) {
  const store = useStore();
  const { categories, settings } = store;
  const [batches, setBatches] = useState(initial);
  const [tab, setTab] = useState<Tab>('new');
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [rulePrompt, setRulePrompt] = useState<{ row: ReviewRow; category: Category } | null>(null);
  const [saving, setSaving] = useState(false);

  const all = batches.flatMap((b) => b.rows);
  const fresh = all.filter((r) => !r.duplicate);
  const toSave = fresh.filter((r) => !r.removed);
  const check = fresh.filter((r) => r.warnings.length > 0);
  const dupes = all.filter((r) => r.duplicate);
  const shown = tab === 'new' ? fresh : tab === 'check' ? check : dupes;
  const transfersId = categories.find((c) => c.kind === 'transfer')?.id ?? null;

  // Accounts mentioned as "Transfer to/from xxNNNN" that we haven't asked about yet.
  const ownLast4 = new Set([
    ...settings.ownAccountSuffixes,
    ...batches.map((b) => b.accountId.slice(-4)),
  ]);
  const unknownSuffixes = mentionedSuffixes(fresh.map((r) => r.description)).filter(
    (s) => !ownLast4.has(s) && !settings.notOwnAccountSuffixes.includes(s),
  );

  function updateRows(fn: (r: ReviewRow) => ReviewRow) {
    setBatches((bs) => bs.map((b) => ({ ...b, rows: b.rows.map(fn) })));
  }
  function updateRow(rowId: string, patch: Partial<ReviewRow>) {
    updateRows((r) => (r.rowId === rowId ? { ...r, ...patch } : r));
  }

  async function answerSuffix(suffix: string, mine: boolean) {
    const s = mine
      ? { ...settings, ownAccountSuffixes: [...settings.ownAccountSuffixes, suffix] }
      : { ...settings, notOwnAccountSuffixes: [...settings.notOwnAccountSuffixes, suffix] };
    await db.saveSettings(s);
    await store.reload();
    if (mine && transfersId) {
      updateRows((r) =>
        r.categoryId === null && transferSuffix(r.description) === suffix ? { ...r, categoryId: transfersId } : r,
      );
    }
  }

  function changeCategory(row: ReviewRow, categoryId: string | null) {
    updateRow(row.rowId, { categoryId });
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) setRulePrompt({ row, category: cat });
  }

  async function save() {
    setSaving(true);
    try {
      for (const b of batches) if (b.newAccount) await db.putAccount(b.newAccount);
      // The accounts we import into are, by definition, the user's own.
      const own = new Set(settings.ownAccountSuffixes);
      for (const b of batches) if (/\d{4}$/.test(b.accountId)) own.add(b.accountId.slice(-4));
      await db.saveSettings({ ...settings, ownAccountSuffixes: [...own] });
      const txs = rowsToSave(batches);
      await db.putTransactions(txs);
      await store.reload();
      store.toast(`Saved ${txs.length} transaction${txs.length === 1 ? '' : 's'}`);
      onSaved();
    } catch (e) {
      alert(`Couldn't save: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  return (
    <div className="screen review">
      <h2 className="screen-title">Review import</h2>
      <p className="review-summary">
        <b>{toSave.length}</b> to save
        {dupes.length > 0 && <> · {dupes.length} duplicate{dupes.length === 1 ? '' : 's'} skipped</>}
        {fresh.length - toSave.length > 0 && <> · {fresh.length - toSave.length} removed</>}
      </p>

      {fileErrors.map((e) => (
        <div key={e.fileName} className="banner error">
          <Icon name="alert" size={20} />
          <div>
            <b>{e.fileName}</b> wasn't imported: {e.message}
          </div>
        </div>
      ))}

      {batches.map((b, i) => (
        <div key={i} className="card batch">
          <div className="batch-file">{b.fileName}</div>
          {b.newAccount ? (
            <label className="field">
              <span>New account – name it</span>
              <input
                value={b.newAccount.name}
                onChange={(e) =>
                  setBatches((bs) =>
                    bs.map((x, j) => (j === i ? { ...x, newAccount: { ...x.newAccount!, name: e.target.value } } : x)),
                  )
                }
              />
            </label>
          ) : (
            <div className="hint">
              Account:{' '}
              {store.accounts.find((a) => a.id === b.accountId)?.name ??
                batches.find((x) => x.newAccount?.id === b.accountId)?.newAccount?.name}
            </div>
          )}
          {b.warnings.map((w, k) => (
            <div key={k} className="banner warn">
              <Icon name="alert" size={18} /> <span>{w}</span>
            </div>
          ))}
        </div>
      ))}

      {unknownSuffixes.length > 0 && (
        <div className="card">
          <h3>Are these your accounts?</h3>
          <p className="hint">
            Transfers between your own accounts go in <b>Transfers</b> and aren't counted as spending or income.
            (A mortgage/loan account should be “Not mine” – then make a rule for it so repayments count as
            Rent/Mortgage.)
          </p>
          {unknownSuffixes.map((s) => (
            <div key={s} className="suffix-row">
              <span className="suffix">xx{s}</span>
              <button className="btn small" onClick={() => answerSuffix(s, false)}>
                Not mine
              </button>
              <button className="btn small primary" onClick={() => answerSuffix(s, true)}>
                Mine
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'new'} onClick={() => setTab('new')}>
          New ({fresh.length})
        </button>
        <button role="tab" aria-selected={tab === 'check'} onClick={() => setTab('check')}>
          Check ({check.length})
        </button>
        <button role="tab" aria-selected={tab === 'dupes'} onClick={() => setTab('dupes')}>
          Duplicates ({dupes.length})
        </button>
      </div>

      {shown.length === 0 && <p className="hint center">Nothing here.</p>}
      <ul className="review-list">
        {shown.map((r) => (
          <li key={r.rowId} className={`review-row ${r.removed ? 'removed' : ''} ${r.duplicate ? 'dupe' : ''}`}>
            <button className="review-main" onClick={() => !r.duplicate && setEditing(r)} disabled={r.duplicate}>
              <span className="review-line1">
                <span className="tx-desc">{r.description || '(no description)'}</span>
                <Amount cents={r.amount} />
              </span>
              <span className="review-line2">
                {formatDate(r.date)}
                {r.duplicate && <span className="pill">Already imported – skipped</span>}
              </span>
              {r.warnings.map((w, k) => (
                <span key={k} className="status warning">
                  <Icon name="alert" size={16} /> {w}
                </span>
              ))}
            </button>
            {!r.duplicate && (
              <div className="review-actions">
                <CategorySelect
                  categories={categories}
                  value={r.categoryId}
                  onChange={(id) => changeCategory(r, id)}
                />
                <button
                  className="icon-btn bordered"
                  onClick={() => updateRow(r.rowId, { removed: !r.removed })}
                  aria-label={r.removed ? 'Restore line' : 'Remove line'}
                >
                  <Icon name={r.removed ? 'undo' : 'trash'} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="action-bar">
        <button className="btn" onClick={() => confirm('Discard this import? Nothing will be saved.') && onCancel()}>
          Cancel
        </button>
        <button className="btn primary grow" disabled={saving || toSave.length === 0} onClick={save}>
          {saving ? 'Saving…' : `Save ${toSave.length}`}
        </button>
      </div>

      {editing && (
        <RowEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateRow(editing.rowId, patch);
            setEditing(null);
          }}
        />
      )}
      {rulePrompt && (
        <RulePrompt
          description={rulePrompt.row.description}
          category={rulePrompt.category}
          countMatches={(p) =>
            all.filter(
              (r) => r.rowId !== rulePrompt.row.rowId && r.categoryId === null && ruleMatches({ pattern: p } as never, r.description),
            ).length
          }
          onCreate={async (pattern, apply) => {
            await db.putRule({ id: newId(), pattern, categoryId: rulePrompt.category.id, createdAt: Date.now() });
            await store.reload();
            if (apply) {
              updateRows((r) =>
                r.categoryId === null && ruleMatches({ pattern } as never, r.description)
                  ? { ...r, categoryId: rulePrompt.category.id }
                  : r,
              );
            }
            store.toast('Rule created');
          }}
          onClose={() => setRulePrompt(null)}
        />
      )}
    </div>
  );
}

function RowEditor({
  row,
  onClose,
  onSave,
}: {
  row: ReviewRow;
  onClose(): void;
  onSave(patch: Partial<ReviewRow>): void;
}) {
  const [date, setDate] = useState(row.date);
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(centsToInput(row.amount));
  const [direction, setDirection] = useState<'out' | 'in'>(row.amount > 0 ? 'in' : 'out');
  const cents = dollarsToCents(amount);
  const ok = !!date && cents !== null;
  return (
    <Sheet
      title="Fix transaction"
      onClose={onClose}
      footer={
        <button
          className="btn primary grow"
          disabled={!ok}
          onClick={() =>
            onSave({
              date,
              description: description.trim(),
              amount: direction === 'out' ? -cents! : cents!,
              // The user has checked it, so clear the warnings.
              warnings: [],
            })
          }
        >
          Done
        </button>
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
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {row.reference && <p className="hint">Reference: {row.reference}</p>}
      {row.balance !== undefined && <p className="hint">Balance after: {formatAUD(row.balance)}</p>}
    </Sheet>
  );
}
