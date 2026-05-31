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
