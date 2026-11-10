import * as db from '../lib/db';
import { formatDate } from '../lib/dates';
import type { Transaction } from '../lib/types';
import { useStore } from '../store';
import { Amount, Sheet } from './ui';

/**
 * Captured purchases that have been pending for over 10 days without a
 * matching statement line. Keep them as normal transactions or delete them.
 */
export function StalePendingSheet({ items, onClose }: { items: Transaction[]; onClose(): void }) {
  const store = useStore();

  async function resolve(list: Transaction[], keep: boolean) {
    const undo = await store.undoPoint();
    if (keep) await db.putTransactions(list.map((t) => ({ ...t, pending: false })));
    else await db.deleteTransactions(list.map((t) => t.id));
    await store.reload();
    const n = list.length;
    store.toast(`${keep ? 'Kept' : 'Deleted'} ${n} purchase${n === 1 ? '' : 's'}`, undo);
    if (n === items.length) onClose();
  }

  return (
    <Sheet
      title="Old pending purchases"
      onClose={onClose}
      footer={
        items.length > 1 ? (
          <>
            <button className="btn danger" onClick={() => void resolve(items, false)}>
              Delete all
            </button>
            <button className="btn primary grow" onClick={() => void resolve(items, true)}>
              Keep all
            </button>
          </>
        ) : undefined
      }
    >
      <p className="hint">
        These were recorded when you paid, more than 10 days ago, and no statement you've imported since has a matching
        line. <b>Keep</b> one if it's a real purchase (it stops being pending). <b>Delete</b> it if the payment didn't go
        through, or if it's already in your statement under a different amount.
      </p>
      <ul className="review-list">
        {items.map((t) => (
          <li key={t.id} className="review-row">
            <div className="review-main static">
              <span className="review-line1">
                <span className="tx-desc">{t.description}</span>
                <Amount cents={t.amount} />
              </span>
              <span className="review-line2">{formatDate(t.date)}</span>
            </div>
            <div className="button-row">
              <button className="btn small danger" onClick={() => void resolve([t], false)}>
                Delete
              </button>
              <button className="btn small grow" onClick={() => void resolve([t], true)}>
                Keep
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
