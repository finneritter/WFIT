// Presentation helpers ported from the wireframe.

export const clsx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export const fmt = (n: number | null | undefined): string =>
  n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n));

// Hard-rounded plat for headline/aggregate numbers — never imply false precision.
// 980 → "980", 6177 → "6.2k", 28757 → "29k".
export const fmtK = (n: number | null | undefined): string => {
  if (n == null) return "—";
  const v = Math.round(n);
  if (v < 1000) return String(v);
  const k = v / 1000;
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
};

export const pct = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export const TIERS = [
  { key: "exotic", min: 120, label: "120p+" },
  { key: "legend", min: 45, label: "45–119p" },
  { key: "rare", min: 15, label: "15–44p" },
  { key: "basic", min: 0, label: "<15p" },
] as const;

export const tier = (p: number | null | undefined): string => {
  const v = p ?? 0;
  return TIERS.find((t) => v >= t.min)?.key ?? "basic";
};

/** Two-letter monogram from a name. */
export const glyph = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** trend class from a delta sign (±1% flat band). */
export const trendOf = (delta: number | null | undefined): "up" | "down" | "flat" => {
  if (delta == null) return "flat";
  if (delta > 1) return "up";
  if (delta < -1) return "down";
  return "flat";
};

/** "today" / "yesterday" / "Nd ago" from an ISO timestamp. */
export const relativeDay = (iso: string): string => {
  const then = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
};

/** "synced Nm ago" from an ISO timestamp (or "never"). */
export const syncedAgo = (iso: string | null): string => {
  if (!iso) return "never";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
};

/** ms remaining until an ISO timestamp (negative if past). */
export const msUntil = (iso: string | null | undefined): number =>
  iso ? new Date(iso).getTime() - Date.now() : Number.NEGATIVE_INFINITY;

/** Live countdown to an ISO timestamp: "2d 3h 04m" / "1h 23m 05s" / "45s". */
export const countdown = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return "—";
  let s = Math.floor((new Date(iso).getTime() - now) / 1000);
  if (Number.isNaN(s)) return "—";
  if (s <= 0) return "now";
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
};

export const CATEGORY_LABELS: Record<string, string> = {
  warframe: "Warframe",
  weapon: "Weapon",
  set: "Set",
  mod: "Mod",
  arcane: "Arcane",
};
