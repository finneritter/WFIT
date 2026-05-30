import type { InventoryRow } from "../hooks/useInventory";
import type { CatalogRow } from "../hooks/useCatalogSearch";
import type { Category, PartItem } from "./types";
import { categoryFor, splitName } from "./partname";
import { deltaFor, sparkFor } from "./derive";

/**
 * Resolve the broad UI category. Prefer the catalog's stored `category`
 * (derived from warframe.market tags — accurate for blueprints/sets too);
 * fall back to the part_type heuristic for rows not yet backfilled.
 */
export function resolveCat(category: string | null, partType: string): Category {
  if (category === "Warframe" || category === "Weapon" || category === "Other") return category;
  return categoryFor(partType);
}

/** Owned inventory row → PartItem (has qty). */
export function partFromInventory(r: InventoryRow): PartItem {
  const { sub } = splitName(r.display_name, r.part_type);
  return {
    slug: r.slug,
    name: r.display_name, // full name, e.g. "Mesa Prime Blueprint"
    part: sub,
    cat: resolveCat(r.category, r.part_type),
    plat: r.median_plat,
    qty: r.qty,
    duc: r.ducats,
    d: deltaFor(r.slug, r.trend),
    trend: r.trend,
    hot: r.trend === "up",
    spark: sparkFor(r.slug, r.trend),
  };
}

/** Catalog row → PartItem (no qty = not owned). */
export function partFromCatalog(r: CatalogRow): PartItem {
  const { sub } = splitName(r.display_name, r.part_type);
  return {
    slug: r.slug,
    name: r.display_name, // full name, e.g. "Mesa Prime Blueprint"
    part: sub,
    cat: resolveCat(r.category, r.part_type),
    plat: r.median_plat,
    duc: r.ducats,
    d: deltaFor(r.slug, null),
    trend: null,
    hot: false,
    spark: sparkFor(r.slug, null),
  };
}
