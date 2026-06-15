//! Vendor (Baro Ki'Teer / Varzia) stock enrichment for the Rotation Vendors tab.
//! Pure cross-join of the already-parsed worldstate vendor inventory against the
//! catalog + prices + ownership — the `worldstate/` module stays DB-free (its
//! isolation contract), so this DB-touching logic lives here instead.

use crate::db::{catalog, Db};
use crate::error::AppResult;
use crate::types::VendorIntelRow;
use crate::worldstate::VendorItem;
use std::collections::HashMap;

/// A vendor item you don't own is flagged a "good deal" once its market value clears
/// this floor — i.e. it's worth grabbing, not chaff.
const DEAL_MIN_PLAT: i64 = 40;

/// Per-slug catalog facts needed to enrich a vendor line.
struct CatLite {
    slug: String,
    median: Option<i64>,
    owned: i64,
    thumb: Option<String>,
}

/// Enrich a vendor's raw stock against the catalog: attach market value, owned qty,
/// cost-per-plat efficiency, and a buy-it flag. Items whose name doesn't resolve to a
/// tracked catalog slug pass through with no price (they're simply not on warframe.market).
pub fn enrich(db: &Db, items: &[VendorItem]) -> AppResult<Vec<VendorIntelRow>> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    // Build the normalized name → catalog-fact index once.
    let index: HashMap<String, CatLite> = db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT ci.display_name, ci.slug, pc.median_plat,
                    COALESCE(ii.qty, 0), ci.thumbnail_url
             FROM catalog_items ci
             LEFT JOIN price_cache pc ON pc.slug = ci.slug
             LEFT JOIN inventory_items ii ON ii.slug = ci.slug",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                CatLite {
                    slug: r.get(1)?,
                    median: r.get(2)?,
                    owned: r.get(3)?,
                    thumb: r.get(4)?,
                },
            ))
        })?;
        let mut m: HashMap<String, CatLite> = HashMap::new();
        for r in rows {
            let (name, lite) = r?;
            m.entry(catalog::normalize_name(&name)).or_insert(lite);
        }
        Ok(m)
    })?;

    Ok(items
        .iter()
        .map(|it| {
            let lite = index.get(&catalog::normalize_name(&it.item));
            let median = lite.and_then(|l| l.median);
            let owned = lite.map(|l| l.owned).unwrap_or(0);
            let cost = it.ducats;
            let cost_per_plat = match (cost, median) {
                (Some(c), Some(m)) if m > 0 => Some(c as f64 / m as f64),
                _ => None,
            };
            VendorIntelRow {
                item: it.item.clone(),
                slug: lite.map(|l| l.slug.clone()),
                thumbnail_url: lite.and_then(|l| l.thumb.clone()),
                median_plat: median,
                owned_qty: owned,
                cost,
                credits: it.credits,
                cost_per_plat,
                good_deal: owned == 0 && median.unwrap_or(0) >= DEAL_MIN_PLAT,
            }
        })
        .collect())
}
