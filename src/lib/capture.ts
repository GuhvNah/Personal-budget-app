import type { Cents, ISODate, Transaction } from './types';

/*
 * Real-time capture of card purchases from phone notifications.
 *
 * An automation app (e.g. MacroDroid) watches for Google Wallet / CommBank
 * payment notifications and opens the budget app with a link like:
 *
 *   https://…/Personal-budget-app/#capture=<key>&t=<notification title>&b=<notification text>
 *
 * Everything is in the #fragment, which browsers never send to a server, so
 * purchase details stay on the phone. The key stops other apps or websites
 * from adding transactions.
 */

export interface CaptureRequest {
  key: string;
  title: string;
  body: string;
}

function decode(s: string): string {
  // Automation apps don't always URL-encode; decode what we can, keep the rest.
  try {
    return decodeURIComponent(s.replace(/\+(?=\S)/g, ' '));
  } catch {
    return s.replace(/%20/g, ' ');
  }
}

/** Read a capture link's #fragment. Returns null if it isn't one. */
export function parseCaptureFragment(hash: string): CaptureRequest | null {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith('capture=')) return null;
  // Split on the known markers rather than every "&", since notification text may contain "&".
  const m = /^capture=([^&]*)(?:&t=(.*?))?(?:&b=(.*))?$/s.exec(h);
  if (!m) return null;
  return { key: decode(m[1] ?? ''), title: decode(m[2] ?? '').trim(), body: decode(m[3] ?? '').trim() };
}

export function captureLink(base: string, key: string, title = '[notification_title]', body = '[notification]'): string {
  return `${base.replace(/#.*$/, '')}#capture=${key}&t=${title}&b=${body}`;
}

export function newCaptureKey(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export interface ParsedPurchase {
  /** Negative for a purchase, positive for a refund. */
  amount: Cents;
  merchant: string;
}

const MONEY = /(?:A\$|AUD\s?|\$)\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?/i;
const APP_NAMES = /^(google wallet|google pay|g ?pay|wallet|samsung wallet|samsung pay|commbank|commonwealth bank|netbank)$/i;
const NOT_A_PURCHASE = /\b(declined|failed|unsuccessful|didn'?t go through|not processed|cancelled|card (?:added|removed)|verify|ready to use)\b/i;
const REFUND = /\b(refund(?:ed)?|reversal|reversed|returned|money in|received)\b/i;

function cleanMerchant(s: string): string {
  return s
    .replace(MONEY, ' ')
    .replace(/\b(?:with|using|on|from)\s+(?:your\s+)?(?:visa|mastercard|debit|credit|card|commbank|everyday|smart access)\b.*$/i, '')
    .replace(/\b(?:visa|mastercard|debit card|credit card)\b.*?(?:•+|\*+|x{2,})\s*\d{4}\b/i, '')
    .replace(/(?:•+|\*{2,}|x{2,})\s*\d{4}\b/gi, '')
    .replace(/^(?:you(?:'ve| have)?\s+(?:spent|paid)|payment(?: of)?|purchase(?: of)?|spent|paid|charged)\b/i, '')
    .replace(/^\s*(?:refund(?:ed)?|reversal)(?:\s+(?:from|to))?\b/i, '')
    .replace(/^\s*(?:at|to)\s+/i, '')
    .replace(/[\s.,:;–-]+$/g, '')
    .replace(/^[\s.,:;–-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull the amount and merchant out of a payment notification. Tolerant of
 * different wordings, e.g.
 *   title "ALDI Midland", text "$12.50 with Visa •• 1234"           (Google Wallet)
 *   title "CommBank", text "You spent $12.50 at ALDI STORES MIDLAND" (CommBank)
 *   title "$12.50 at ALDI", text "Paid with Mastercard ••1234"
 * Returns null when there's no amount or it isn't a completed purchase.
 */
/** Words that are left over from the notification wording, not a shop name. */
const FILLER = /^(?:paid|spent|payment|purchase|refunded|refund|received|approved|successful|complete[d]?|done)$/i;

export function parseNotification(title: string, body: string): ParsedPurchase | null {
  const all = `${title} ${body}`;
  if (NOT_A_PURCHASE.test(all)) return null;
  const money = MONEY.exec(body) ?? MONEY.exec(title);
  if (!money) return null;
  const cents = Number(money[1].replace(/,/g, '')) * 100 + Number(money[2] ?? 0);
  if (!cents) return null;

  let merchant = '';
  const at = /\b(?:at|to)\s+(.+?)(?=\s+(?:with|using|on|for)\b|[.,!]|$)/i.exec(body) ?? /\b(?:at|to)\s+(.+?)(?=\s+(?:with|using|on|for)\b|[.,!]|$)/i.exec(title);
  if (at) merchant = cleanMerchant(at[1]);
  if (!merchant && !APP_NAMES.test(title.trim())) merchant = cleanMerchant(title);
  if (!merchant || FILLER.test(merchant)) merchant = cleanMerchant(body);
  if (!merchant || APP_NAMES.test(merchant) || FILLER.test(merchant)) merchant = 'Card purchase';

  return { amount: REFUND.test(all) ? cents : -cents, merchant };
}

/** Local date of a timestamp as ISO. */
export function isoDate(ms: number): ISODate {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Was this purchase already captured a moment ago? (Google Wallet and
 * CommBank both notify for the same tap, and automations can fire twice.)
 */
export function isRepeatCapture(amount: Cents, now: number, existing: Pick<Transaction, 'source' | 'amount' | 'createdAt'>[], windowMs = 10 * 60_000): boolean {
  return existing.some((t) => t.source === 'capture' && t.amount === amount && Math.abs(now - t.createdAt) <= windowMs);
}

function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Pair statement transactions with pending captured purchases: same amount,
 * statement date from 1 day before to 5 days after the capture (purchases can
 * take a few days to post). Each capture is used once; closest date wins.
 * Returns statement index -> captured transaction.
 */
export function matchCaptured<T extends Pick<Transaction, 'id' | 'amount' | 'date'>>(
  statement: { amount: Cents; date: ISODate }[],
  pending: T[],
): Map<number, T> {
  const used = new Set<string>();
  const out = new Map<number, T>();
  statement.forEach((s, i) => {
    let best: T | undefined;
    let bestGap = Infinity;
    for (const c of pending) {
      if (used.has(c.id) || c.amount !== s.amount) continue;
      const gap = daysBetween(c.date, s.date);
      if (gap < -1 || gap > 5) continue;
      if (Math.abs(gap) < bestGap) {
        best = c;
        bestGap = Math.abs(gap);
      }
    }
    if (best) {
      used.add(best.id);
      out.set(i, best);
    }
  });
  return out;
}
