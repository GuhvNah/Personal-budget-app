import type { Cents, ISODate } from '../lib/types';

/** A statement as plain text: one array of lines per page. */
export type StatementPages = string[][];

export interface ParsedTransaction {
  date: ISODate;
  description: string;
  reference?: string;
  amount: Cents;
  balance?: Cents;
  /** Problems found with this specific line, shown on the review screen. */
  warnings: string[];
}

export interface ParsedAccount {
  bsb?: string;
  number?: string;
  name?: string;
  type?: string;
}

export interface ParsedStatement {
  parserId: string;
  bankName: string;
  account: ParsedAccount;
  transactions: ParsedTransaction[];
  /** Statement-level problems (e.g. lines that couldn't be read). */
  warnings: string[];
}

/**
 * To support another bank, implement this interface in a new file and add it
 * to the list in registry.ts. `detect` should be cheap and specific; `parse`
 * should throw a ParseError with a helpful message if it can't make sense of
 * the statement.
 */
export interface StatementParser {
  id: string;
  /** Shown to the user, e.g. "CommBank – Transaction Summary". */
  name: string;
  detect(pages: StatementPages): boolean;
  parse(pages: StatementPages): ParsedStatement;
}

/** An error whose message is safe and helpful to show to the user. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}
