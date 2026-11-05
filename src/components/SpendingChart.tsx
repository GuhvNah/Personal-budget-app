import { formatAUD } from '../lib/money';
import { formatMonth } from '../lib/dates';
import type { Cents } from '../lib/types';

/** Rounded-up "nice" axis maximum: 1, 2, 2.5 or 5 × 10^n. */
function niceMax(v: number): number {
  if (v <= 0) return 100_00;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/**
 * Single-series bar chart of monthly spending. One hue, no legend (the
 * heading names the series). Tap a bar to select that month; only the
 * selected bar carries a direct value label.
 */
export function SpendingChart({
  data,
  selected,
  onSelect,
}: {
  data: { month: string; spending: Cents }[];
  selected: string;
  onSelect(month: string): void;
}) {
  const W = 360;
  const H = 200;
  const pad = { top: 26, right: 8, bottom: 26, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.spending), 0));
  const ticks = [0, max / 2, max];
  const slot = plotW / data.length;
  const barW = Math.min(36, slot * 0.6);
  const y = (v: number) => pad.top + plotH - (Math.max(v, 0) / max) * plotH;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spending per month">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? 'axis' : 'grid'}
            />
            <text x={pad.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {formatAUD(t, { whole: true })}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const top = y(d.spending);
          const h = pad.top + plotH - top;
          const r = Math.min(4, h);
          const x0 = cx - barW / 2;
          const isSel = d.month === selected;
          const path =
            h <= 0
              ? ''
              : `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z`;
          return (
            <g key={d.month} className={`bar ${isSel ? 'selected' : ''}`} onClick={() => onSelect(d.month)}>
              {/* Hit target taller and wider than the mark */}
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH + pad.bottom} fill="transparent" />
              <path d={path} />
              <title>{`${formatMonth(d.month, true)}: ${formatAUD(d.spending)}`}</title>
              {isSel && (
                <text x={cx} y={top - 6} textAnchor="middle" className="value">
                  {formatAUD(d.spending, { whole: true })}
                </text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className={`tick ${isSel ? 'sel' : ''}`}>
                {formatMonth(d.month).split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="chart-table">
        <summary>Show as table</summary>
        <table>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <th scope="row">{formatMonth(d.month, true)}</th>
                <td>{formatAUD(d.spending)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
