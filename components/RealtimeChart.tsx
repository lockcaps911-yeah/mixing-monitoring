'use client';

import type { Point } from '@/lib/types';

export type Series = {
  tag: string; name: string; unit: string | null;
  digits?: number;
  pts: Point[];
  band?: [number, number, number][];   // [waktu, min, maks] -> area transparan di sekitar garis rata-rata
};

const W = 900;
const H = 290;
const PL = 52;
const PR = 16;
const PT = 12;
const PB = 28;

export const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
export const DASHES = ['', '7 4', '2 3', '9 3 2 3', '', '7 4'];

export function fmtClock(ts: number, withSeconds = true) {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
}
export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
export const fmtDateTime = (ts: number) => `${fmtDate(ts)} ${fmtClock(ts, false)}`;

export function xDomain(series: Series[], windowMs: number, now: number | null) {
  const lastTs = Math.max(0, ...series.map((s) => (s.pts.length ? s.pts[s.pts.length - 1][0] : 0)));
  const xMax = now === null ? lastTs : Math.max(now, lastTs);
  return { xMin: xMax - windowMs, xMax };
}

export function valueAt(pts: Point[], t: number, tol = 6000): number | null {
  let lo = 0;
  let hi = pts.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  let best = pts[lo];
  if (lo > 0 && Math.abs(pts[lo - 1][0] - t) < Math.abs(best[0] - t)) best = pts[lo - 1];
  return Math.abs(best[0] - t) <= tol ? best[1] : null;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const raw = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

const STEPS = [10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 21600e3, 43200e3, 86400e3, 172800e3, 604800e3];
const pickStep = (win: number) => STEPS.find((s) => win / s <= 7) ?? STEPS[STEPS.length - 1];

type Props = {
  series: Series[];
  windowMs: number;
  now: number | null;      // null sampai mounted
  hoverFrac: number | null;
  onHover: (frac: number | null) => void;
  gapMs?: number;          // jeda data yang memutus garis
};

export default function RealtimeChart({ series, windowMs, now, hoverFrac, onHover, gapMs = 15_000 }: Props) {
  const { xMin, xMax } = xDomain(series, windowMs, now);
  const vis = series.map((s) => s.pts.filter((p) => p[0] >= xMin));
  const bands = series.map((s) => (s.band ?? []).filter((b) => b[0] >= xMin));
  const pw = W - PL - PR;
  const ph = H - PT - PB;

  let rawLo = Infinity;
  let rawHi = -Infinity;
  vis.forEach((pts) => pts.forEach((p) => { rawLo = Math.min(rawLo, p[1]); rawHi = Math.max(rawHi, p[1]); }));
  bands.forEach((bs) => bs.forEach((b) => { rawLo = Math.min(rawLo, b[1]); rawHi = Math.max(rawHi, b[2]); }));
  const hasData = rawLo !== Infinity;
  if (!hasData) { rawLo = 0; rawHi = 1; }
  const pad = (rawHi - rawLo) * 0.12 || 1;
  let lo = rawLo - pad;
  const hi = rawHi + pad;
  if (rawLo >= 0 && lo < 0) lo = 0;

  const sx = (t: number) => PL + ((t - xMin) / windowMs) * pw;
  const sy = (v: number) => PT + ph - ((v - lo) / (hi - lo)) * ph;

  const yTicks = niceTicks(lo, hi);
  const step = pickStep(windowMs);
  const off = -new Date(xMin).getTimezoneOffset() * 60_000; // sejajarkan tick dengan jam lokal
  const xTicks: number[] = [];
  for (let t = Math.ceil((xMin + off) / step) * step - off; t <= xMax; t += step) xTicks.push(t);
  const tickLabel = (t: number) => (step >= 86_400_000 ? fmtDate(t) : fmtClock(t, step < 60_000));

  const pathOf = (pts: Point[]) => {
    let d = '';
    let prev = -Infinity;
    for (const [t, v] of pts) {
      d += `${t - prev > gapMs ? 'M' : 'L'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`;
      prev = t;
    }
    return d;
  };
  const bandPath = (bs: [number, number, number][]) => {
    const segs: [number, number, number][][] = [];
    let prev = -Infinity;
    for (const b of bs) {
      if (b[0] - prev > gapMs) segs.push([]);
      segs[segs.length - 1].push(b);
      prev = b[0];
    }
    return segs
      .filter((s) => s.length > 1)
      .map((s) => `M${s.map((b) => `${sx(b[0]).toFixed(1)},${sy(b[2]).toFixed(1)}`).join('L')}L${[...s].reverse().map((b) => `${sx(b[0]).toFixed(1)},${sy(b[1]).toFixed(1)}`).join('L')}Z`)
      .join('');
  };

  const hoverT = hoverFrac == null ? null : xMin + hoverFrac * windowMs;
  const tol = Math.max(6000, gapMs / 2);

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (((e.clientX - r.left) / r.width) * W - PL) / pw;
    onHover(frac >= 0 && frac <= 1 ? frac : null);
  };

  return (
    <svg className="mm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Grafik tren"
         onPointerMove={move} onPointerLeave={() => onHover(null)} onPointerCancel={() => onHover(null)}>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="grid" x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} />
          <text x={PL - 8} y={sy(v) + 4} textAnchor="end">
            {v.toLocaleString('id-ID', {
              minimumFractionDigits: series[0]?.digits ?? 1,
              maximumFractionDigits: series[0]?.digits ?? 1,
            })}
          </text>
        </g>
      ))}
      {now !== null && xTicks.map((t) => (
        <g key={t}>
          <line className="grid v" x1={sx(t)} x2={sx(t)} y1={PT} y2={PT + ph} />
          <text x={sx(t)} y={H - 8} textAnchor="middle">{tickLabel(t)}</text>
        </g>
      ))}

      {!hasData && <text className="empty" x={PL + pw / 2} y={PT + ph / 2} textAnchor="middle">Belum ada data pada rentang ini</text>}

      {bands.map((bs, i) => bs.length > 1 && (
        <path key={`b${series[i].tag}`} d={bandPath(bs)} fill={COLORS[i % COLORS.length]} opacity={0.14} />
      ))}
      {vis.map((pts, i) => (
        <path key={series[i].tag} className="line" d={pathOf(pts)} fill="none" stroke={COLORS[i % COLORS.length]}
              strokeDasharray={DASHES[i % DASHES.length] || undefined} />
      ))}
      {vis.map((pts, i) => {
        const last = pts[pts.length - 1];
        return last ? <circle key={`c${series[i].tag}`} cx={sx(last[0])} cy={sy(last[1])} r={3.5} fill={COLORS[i % COLORS.length]} /> : null;
      })}

      {hoverT !== null && hoverFrac !== null && (
        <g>
          <line className="cursor" x1={PL + hoverFrac * pw} x2={PL + hoverFrac * pw} y1={PT} y2={PT + ph} />
          {series.map((s, i) => {
            const v = valueAt(s.pts, hoverT, tol);
            return v === null ? null : (
              <circle key={s.tag} cx={PL + hoverFrac * pw} cy={sy(v)} r={4} fill="var(--panel)" stroke={COLORS[i % COLORS.length]} strokeWidth={2} />
            );
          })}
        </g>
      )}
    </svg>
  );
}
