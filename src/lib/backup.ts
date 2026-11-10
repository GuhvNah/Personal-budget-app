import type { AllData } from './db';
import { DEFAULT_SETTINGS } from './types';

export const BACKUP_APP = 'guhvnah-budget';
export const BACKUP_VERSION = 1;

export function makeBackup(data: AllData): string {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), ...data },
    null,
    1,
  );
}

function arr(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`Backup is missing "${name}".`);
  return v;
}

/** Validate and parse a backup file. Throws an Error with a user-friendly message. */
export function readBackup(text: string): AllData {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON, so it can't be a backup from this app.");
  }
  if (!raw || raw.app !== BACKUP_APP) throw new Error("This file isn't a backup from this app.");
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  }
  const transactions = arr(raw.transactions, 'transactions') as AllData['transactions'];
  for (const t of transactions) {
    if (
      typeof t?.id !== 'string' ||
      typeof t.date !== 'string' ||
      !Number.isInteger(t.amount) ||
      typeof t.accountId !== 'string'
    ) {
      throw new Error('Backup contains a damaged transaction, so it was not restored.');
    }
  }
  return {
    accounts: arr(raw.accounts, 'accounts') as AllData['accounts'],
    transactions,
    categories: arr(raw.categories, 'categories') as AllData['categories'],
    rules: arr(raw.rules, 'rules') as AllData['rules'],
    budgets: arr(raw.budgets, 'budgets') as AllData['budgets'],
    settings: { ...DEFAULT_SETTINGS, ...((raw.settings as object) ?? {}) },
    // Backups made before savings goals existed have none.
    goals: Array.isArray(raw.goals) ? (raw.goals as AllData['goals']) : [],
  };
}
