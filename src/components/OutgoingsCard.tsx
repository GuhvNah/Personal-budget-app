import { useMemo, useState } from 'react';
import { formatAUD } from '../lib/money';
import {
  GROUP_LABEL,
  periodContaining,
  periodDates,
  shiftPeriod,
  summariseOutgoings,
  type OutgoingGroup,
  type PeriodKind,
} from '../lib/outgoings';
import { todayISO } from '../lib/dates';
import { useStore } from '../store';
import { Icon } from './ui';

const KINDS: [PeriodKind, string][] = [
  ['month', 'Month'],
  ['quarter', 'Quarter'],
  ['half', '6 months'],
  ['year', 'Year'],
];

const SIZE = 240;
const C = SIZE / 2;
const INNER = [52, 76] as const; // necessary vs unnecessary
const OUTER = [80, 116] as const; // categories

function pct(part: number, total: number) {
  return total ? `${Math.round((part / total) * 100)}%` : '0%';
}

/** SVG path for a ring segment between two angles (radians, 0 = 12 o'clock, clockwise). */
function arc(a0: number, a1: number, r0: number, r1: number): string {
  const span = Math.min(a1 - a0, Math.PI * 2 - 0.0001);
  const end = a0 + span;
  const pt = (a: number, r: number) => `${(C + r * Math.sin(a)).toFixed(2)},${(C - r * Math.cos(a)).toFixed(2)}`;
  const large = span > Math.PI ? 1 : 0;
  return `M${pt(a0, r1)} A${r1},${r1} 0 ${large} 1 ${pt(end, r1)} L${pt(end, r0)} A${r0},${r0} 0 ${large} 0 ${pt(a0, r0)} Z`;
}

/**
 * Outgoings for a calendar month / quarter / half-year / year as a two-ring
 * donut: inner ring necessary vs unnecessary, outer ring the categories in
 * each. Colour carries only the necessary/unnecessary split; category names
 * and amounts are in the list beside it (tap a slice or a row).
 */
export function OutgoingsCard({
  month,
  openTransactions,
}: {
  month: string;
  openTransactions(filter: { from: string; to: string; category: string }): void;
}) {
  const { transactions, categories } = useStore();
  const [kind, setKind] = useState<PeriodKind>('month');
  // Any month inside the period being shown. Follows the dashboard's month picker.
  const [anchor, setAnchor] = useState(month);
  const [lastMonth, setLastMonth] = useState(month);
  const [selected, setSelected] = useState<string | null>(null);
  if (month !== lastMonth) {
    setLastMonth(month);
    setAnchor(month);
    setSelected(null);
  }
  const period = periodContaining(anchor, kind);
  function go(by: number) {
    setAnchor(shiftPeriod(period, by).start);
    setSelected(null);
  }

  const { from, to } = periodDates(period);
  const data = useMemo(() => summariseOutgoings(transactions, categories, from, to), [transactions, categories, from, to]);
  const isCurrent = period.end >= todayISO().slice(0, 7);

  // Lay out both rings with the same angles so each group's categories sit outside it.
  let angle = 0;
  const inner: { key: string; group: OutgoingGroup; d: string }[] = [];
  const outer: { key: string; group: OutgoingGroup; d: string; tint: number }[] = [];
  for (const g of data.groups) {
    const start = angle;
    g.slices.forEach((s, i) => {
      const a1 = angle + (s.amount / data.total) * Math.PI * 2;
      outer.push({ key: `${g.group}|${s.categoryId}`, group: g.group, d: arc(angle, a1, ...OUTER), tint: i % 2 });
      angle = a1;
    });
    inner.push({ key: g.group, group: g.group, d: arc(start, angle, ...INNER) });
  }

  const sel = selected
    ? data.groups.flatMap((g) => [
        ...(selected === g.group ? [{ name: GROUP_LABEL[g.group], amount: g.amount }] : []),
        ...g.slices.filter((s) => selected === `${g.group}|${s.categoryId}`),
      ])[0]
    : undefined;
  const dim = (key: string, group: string) => selected !== null && selected !== key && selected !== group;

  return (
    <section className="card outgoings">
      <h3>Outgoings</h3>
      <div className="segmented small" role="radiogroup" aria-label="Time period">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="period-nav">
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous period">
          <Icon name="left" />
        </button>
        <span>{period.label}</span>
        <button
          className="icon-btn"
          onClick={() => go(1)}
          disabled={isCurrent}
          aria-label="Next period"
        >
          <Icon name="right" />
        </button>
      </div>

      {data.total === 0 ? (
        <p className="hint center">No spending in this period.</p>
      ) : (
        <>
          <div className="split-summary">
            {data.groups.map((g) => (
              <span key={g.group} className="split-item">
                <span className={`swatch ${g.group}`} aria-hidden="true" />
                {GROUP_LABEL[g.group]} <b>{formatAUD(g.amount, { whole: true })}</b>{' '}
                <span className="muted">{pct(g.amount, data.total)}</span>
              </span>
            ))}
          </div>
          <figure className="donut">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Outgoings by necessary and unnecessary, then by category">
              {outer.map((s) => (
                <path
                  key={s.key}
                  d={s.d}
                  className={`slice ${s.group} tint${s.tint} ${dim(s.key, s.group) ? 'dim' : ''}`}
                  onClick={() => setSelected(selected === s.key ? null : s.key)}
                />
              ))}
              {inner.map((s) => (
                <path
                  key={s.key}
                  d={s.d}
                  className={`slice ${s.group} ring-inner ${dim(s.key, s.group) ? 'dim' : ''}`}
                  onClick={() => setSelected(selected === s.key ? null : s.key)}
                />
              ))}
              <g className="donut-centre" onClick={() => setSelected(null)}>
                <circle cx={C} cy={C} r={INNER[0] - 2} fill="transparent" />
                <text x={C} y={C - 8} textAnchor="middle" className="centre-label">
                  {sel ? (sel.name.length > 14 ? sel.name.slice(0, 13) + '…' : sel.name) : 'Total'}
                </text>
                <text x={C} y={C + 12} textAnchor="middle" className="centre-value">
                  {formatAUD(sel ? sel.amount : data.total, { whole: true })}
                </text>
                {sel && (
                  <text x={C} y={C + 28} textAnchor="middle" className="centre-label">
                    {pct(sel.amount, data.total)}
                  </text>
                )}
              </g>
            </svg>
          </figure>

          <ul className="outgoings-list">
            {data.groups.map((g) => (
              <li key={g.group}>
                <div className="og-head">
                  <span className={`swatch ${g.group}`} aria-hidden="true" />
                  <span className="og-name">{GROUP_LABEL[g.group]}</span>
                  <span className="og-amt">{formatAUD(g.amount)}</span>
                  <span className="og-pct">{pct(g.amount, data.total)}</span>
                </div>
                {g.slices.map((s) => (
                  <button
                    key={`${g.group}|${s.categoryId}`}
                    className={`og-row ${selected === `${g.group}|${s.categoryId}` ? 'active' : ''}`}
                    onClick={() => openTransactions({ from, to, category: s.categoryId ?? 'none' })}
                  >
                    <span className="og-name">{s.name}</span>
                    <span className="og-amt">{formatAUD(s.amount)}</span>
                    <span className="og-pct">{pct(s.amount, data.total)}</span>
                  </button>
                ))}
              </li>
            ))}
          </ul>
          <p className="hint">
            Tap a slice to see it in the middle, or a row to see its transactions. Change what counts as necessary in
            Settings → Categories, or for one transaction by tapping it.
          </p>
        </>
      )}
    </section>
  );
}
