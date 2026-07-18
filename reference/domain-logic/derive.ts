import type { Trend } from "./types";

// ---------------------------------------------------------------------------
// The backend currently stores only a single median price + a trend enum
// (up/flat/down) per item — no time series. The WFIT design leans heavily on
// sparklines and a 7d delta %, so until a price-history table lands (a future
// B-phase), we synthesize *deterministic* visuals seeded by the item slug and
// shaped by the real trend. Same slug → same sparkline every render; the drift
// direction reflects the real trend, the magnitudes are placeholder filler.
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 7-point sparkline string ("x,y x,y …") with y in 0..21, x stepping by 14. */
export function sparkFor(slug: string, trend: Trend): string {
  const dir = trend === "up" ? 1 : trend === "down" ? -1 : 0;
  const amp = 2 + (hash(slug) % 3); // 2..4 jitter
  const pts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const x = i * 14;
    const drift = dir * (i / 6) * 6;
    const noise = (hash(slug + ":" + i) % (amp * 2 + 1)) - amp;
    const y = Math.max(3, Math.min(20, Math.round(11 + drift + noise)));
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

/** Signed 7d delta percent, placeholder until real price history exists. */
export function deltaFor(slug: string, trend: Trend): number {
  const mag = 1 + (hash(slug) % 22); // 1..22
  if (trend === "down") return -mag;
  if (trend === "flat") return (hash(slug) % 5) - 2; // -2..2
  return mag; // up or unknown → positive
}
