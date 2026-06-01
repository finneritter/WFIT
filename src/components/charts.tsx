// Minimal SVG charts (sparkline, mini area, big chart) driven by real series.
// No deps — just polylines, matching the wireframe's monochrome look.

function points(data: number[], w: number, h: number, pad = 1): string {
  if (data.length === 0) return "";
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  return data
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Spark({ data, w = 60, h = 18 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return <svg width={w} height={h} />;
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        points={points(data, w, h)}
        fill="none"
        stroke={up ? "var(--pos)" : "var(--neg)"}
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function MiniArea({
  data,
  w = 220,
  h = 44,
  accent = "var(--accent)",
}: {
  data: number[];
  w?: number;
  h?: number;
  accent?: string;
}) {
  if (!data || data.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} />;
  const line = points(data, w, h, 2);
  const area = `${line} ${w - 2},${h} 2,${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={area} fill={accent} opacity="0.08" />
      <polyline points={line} fill="none" stroke={accent} strokeWidth="1.5" />
    </svg>
  );
}

/** Where the current price sits within its lookback low..high (the 52-week-range
 *  pattern). The fill reads as "how elevated": near-full = expensive, sliver = cheap. */
export function RangeBar({ pos, low, high }: { pos: number; low: number; high: number }) {
  const p = Math.max(0, Math.min(1, pos)) * 100;
  return (
    <span className="rbar" title={`range ${low}–${high}p · ${p.toFixed(0)}% of range`}>
      <span className="rbar-end num">{low}</span>
      <span className="rbar-track">
        <span className="rbar-fill" style={{ width: `${p}%` }} />
        <span className="rbar-dot" style={{ left: `${p}%` }} />
      </span>
      <span className="rbar-end num">{high}</span>
    </span>
  );
}

export function BigChart({ data, w = 380, h = 150 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) {
    return <div className="muted">No price history yet.</div>;
  }
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "var(--pos)" : "var(--neg)";
  const line = points(data, w, h, 3);
  const area = `${line} ${w - 3},${h} 3,${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={area} fill={stroke} opacity="0.08" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.6" />
    </svg>
  );
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Trailing moving average of closes; entries are null until `period` points. */
function movingAvg(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i + 1 < period) return null;
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += closes[k];
    return s / period;
  });
}

/** Candlestick chart with volume bars, MA(7)/MA(30) overlays and period hi/lo
 *  reference lines. Driven by real OHLC from warframe.market statistics. */
export function CandleChart({
  candles,
  w = 560,
  h = 240,
}: { candles: Candle[]; w?: number; h?: number }) {
  if (!candles || candles.length < 2) {
    return <div className="muted">No price history yet — refreshing in the background.</div>;
  }
  const priceH = Math.round(h * 0.72);
  const volTop = priceH + 10;
  const volH = h - volTop;

  // Robust price domain: a lone troll spike (e.g. 1000p on a 2p mod) must not
  // flatten the chart. Scale to the 4th–96th percentile of all OHLC values, padded;
  // values outside clip to the edges rather than blowing out the axis.
  const vals = candles
    .flatMap((c) => [c.l, c.h, c.o, c.c])
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const q = (p: number) =>
    vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  let lo = q(0.04);
  let hi = q(0.96);
  if (!(hi > lo)) {
    lo = vals[0] ?? 0;
    hi = vals[vals.length - 1] ?? lo + 1;
  }
  const padB = (hi - lo) * 0.08 || 1;
  lo = Math.max(0, lo - padB);
  hi = hi + padB;
  const span = hi - lo || 1;
  const vmax = Math.max(1, ...candles.map((c) => c.v));
  const n = candles.length;
  const pad = 3;
  const step = (w - pad * 2) / n;
  const bodyW = Math.max(1, step * 0.62);

  const clampP = (p: number) => Math.max(lo, Math.min(hi, p));
  const yP = (p: number) => 1 + (priceH - 2) * (1 - (clampP(p) - lo) / span);
  const cx = (i: number) => pad + step * i + step / 2;

  const closes = candles.map((c) => c.c);
  const ma7 = movingAvg(closes, 7);
  const ma30 = movingAvg(closes, 30);
  const maLine = (ma: (number | null)[]) =>
    ma
      .map((v, i) => (v == null ? null : `${cx(i).toFixed(1)},${yP(v).toFixed(1)}`))
      .filter((p): p is string => p != null)
      .join(" ");

  return (
    <svg className="candle" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {/* period hi/lo reference lines */}
      <line x1="0" y1={yP(hi)} x2={w} y2={yP(hi)} className="cref" />
      <line x1="0" y1={yP(lo)} x2={w} y2={yP(lo)} className="cref" />
      {/* candles */}
      {candles.map((c, i) => {
        const up = c.c >= c.o;
        const color = up ? "var(--pos)" : "var(--neg)";
        const x = cx(i);
        const bodyTop = yP(Math.max(c.o, c.c));
        const bodyH = Math.max(1, Math.abs(yP(c.o) - yP(c.c)));
        return (
          <g key={i} stroke={color} fill={color}>
            <line x1={x} y1={yP(c.h)} x2={x} y2={yP(c.l)} strokeWidth="1" />
            <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} strokeWidth="0" />
          </g>
        );
      })}
      {/* moving averages */}
      <polyline points={maLine(ma7)} className="ma ma7" />
      <polyline points={maLine(ma30)} className="ma ma30" />
      {/* volume */}
      {candles.map((c, i) => {
        const bh = Math.round((c.v / vmax) * volH);
        return (
          <rect
            key={`v${i}`}
            x={cx(i) - bodyW / 2}
            y={h - bh}
            width={bodyW}
            height={bh}
            className="cvol"
          />
        );
      })}
    </svg>
  );
}
