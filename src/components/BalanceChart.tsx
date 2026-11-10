import { useState } from 'react';
import { formatDate, formatMonth } from '../lib/dates';
import type { BalancePoint } from '../lib/insights';
import { formatAUD } from '../lib/money';

const W = 360;
const H = 190;
const PAD = { top: 16, right: 12, bottom: 24, left: 52 };

/** Round a range outwards to tidy axis values. */
function niceRange(min: number, max: number): [number, number] {
  if (min === max) {
    min -= 100_00;
    max += 100_00;
  }
  const step = Math.pow(10, Math.floor(Math.log10(max - min)));
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/**
 * Account balance over time: one series, drawn as steps because a balance
 * stays put between transactions. Touch or hover to read a day's balance.
 */
export function BalanceChart({ points }: { points: BalancePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="hint center">Not enough balance history to chart yet.</p>;

  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const [lo, hi] = niceRange(Math.min(...points.map((p) => p.balance)), Math.max(...points.map((p) => p.balance)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (d: string) => PAD.left + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  let line = `M${x(points[0].date).toFixed(1)},${y(points[0].balance).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    line += ` H${x(points[i].date).toFixed(1)} V${y(points[i].balance).toFixed(1)}`;
  }
  const area = `${line} V${y(lo).toFixed(1)} H${x(points[0].date).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const shown = hover === null ? last : points[hover];

  function pick(clientX: number, el: SVGSVGElement) {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    }
    setHover(best);
  }

  return (
    <figure className="chart balance-chart">
      <figcaption className="chart-readout">
        <b>{formatAUD(shown.balance)}</b> <span className="muted">on {formatDate(shown.date)}</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Balance from ${formatDate(points[0].date)} to ${formatDate(last.date)}`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={v === lo ? 'axis' : 'grid'} />
            <text x={PAD.left - 6} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">
              {formatAUD(v, { whole: true })}
            </text>
          </g>
        ))}
        <path d={area} className="balance-area" />
        <path d={line} className="balance-line" />
        {hover !== null && <line x1={x(shown.date)} x2={x(shown.date)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />}
        <circle cx={x(shown.date)} cy={y(shown.balance)} r="4.5" className="balance-dot" />
        <text x={PAD.left} y={H - 6} className="tick">
          {formatMonth(points[0].date.slice(0, 7))}
        </text>
        <text x={W - PAD.right} y={H - 6} className="tick" textAnchor="end">
          {formatMonth(last.date.slice(0, 7))}
        </text>
      </svg>
    </figure>
  );
}
