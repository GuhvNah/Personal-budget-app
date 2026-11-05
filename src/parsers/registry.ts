import { commbankTransactionSummary } from './commbank';
import { ParseError, type ParsedStatement, type StatementParser, type StatementPages } from './types';

/**
 * All known statement parsers, tried in order. To add a bank, create a new
 * parser file implementing StatementParser and add it here.
 */
export const PARSERS: StatementParser[] = [commbankTransactionSummary];

export function parseStatementPages(pages: StatementPages): ParsedStatement {
  const text = pages.flat().join('').trim();
  if (!text) {
    throw new ParseError(
      "This PDF doesn't contain any readable text. It may be a scanned image – try downloading the statement again from your bank's app or website.",
    );
  }
  const parser = PARSERS.find((p) => p.detect(pages));
  if (!parser) {
    throw new ParseError(
      `This PDF isn't a statement format I recognise. Supported formats: ${PARSERS.map((p) => p.name).join(', ')}. You can use CSV import instead.`,
    );
  }
  return parser.parse(pages);
}
