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

/** Whether spending is a necessity or a nice-to-have. */
export type Necessity = 'necessary' | 'unnecessary';

export type BuiltinCategory =
  | 'groceries'
  | 'rent'
  | 'fuel'
  | 'bills'
  | 'insurance'
  | 'eating-out'
  | 'entertainment'
  | 'childcare'
  | 'other'
  | 'income'
  | 'transfers';

/**
 * How a transaction got its category:
 * - user: picked by you from the category list (protected from bulk updates
 *   unless you ask; also used for learning). With no category, it means you
 *   deliberately left it uncategorised.
 * - approved: you approved the app's suggestion (used for learning)
 * - rule: one of your rules matched
 * - transfer: transfer between your own accounts
 * - auto: the app was confident and applied it (shown with an "auto" tag)
 */
export type CategorySource = 'user' | 'approved' | 'rule' | 'transfer' | 'auto';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** System categories (e.g. Transfers) can be renamed but not deleted. */
  system?: boolean;
  /**
   * Stable key for the built-in categories (e.g. "groceries"), so the
   * built-in merchant list keeps working after a category is renamed.
   */
  builtin?: BuiltinCategory;
  /**
   * Spending categories only. Missing means the default for a built-in
   * category (see categoryNecessity), or "necessary" for your own ones.
   */
  necessity?: Necessity;
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
  /** Missing on transactions saved before this field existed (not protected from bulk updates). */
  categorySource?: CategorySource;
  /** Override the category's necessary/unnecessary setting for this transaction. */
  necessity?: Necessity;
  dedupeKey: string;
  /** 'capture' = recorded in real time from a payment notification. */
  source: 'pdf' | 'csv' | 'manual' | 'capture';
  /**
   * A captured purchase not yet matched to a bank statement. Replaced by the
   * statement's version when you import one that contains it.
   */
  pending?: boolean;
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
  /** Secret in the capture link so only your automation can add purchases. */
  captureKey?: string;
  /** Account captured purchases are recorded against (e.g. your offset account). */
  captureAccountId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  ownAccountSuffixes: [],
  notOwnAccountSuffixes: [],
};
