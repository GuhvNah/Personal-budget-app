import { useMemo, useState } from 'react';
import * as db from '../lib/db';
import { formatDate } from '../lib/dates';
import type { Category, Transaction } from '../lib/types';
import { useStore } from '../store';
import { CategoryPicker } from './CategoryPicker';
import { ApplySheet, choiceSummary, commitChoice } from './ApplySheet';
import { planRetro } from '../lib/retro';
import { Amount, Empty, Icon } from './ui';

/** Uncategorised transactions, with the app's suggestion to approve or change. */
export function ReviewQueue({ onBack }: { onBack(): void }) {
  const store = useStore();
  const { transactions, categories, suggest } = store;
  const [applyPrompt, setApplyPrompt] = useState<{ tx: Transaction; category: Category } | null>(null);
  const [limit, setLimit] = useState(50);

  const items = useMemo(() => {
    const list = transactions
      .filter((t) => t.categoryId === null)
      .map((t) => ({ tx: t, suggestion: suggest(t.description, t.amount) }));
    // Ones with a suggestion first (quick to approve), then newest first.
    return list.sort((a, b) => Number(!!b.suggestion) - Number(!!a.suggestion) || b.tx.date.localeCompare(a.tx.date));
  }, [transactions, suggest]);
  const withSuggestion = items.filter((i) => i.suggestion);

  async function setCategory(tx: Transaction, categoryId: string | null, viaApprove: boolean) {
    await db.putTransactions([{ ...tx, categoryId, categorySource: categoryId ? 'user' : undefined }]);
    const similar = await store.reload();
    if (similar) store.toast(`Also categorised ${similar} similar transaction${similar === 1 ? '' : 's'}`);
    const cat = categories.find((c) => c.id === categoryId);
    if (!viaApprove && cat) setApplyPrompt({ tx, category: cat });
  }

  async function approveAll() {
    if (!confirm(`Approve all ${withSuggestion.length} suggested categories?`)) return;
    await db.putTransactions(
      withSuggestion.map(({ tx, suggestion }) => ({ ...tx, categoryId: suggestion!.categoryId, categorySource: 'user' })),
    );
    await store.reload();
    store.toast(`Approved ${withSuggestion.length}`);
  }

  return (
    <div className="screen">
      <div className="queue-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to transactions">
          <Icon name="left" />
        </button>
        <h2>To review</h2>
      </div>
      {items.length === 0 ? (
        <Empty title="All caught up ✓">
          <p>Every transaction has a category.</p>
          <button className="btn" onClick={onBack}>
            Back to transactions
          </button>
        </Empty>
      ) : (
        <>
          <p className="hint">
            {items.length} uncategorised · {withSuggestion.length} with a suggestion. Approve a suggestion with ✓, or
            choose a different category.
          </p>
          {withSuggestion.length > 1 && (
            <button className="btn wide approve-all" onClick={approveAll}>
              <Icon name="check" size={18} /> Approve all {withSuggestion.length} suggestions
            </button>
          )}
          <ul className="review-list">
            {items.slice(0, limit).map(({ tx, suggestion }) => (
              <li key={tx.id} className="review-row">
                <div className="review-main static">
                  <span className="review-line1">
                    <span className="tx-desc">{tx.description}</span>
                    <Amount cents={tx.amount} />
                  </span>
                  <span className="review-line2">{formatDate(tx.date)}</span>
                </div>
                <CategoryPicker
                  categories={categories}
                  value={null}
                  suggestion={suggestion}
                  onApprove={(id) => void setCategory(tx, id, true)}
                  onChange={(id) => void setCategory(tx, id, false)}
                  placeholder="Choose a category…"
                />
              </li>
            ))}
          </ul>
          {items.length > limit && (
            <button className="btn wide" onClick={() => setLimit(limit + 50)}>
              Show more ({items.length - limit} left)
            </button>
          )}
        </>
      )}
      {applyPrompt && (
        <ApplySheet
          description={applyPrompt.tx.description}
          category={applyPrompt.category}
          plan={(by) => {
            const r = planRetro(transactions, by, applyPrompt.category.id, (t) => t.id === applyPrompt.tx.id);
            return { change: r.change.length, skipped: r.skipped };
          }}
          onConfirm={async (choice) => {
            const changed = await commitChoice(choice, applyPrompt.category.id, applyPrompt.tx.id);
            await store.reload();
            const msg = choiceSummary(changed, choice.rule);
            if (msg) store.toast(msg);
          }}
          onClose={() => setApplyPrompt(null)}
        />
      )}
    </div>
  );
}
