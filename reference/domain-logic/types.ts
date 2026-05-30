export type Trend = "up" | "flat" | "down" | null;

export type Category = "Warframe" | "Weapon" | "Other";

/**
 * Normalized shape consumed by every Primely table/row/modal. Built from
 * inventory rows (owned, has `qty`) or catalog rows (not owned, no `qty`).
 */
export type PartItem = {
  slug: string;
  name: string; // full display name, e.g. "Mesa Prime Blueprint"
  part: string; // just the part, e.g. "Systems Blueprint" (rarely shown now)
  cat: Category; // broad category shown under the name, e.g. "Warframe"
  plat: number | null;
  qty?: number; // present only when owned
  duc: number | null;
  d: number; // 7d delta percent (derived — see lib/derive.ts)
  trend: Trend;
  hot: boolean;
  spark: string; // sparkline points (derived)
};
