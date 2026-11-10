import { useEffect, type ReactNode } from 'react';
import { formatAUD } from '../lib/money';
import type { Category, Cents } from '../lib/types';

/** Bottom sheet / modal. Closes on backdrop tap and Android back gesture is left to the browser. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Amount({ cents, className = '' }: { cents: Cents; className?: string }) {
  return (
    <span className={`amount ${cents > 0 ? 'credit' : ''} ${className}`}>
      {cents > 0 ? '+' : ''}
      {formatAUD(cents)}
    </span>
  );
}

export function CategorySelect({
  categories,
  value,
  onChange,
  allowNone = true,
  noneLabel = 'Uncategorised',
  id,
}: {
  categories: Category[];
  value: string | null;
  onChange(id: string | null): void;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
}) {
  const groups: [string, Category[]][] = [
    ['Spending', categories.filter((c) => c.kind === 'expense')],
    ['Income', categories.filter((c) => c.kind === 'income')],
    ['Not counted', categories.filter((c) => c.kind === 'transfer')],
  ];
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {groups.map(
        ([label, cats]) =>
          cats.length > 0 && (
            <optgroup key={label} label={label}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ),
      )}
    </select>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  check: 'M5 12l5 5L20 7',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
};

export function Icon({ name, size = 24 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
