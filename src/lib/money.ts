import type { Cents } from './types';

const fmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const fmtWhole = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

/** Format cents as AUD, e.g. -10295 -> "-$102.95". */
export function formatAUD(cents: Cents, opts: { whole?: boolean } = {}): string {
  return (opts.whole ? fmtWhole : fmt).format(cents / 100);
}

/**
 * Parse a money string into integer cents. Accepts things like
 * "-$1,234.56", "$5.00", "+4913.92", "(12.50)", "12.50 DR", "12.50 CR", "1234".
 * Returns null if the text isn't a recognisable amount.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let negative = false;

  const drcr = /\s*(DR|CR)$/i.exec(s);
  if (drcr) {
    negative = drcr[1].toUpperCase() === 'DR';
    s = s.slice(0, drcr.index);
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^AUD\s*/i, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/^\$/, '').replace(/^-/, () => {
    negative = !negative;
    return '';
  });
  s = s.replace(/,/g, '').trim();

  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Convert a user-typed dollar amount (e.g. "12.5") to positive cents. */
export function dollarsToCents(input: string): Cents | null {
  const c = parseMoney(input);
  return c === null ? null : Math.abs(c);
}

export function centsToInput(cents: Cents): string {
  return (Math.abs(cents) / 100).toFixed(2);
}
