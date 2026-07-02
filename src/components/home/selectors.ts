// Shared pure derivations for the home screen. The hero, the "Do next" blend
// and the per-domain widgets must agree on what counts as actionable — these
// selectors are that single definition. No hooks, no React: plain functions
// over query data, cheap enough to run inside a useMemo.
import { atTarget, msUntil } from "../../lib/format";
import type { Fissure, ListingRow, SaleRow, SetRow, WatchRow } from "../../lib/types";

/** Listings priced above the current market low, worst overage first. */
export const overMarketListings = (rows: ListingRow[]): ListingRow[] =>
  rows
    .filter((l) => l.your_price != null && l.market_low != null && l.your_price > l.market_low)
    .sort((a, b) => b.your_price! - b.market_low! - (a.your_price! - a.market_low!));

/** Watches whose price fell to/below target, biggest headroom first. */
export const atTargetWatches = (rows: WatchRow[]): WatchRow[] =>
  rows
    .filter(atTarget)
    .sort((a, b) => b.target_plat! - b.median_plat! - (a.target_plat! - a.median_plat!));

/** Incomplete sets missing exactly one part, cheapest completion first. */
export const oneAwaySets = (sets: SetRow[]): SetRow[] =>
  sets
    .filter((s) => !s.complete && s.total_parts - s.owned_parts === 1)
    .sort(
      (a, b) =>
        (a.missing_value ?? Number.POSITIVE_INFINITY) -
        (b.missing_value ?? Number.POSITIVE_INFINITY),
    );

/** The live Void Cascade fissure, if any — the longest-lived one when both
 *  Normal and Steel Path are up (so the countdown doesn't flip mid-mission). */
export const liveCascade = (fissures: Fissure[]): Fissure | undefined =>
  fissures
    .filter((f) => msUntil(f.expiry) > 0 && /cascade/i.test(f.mission_type))
    .sort((a, b) => msUntil(b.expiry) - msUntil(a.expiry))[0];

/** True when the ISO timestamp is within the last N days. */
export const within = (iso: string, days: number): boolean =>
  Date.now() - new Date(iso).getTime() <= days * 86_400_000;

/** Plat earned from sales inside the window. */
export const sumSales = (sales: SaleRow[], days: number): number =>
  sales
    .filter((s) => within(s.sold_at, days))
    .reduce((acc, s) => acc + (s.plat_per_unit ?? 0) * s.qty, 0);

/** Daily earnings series over the last N days (oldest → newest), for sparks.
 *  Buckets by local day so "today" matches what the Sold screen reports. */
export function dailyEarnings(sales: SaleRow[], days: number): number[] {
  const out = new Array<number>(days).fill(0);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = dayStart.getTime();
  for (const s of sales) {
    const age = Math.floor((today - new Date(s.sold_at).setHours(0, 0, 0, 0)) / 86_400_000);
    if (age >= 0 && age < days) out[days - 1 - age] += (s.plat_per_unit ?? 0) * s.qty;
  }
  return out;
}
