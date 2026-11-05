import { useEffect, useRef } from 'react';
import { isoDate, isRepeatCapture, parseCaptureFragment, parseNotification } from './capture';
import * as db from './db';
import { newId } from './id';
import { formatAUD } from './money';
import type { Transaction } from './types';
import { useStore } from '../store';

export const CAPTURE_ACCOUNT_ID = 'card-captured';

/**
 * Handle capture links (#capture=…) when the app opens or the link changes:
 * add the purchase as a pending transaction and tell the user.
 */
export function useCapture() {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    if (!store.ready) return;
    async function handle() {
      const req = parseCaptureFragment(window.location.hash);
      if (!req) return;
      // Clear the link straight away so a reload can't add it twice.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      const s = storeRef.current;
      if (!s.settings.captureKey || req.key !== s.settings.captureKey) {
        s.toast("Capture link not recognised – copy it again from Settings → Real-time capture");
        return;
      }
      const p = parseNotification(req.title, req.body);
      if (!p) {
        s.toast(`Couldn't find a purchase in: “${`${req.title} ${req.body}`.trim().slice(0, 60)}”`);
        return;
      }
      const now = Date.now();
      if (isRepeatCapture(p.amount, now, s.transactions)) {
        s.toast(`Already captured ${formatAUD(Math.abs(p.amount))}`);
        return;
      }
      let accountId = s.settings.captureAccountId;
      if (!accountId || !s.accounts.some((a) => a.id === accountId)) {
        accountId = CAPTURE_ACCOUNT_ID;
        if (!s.accounts.some((a) => a.id === accountId)) {
          await db.putAccount({ id: accountId, name: 'Card (captured)', createdAt: now });
        }
      }
      const suggestion = s.suggest(p.merchant, p.amount);
      const id = newId();
      const tx: Transaction = {
        id,
        accountId,
        date: isoDate(now),
        description: p.merchant,
        reference: `${req.title} | ${req.body}`.slice(0, 300),
        amount: p.amount,
        categoryId: suggestion?.confident ? suggestion.categoryId : null,
        categorySource: suggestion?.confident ? suggestion.source : undefined,
        dedupeKey: `capture|${id}`,
        source: 'capture',
        pending: true,
        createdAt: now,
      };
      await db.putTransactions([tx]);
      await s.reload();
      const cat = s.categories.find((c) => c.id === tx.categoryId)?.name;
      s.toast(`Captured ${formatAUD(Math.abs(p.amount))} at ${p.merchant}${cat ? ` · ${cat}` : ' · to review'}`);
    }
    void handle();
    const onHash = () => void handle();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [store.ready]);
}
