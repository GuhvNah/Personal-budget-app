/** All money values are stored as integer cents to avoid floating-point errors. */
export type Cents = number;

/** ISO date string, YYYY-MM-DD. Displayed to the user as DD/MM/YYYY. */
export type ISODate = string;

export interface Account {
  id: string;
  name: string;
  bsb?: string;
  number?: string;
  createdAt: number;
}

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** System categories (e.g. Transfers) can be renamed but not deleted. */
  system?: boolean;
  order: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: ISODate;
  description: string;
  /** Bank reference numbers split out of the description (not used for rules). */
  reference?: string;
  /** Negative = debit (money out), positive = credit (money in). */
  amount: Cents;
  /** Running balance after this transaction, when the source provides it. */
  balance?: Cents;
  categoryId: string | null;
  dedupeKey: string;
  source: 'pdf' | 'csv' | 'manual';
  notes?: string;
  createdAt: number;
}

export interface Rule {
  id: string;
  /** Case-insensitive text that must appear in the description. */
  pattern: string;
  categoryId: string;
  createdAt: number;
}

export interface Budget {
  categoryId: string;
  /** Monthly budget, positive cents. */
  amount: Cents;
}

export interface Settings {
  /** Last 4 digits of account numbers that belong to the user (e.g. "1111"). */
  ownAccountSuffixes: string[];
  /** Suffixes the user has already said are NOT theirs, so we stop asking. */
  notOwnAccountSuffixes: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  ownAccountSuffixes: [],
  notOwnAccountSuffixes: [],
};
