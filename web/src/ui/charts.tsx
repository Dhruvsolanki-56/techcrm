import { compact, money } from '@crm/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Series { name: string; values: number[]; color: string; fill?: boolean; dash?: boolean }

/** Width of an element, kept up to date, so SVG text stays the same size however wide the panel is. */
function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setW(Math.max(280, Math.round(el.clientWidth || fallback)));
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

/** Line chart: animated draw-in, hover / touch / arrow-key crosshair with a tooltip card. */
export function LineChart({ series, labels, h = 200, fmt = compact, tipFmt = money, net }: {
  series: Series[]; labels: string[]; h?: number; fmt?(n: number): string; tipFmt?(n: number): string; net?: boolean;
}) {
  const [wrap, W] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const H = h;
  const L = 44; const R = 12; const T = 14; const B = 28;
  const n = labels.length;
  const geo = useMemo(() => {
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? mag * 10);
    const top = step * 4;
    const x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
    const y = (v: number) => T + (H - T - B) * (1 - v / top);
    return { step, x, y };
  }, [series, n, H, L, B, W]);
  const { step, x, y } = geo;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const idxAt = (clientX: number) => {
    const r = wrap.current?.querySelector('svg')?.getBoundingClientRect();
    if (!r) return 0;
    const px = clientX - r.left;
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };
  const k = 1;
  const tipW = 180;
  const wrapW = wrap.current?.clientWidth ?? W;
  let tipLeft = 0;
  let tipTop = 0;
  if (at !== null) {
    const px = x(at) * k;
    tipLeft = px + 14 + tipW > wrapW ? px - tipW - 14 : px + 14;
    tipLeft = Math.max(0, Math.min(wrapW - tipW, tipLeft));
    tipTop = Math.max(0, Math.min(...series.map((s) => y(s.values[at] ?? 0))) * k - 20);
  }
  const netVal = at !== null && series.length === 2 && net ? (series[0]?.values[at] ?? 0) - (series[1]?.values[at] ?? 0) : null;

  return (
    <div ref={wrap} role="group" className={`chartw${at !== null ? ' hover' : ''}`} tabIndex={0}
      aria-label={`${series.map((s) => s.name).join(' and ')} by month. Use the arrow keys to read each month.`}
      onPointerMove={(e) => setAt(idxAt(e.clientX))} onPointerDown={(e) => setAt(idxAt(e.clientX))} onPointerLeave={() => setAt(null)} onBlur={() => setAt(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setAt((a) => Math.max(0, (a ?? n) - 1)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setAt((a) => Math.min(n - 1, (a ?? -1) + 1)); }
        else if (e.key === 'Escape') setAt(null);
      }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line className="gl" x1={L} x2={W - R} y1={y(step * i)} y2={y(step * i)} />
            <text x={L - 8} y={y(step * i) + 4} textAnchor="end">{fmt(step * i)}</text>
          </g>
        ))}
        {labels.map((l, i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className={`xl${at === i ? ' on' : ''}`}>{l}</text>)}
        <line className="cross" x1={at !== null ? x(at) : 0} x2={at !== null ? x(at) : 0} y1={T} y2={H - B} />
        <g className="series">
          {series.map((s) => (
            <g key={s.name}>
              {s.fill && <path className="area" d={`${path(s.values)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} style={{ fill: s.color }} />}
              <path d={path(s.values)} fill="none" style={{ stroke: s.color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash ? '5 4' : undefined} />
            </g>
          ))}
        </g>
        {series.map((s) => <circle key={s.name} className="hit" r="4.5" cx={at !== null ? x(at) : -20} cy={at !== null ? y(s.values[at] ?? 0) : -20} style={{ stroke: s.color }} />)}
      </svg>
      <div className="ctip" role="status" style={{ left: tipLeft, top: tipTop }}>
        {at !== null && (
          <>
            <b>{labels[at]}</b>
            {series.map((s) => <div className="r" key={s.name}><i style={{ background: s.color }} /><span>{s.name}</span><em>{tipFmt(s.values[at] ?? 0)}</em></div>)}
            {netVal !== null && <div className="r net"><span>Net</span><em className={netVal < 0 ? 'neg' : 'pos'}>{netVal < 0 ? '−' : ''}{money(Math.abs(netVal))}</em></div>}
          </>
        )}
      </div>
    </div>
  );
}

export const Legend = ({ items }: { items: { name: string; color: string }[] }) => (
  <div className="legend">{items.map((i) => <span key={i.name} style={{ ['--c' as string]: i.color }}>{i.name}</span>)}</div>
);

export interface BarRow { k: string; v: number; to?: string; sub?: string }
/** Horizontal bars, one row per group. */
export function HBars({ rows, fmt = money, accent, empty = 'No data for this period.' }: { rows: BarRow[]; fmt?(n: number): string; accent?: boolean; empty?: ReactNode }) {
  if (!rows.length) return <div className="faint small">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className={`hbars ${accent ? 'accent' : ''}`}>
      {rows.map((r) => {
        const inner = <><span title={r.k}>{r.k}</span><div className="tr"><i style={{ width: `${Math.max(2, (100 * r.v) / max)}%` }} /></div><span className="right tnum">{fmt(r.v)}</span></>;
        return r.to ? <Link className="r" key={r.k} to={r.to}>{inner}</Link> : <div className="r" key={r.k}>{inner}</div>;
      })}
    </div>
  );
}

export interface FunnelRow { key: string; label: string; n: number; v?: number; to?: string }
/** Stage funnel: bar length = count, right column = value. */
export function Funnel({ rows, valueFmt = compact }: { rows: FunnelRow[]; valueFmt?(n: number): string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <>
      {rows.map((r) => {
        const inner = <><span className="muted">{r.label}</span><div className="tr"><i style={{ width: `${Math.max(r.n ? 6 : 0, (100 * r.n) / max)}%` }}>{r.n || ''}</i></div><span className="right tnum small">{r.v != null ? `₹${valueFmt(r.v)}` : ''}</span></>;
        return r.to ? <Link className="r" key={r.key} to={r.to}>{inner}</Link> : <div className="r" key={r.key}>{inner}</div>;
      })}
    </>
  );
}

/** Vertical grouped columns (e.g. leads added vs converted per month). */
export function Columns({ labels, series, h = 180, fmt = (n: number) => String(Math.round(n)) }: { labels: string[]; series: { name: string; values: number[]; color: string }[]; h?: number; fmt?(n: number): string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const L = 42; const B = 24; const T = 8;
  const w = Math.max(W, labels.length * 34 + L);
  const slot = (w - L) / labels.length;
  const bw = Math.min(16, (slot - 8) / series.length);
  return (
    <div ref={ref} style={{ overflowX: 'auto' }}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {[0, 0.5, 1].map((p) => <g key={p}><line className="gl" x1={L} x2={w} y1={T + (h - T - B) * (1 - p)} y2={T + (h - T - B) * (1 - p)} /><text x={L - 6} y={T + (h - T - B) * (1 - p) + 4} textAnchor="end">{fmt(max * p)}</text></g>)}
        {labels.map((l, i) => (
          <g key={l + i}>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const bh = ((h - T - B) * v) / max;
              const x = L + i * slot + (slot - bw * series.length) / 2 + si * bw;
              return <rect key={s.name} x={x} y={h - B - bh} width={bw - 2} height={bh} rx="2" fill={s.color}><title>{`${l} · ${s.name}: ${fmt(v)}`}</title></rect>;
            })}
            <text x={L + i * slot + slot / 2} y={h - 8} textAnchor="middle">{l}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Donut with a centre label — shares of a whole. */
export function Donut({ rows, center, fmt = money }: { rows: { k: string; v: number; color: string }[]; center?: ReactNode; fmt?(n: number): string }) {
  const total = rows.reduce((s, r) => s + r.v, 0);
  const r = 42; const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 110 110" width="130" height="130" role="img" aria-label="Share breakdown">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--hover)" strokeWidth="14" />
        {total > 0 && rows.map((x) => {
          const len = (x.v / total) * c;
          const el = <circle key={x.k} cx="55" cy="55" r={r} fill="none" stroke={x.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 55 55)"><title>{`${x.k}: ${fmt(x.v)}`}</title></circle>;
          off += len;
          return el;
        })}
        <text x="55" y="59" textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: 'var(--ink)' }}>{center}</text>
      </svg>
      <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
        {rows.map((x) => <span key={x.k} style={{ ['--c' as string]: x.color }}>{x.k} · {fmt(x.v)} <small className="faint">({total ? Math.round((x.v / total) * 100) : 0}%)</small></span>)}
      </div>
    </div>
  );
}

export const PALETTE = ['var(--accent)', '#c47f17', 'var(--blue)', 'var(--plum)', 'var(--green)', 'var(--red)', 'var(--ink-2)', '#8a8780'];
