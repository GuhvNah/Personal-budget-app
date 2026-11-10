import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { newId } from './id';
import { BUILTIN_NAMES } from './suggest';
import {
  DEFAULT_SETTINGS,
  type Account,
  type BuiltinCategory,
  type Budget,
  type Category,
  type Goal,
  type Rule,
  type Settings,
  type Transaction,
} from './types';

interface BudgetDB extends DBSchema {
  accounts: { key: string; value: Account };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { byDate: string; byDedupe: string; byCategory: string };
  };
  categories: { key: string; value: Category };
  rules: { key: string; value: Rule };
  budgets: { key: string; value: Budget };
  settings: { key: string; value: { key: string; value: unknown } };
  goals: { key: string; value: Goal };
}

export const STORES = ['accounts', 'transactions', 'categories', 'rules', 'budgets', 'settings', 'goals'] as const;

const DB_NAME = 'guhvnah-budget';
/** Fired on window when a database upgrade is waiting for another open copy of the app to close. */
export const DB_BLOCKED = 'budget-db-blocked';

export function defaultCategories(): Category[] {
  const expense: [string, BuiltinCategory][] = [
    ['Groceries', 'groceries'],
    ['Rent/Mortgage', 'rent'],
    ['Fuel', 'fuel'],
    ['Bills', 'bills'],
    ['Insurance', 'insurance'],
    ['Eating Out', 'eating-out'],
    ['Entertainment', 'entertainment'],
    ['Childcare', 'childcare'],
    ['Other', 'other'],
  ];
  return [
    ...expense.map(([name, builtin], order) => ({ id: newId(), name, kind: 'expense' as const, builtin, order })),
    { id: newId(), name: 'Income', kind: 'income', builtin: 'income', order: expense.length },
    { id: newId(), name: 'Transfers', kind: 'transfer', builtin: 'transfers', system: true, order: expense.length + 1 },
  ];
}

/**
 * Data saved before categories had a `builtin` key: match the default
 * categories up by their original name. Returns the categories that changed.
 */
export function tagBuiltins(categories: Category[]): Category[] {
  const changed: Category[] = [];
  for (const [key, name] of Object.entries(BUILTIN_NAMES) as [BuiltinCategory, string][]) {
    if (categories.some((c) => c.builtin === key)) continue;
    const c = categories.find((x) => !x.builtin && x.name.toLowerCase() === name.toLowerCase());
    if (c) {
      c.builtin = key;
      changed.push(c);
    }
  }
  return changed;
}

function defaultRules(cats: Category[]): Rule[] {
  const id = (name: string) => cats.find((c) => c.name === name)!.id;
  const pairs: [string, string][] = [
    ['ALDI', 'Groceries'],
    ['WOOLWORTHS', 'Groceries'],
    ['COLES', 'Groceries'],
    ['AMPOL', 'Fuel'],
    ['CALTEX', 'Fuel'],
    ['BUDGET DIRECT', 'Insurance'],
    ['BUPA', 'Insurance'],
  ];
  return pairs.map(([pattern, cat]) => ({
    id: newId(),
    pattern,
    categoryId: id(cat),
    createdAt: Date.now(),
  }));
}

let dbPromise: Promise<IDBPDatabase<BudgetDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<BudgetDB>> {
  dbPromise ??= openDB<BudgetDB>(DB_NAME, 2, {
    upgrade(db, oldVersion, _new, tx) {
      // Version 2 adds savings goals; existing data is left as it is.
      if (oldVersion < 2) db.createObjectStore('goals', { keyPath: 'id' });
      if (oldVersion >= 1) return;
      db.createObjectStore('accounts', { keyPath: 'id' });
      const t = db.createObjectStore('transactions', { keyPath: 'id' });
      t.createIndex('byDate', 'date');
      t.createIndex('byDedupe', 'dedupeKey');
      t.createIndex('byCategory', 'categoryId');
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('rules', { keyPath: 'id' });
      db.createObjectStore('budgets', { keyPath: 'categoryId' });
      db.createObjectStore('settings', { keyPath: 'key' });

      const cats = defaultCategories();
      for (const c of cats) tx.objectStore('categories').put(c);
      for (const r of defaultRules(cats)) tx.objectStore('rules').put(r);
    },
    // An older copy of the app (another tab) is holding the database open, so the upgrade can't start.
    blocked() {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(DB_BLOCKED));
    },
    // A newer copy wants to upgrade: let go so it can, then pick up the new version.
    blocking(_cur, _blocked, event) {
      (event.target as IDBDatabase).close();
      if (typeof window !== 'undefined') window.location.reload();
    },
  });
  return dbPromise;
}

