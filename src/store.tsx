import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as db from './lib/db';
import type { AllData } from './lib/db';
import { autoApplyPending, buildHistory, suggestCategory, type History, type Suggestion } from './lib/suggest';
import { DEFAULT_SETTINGS } from './lib/types';

interface StoreValue extends AllData {
  ready: boolean;
  error: string | null;
  /**
   * Reload everything from the database. Also auto-categorises any pending
   * transactions that are now obvious (e.g. same merchant as one you just
   * approved). Returns how many were auto-categorised.
   */
  reload(): Promise<number>;
  /** Show a short message. With `action` it stays longer and shows a button (e.g. Undo). */
  toast(message: string, action?: ToastAction): void;
  toastMessage: string | null;
  toastAction: ToastAction | null;
  /**
   * Call before a change that touches many records. Returns a function that
   * puts everything back exactly as it was – pass it to toast() as an Undo.
   */
  undoPoint(): Promise<ToastAction>;
  /** What you've categorised before, for learning. */
  history: History;
  /** The app's best category guess for a description/amount. */
  suggest(description: string, amount: number): Suggestion | null;
}

export interface ToastAction {
  label: string;
  run(): void | Promise<void>;
}

const empty: AllData = {
  accounts: [],
  transactions: [],
  categories: [],
  rules: [],
  budgets: [],
  settings: DEFAULT_SETTINGS,
  goals: [],
};

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AllData>(empty);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastState, setToast] = useState<{ message: string; action?: ToastAction } | null>(null);

  const reload = useCallback(async () => {
    try {
      const loaded = await db.loadAll();
      const applied = autoApplyPending(loaded.transactions, {
        rules: loaded.rules,
        categories: loaded.categories,
        ownSuffixes: loaded.settings.ownAccountSuffixes,
      });
      if (applied.length) {
        await db.putTransactions(applied);
        const byId = new Map(applied.map((t) => [t.id, t]));
        loaded.transactions = loaded.transactions.map((t) => byId.get(t.id) ?? t);
      }
      setData(loaded);
      setReady(true);
      setError(null);
      return applied.length;
    } catch (e) {
      setError(
        `Couldn't open the on-device database: ${(e as Error).message}. Private/incognito mode may block storage.`,
      );
      return 0;
    }
  }, []);

  useEffect(() => {
    const onBlocked = () =>
      setError('The app has been updated, but an older copy is still open in another tab or window. Close it, then reopen this one.');
    window.addEventListener(db.DB_BLOCKED, onBlocked);
    void reload();
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.();
  }, [reload]);

  const toast = useCallback((message: string, action?: ToastAction) => {
    const next = { message, action };
    setToast(next);
    window.setTimeout(() => setToast((cur) => (cur === next ? null : cur)), action ? 8000 : 3000);
  }, []);

  const undoPoint = useCallback(async (): Promise<ToastAction> => {
    const before = await db.loadAll();
    return {
      label: 'Undo',
      run: async () => {
        await db.replaceAll(before);
        await reload();
        toast('Undone');
      },
    };
  }, [reload, toast]);

  const history = useMemo(() => buildHistory(data.transactions), [data.transactions]);
  const suggest = useCallback(
    (description: string, amount: number) =>
      suggestCategory(description, amount, {
        rules: data.rules,
        categories: data.categories,
        ownSuffixes: data.settings.ownAccountSuffixes,
        history,
      }),
    [data.rules, data.categories, data.settings.ownAccountSuffixes, history],
  );

  return (
    <Ctx.Provider
      value={{
        ...data,
        ready,
        error,
        reload,
        toast,
        toastMessage: toastState?.message ?? null,
        toastAction: toastState?.action ?? null,
        undoPoint,
        history,
        suggest,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}
