import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as db from './lib/db';
import type { AllData } from './lib/db';
import { DEFAULT_SETTINGS } from './lib/types';

interface StoreValue extends AllData {
  ready: boolean;
  error: string | null;
  reload(): Promise<void>;
  toast(message: string): void;
  toastMessage: string | null;
}

const empty: AllData = {
  accounts: [],
  transactions: [],
  categories: [],
  rules: [],
  budgets: [],
  settings: DEFAULT_SETTINGS,
};

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AllData>(empty);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await db.loadAll());
      setReady(true);
    } catch (e) {
      setError(
        `Couldn't open the on-device database: ${(e as Error).message}. Private/incognito mode may block storage.`,
      );
    }
  }, []);

  useEffect(() => {
    void reload();
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.();
  }, [reload]);

  const toast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((m) => (m === message ? null : m)), 3000);
  }, []);

  return (
    <Ctx.Provider value={{ ...data, ready, error, reload, toast, toastMessage }}>{children}</Ctx.Provider>
  );
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}