export interface AllData {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  rules: Rule[];
  budgets: Budget[];
  settings: Settings;
  goals: Goal[];
}

export async function loadAll(): Promise<AllData> {
  const db = await getDB();
  const [accounts, transactions, categories, rules, budgets, settingRows, goals] = await Promise.all([
    db.getAll('accounts'),
    db.getAll('transactions'),
    db.getAll('categories'),
    db.getAll('rules'),
    db.getAll('budgets'),
    db.getAll('settings'),
    db.getAll('goals'),
  ]);
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const row of settingRows) (settings as unknown as Record<string, unknown>)[row.key] = row.value;
  const tagged = tagBuiltins(categories);
  if (tagged.length) {
    const tx = db.transaction('categories', 'readwrite');
    for (const c of tagged) tx.store.put(c);
    await tx.done;
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  categories.sort((a, b) => a.order - b.order);
  goals.sort((a, b) => a.createdAt - b.createdAt);
  return { accounts, transactions, categories, rules, budgets, settings, goals };
}

/** Replace everything in the database (used by backup restore). */
export async function replaceAll(data: AllData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...STORES], 'readwrite');
  await Promise.all(STORES.map((s) => tx.objectStore(s).clear()));
  for (const a of data.accounts) tx.objectStore('accounts').put(a);
  for (const t of data.transactions) tx.objectStore('transactions').put(t);
  for (const c of data.categories) tx.objectStore('categories').put(c);
  for (const r of data.rules) tx.objectStore('rules').put(r);
  for (const b of data.budgets) tx.objectStore('budgets').put(b);
  for (const [key, value] of Object.entries(data.settings)) tx.objectStore('settings').put({ key, value });
  for (const g of data.goals) tx.objectStore('goals').put(g);
  await tx.done;
}

export async function putGoal(g: Goal) {
  await (await getDB()).put('goals', g);
}
export async function deleteGoal(id: string) {
  await (await getDB()).delete('goals', id);
}

export async function putAccount(a: Account) {
  await (await getDB()).put('accounts', a);
}
export async function deleteAccount(id: string) {
  const db = await getDB();
  const tx = db.transaction(['accounts', 'transactions'], 'readwrite');
  const all = await tx.objectStore('transactions').getAll();
  for (const t of all) if (t.accountId === id) tx.objectStore('transactions').delete(t.id);
  tx.objectStore('accounts').delete(id);
  await tx.done;
}

export async function putTransactions(txs: Transaction[]) {
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  for (const t of txs) tx.store.put(t);
  await tx.done;
}
export async function deleteTransaction(id: string) {
  await (await getDB()).delete('transactions', id);
}

/** Of the given keys, return those already stored. */
export async function existingDedupeKeys(keys: string[]): Promise<Set<string>> {
  const db = await getDB();
  const index = db.transaction('transactions').store.index('byDedupe');
  const found = new Set<string>();
  await Promise.all(
    keys.map(async (k) => {
      if (await index.getKey(k)) found.add(k);
    }),
  );
  return found;
}

export async function putCategory(c: Category) {
  await (await getDB()).put('categories', c);
}

/** Delete a category, moving its transactions to `moveTo` (or uncategorised). */
export async function deleteCategory(id: string, moveTo: string | null) {
  const db = await getDB();
  const tx = db.transaction(['categories', 'transactions', 'rules', 'budgets'], 'readwrite');
  const txStore = tx.objectStore('transactions');
  for (const t of await txStore.index('byCategory').getAll(id)) txStore.put({ ...t, categoryId: moveTo });
  const ruleStore = tx.objectStore('rules');
  for (const r of await ruleStore.getAll()) {
    if (r.categoryId !== id) continue;
    if (moveTo) ruleStore.put({ ...r, categoryId: moveTo });
    else ruleStore.delete(r.id);
  }
  tx.objectStore('budgets').delete(id);
  tx.objectStore('categories').delete(id);
  await tx.done;
}

export async function putRule(r: Rule) {
  await (await getDB()).put('rules', r);
}
export async function deleteRule(id: string) {
  await (await getDB()).delete('rules', id);
}

export async function putBudget(b: Budget) {
  const db = await getDB();
  if (b.amount > 0) await db.put('budgets', b);
  else await db.delete('budgets', b.categoryId);
}

export async function saveSettings(s: Settings) {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  for (const [key, value] of Object.entries(s)) tx.store.put({ key, value });
  await tx.done;
}

export async function deleteTransactions(ids: string[]) {
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  for (const id of ids) tx.store.delete(id);
  await tx.done;
}
