import type { ISODate } from './types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

export function toISO(y: number, m: number, d: number): ISODate | null {
  if (!valid(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/** "02 Jan 2026" / "2 January 2026" -> "2026-01-02" */
export function parseDayMonthName(s: string): ISODate | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  return toISO(expandYear(Number(m[3])), month, Number(m[1]));
}

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'D Mon YYYY';

/** Parse a date in the given format. Separators /, - and . are all accepted. */
export function parseDate(s: string, format: DateFormat = 'DD/MM/YYYY'): ISODate | null {
  const t = s.trim();
  if (format === 'D Mon YYYY') return parseDayMonthName(t.replace(/[-/]/g, ' '));
  const parts = t.split(/[/.\-\s]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  let y: number, mo: number, d: number;
  if (format === 'DD/MM/YYYY') [d, mo, y] = parts;
  else if (format === 'MM/DD/YYYY') [mo, d, y] = parts;
  else [y, mo, d] = parts;
  return toISO(expandYear(y), mo, d);
}

/** "2026-01-02" -> "02/01/2026" */
export function formatDate(iso: ISODate): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-01" -> "Jan 2026" (or "January 2026" with long=true) */
export function formatMonth(ym: string, long = false): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', {
    month: long ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function monthOf(iso: ISODate): string {
  return iso.slice(0, 7);
}

/** Add n months to a "YYYY-MM" string. */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Today in the device's local time zone, as ISO. */
export function todayISO(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
