//! Vendor stock enrichment for the Vendors screen. Pure cross-join of the
//! already-parsed worldstate vendor inventory against the catalog + prices +
//! ownership + manual check-offs — the `worldstate/` module stays DB-free (its
//! isolation contract), so this DB-touching logic lives here instead.

use crate::db::{catalog, gamescan, vendor_checkoff, Db};
use crate::error::AppResult;
use crate::types::VendorIntelRow;
use crate::worldstate::VendorItem;
use std::collections::HashMap;

/// A vendor item you don't own is flagged a "good deal" once its market value clears
/// this floor — i.e. it's worth grabbing, not chaff.
const DEAL_MIN_PLAT: i64 = 40;

/// Per-slug catalog facts needed to enrich a vendor line.
struct CatLite {
    median: Option<i64>,
    owned: i64,
    thumb: Option<String>,
}

/// Enrich a vendor's raw stock against the catalog: attach market value, owned qty,
/// cost-per-plat efficiency, a buy-it flag, and check-off state (owned → auto-checked,
/// else manual). Resolution prefers the DE `uniqueName` → slug map (`game_ref`, exact)
/// and falls back to fuzzy display-name matching. Items that resolve to no tracked
/// slug pass through priceless and `tradeable = false` (manual-check only).
pub fn enrich(db: &Db, vendor_key: &str, items: &[VendorItem]) -> AppResult<Vec<VendorIntelRow>> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    // Per-slug facts, plus a normalized-name → slug fallback index. Built once.
    let (facts, name_to_slug): (HashMap<String, CatLite>, HashMap<String, String>) =
        db.read(|c| {
            let mut stmt = c.prepare(
                "SELECT ci.slug, ci.display_name, pc.median_plat,
                        COALESCE(ii.qty, 0), ci.thumbnail_url
                 FROM catalog_items ci
                 LEFT JOIN price_cache pc ON pc.slug = ci.slug
                 LEFT JOIN inventory_items ii ON ii.slug = ci.slug",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?, // slug
                    r.get::<_, String>(1)?, // display_name
                    CatLite {
                        median: r.get(2)?,
                        owned: r.get(3)?,
                        thumb: r.get(4)?,
                    },
                ))
            })?;
            let mut facts: HashMap<String, CatLite> = HashMap::new();
            let mut name_to_slug: HashMap<String, String> = HashMap::new();
            for r in rows {
                let (slug, name, lite) = r?;
                name_to_slug
                    .entry(catalog::normalize_name(&name))
                    .or_insert_with(|| slug.clone());
                facts.insert(slug, lite);
            }
            Ok((facts, name_to_slug))
        })?;

    // uniqueName → slug (exact), and the vendor's manual check set. One read each.
    let game_ref = gamescan::game_ref_to_slug(db)?;
    let manual = vendor_checkoff::set_for(db, vendor_key)?;

    Ok(items
        .iter()
        .map(|it| {
            let slug = it
                .unique_name
                .as_deref()
                .and_then(|u| game_ref.get(u).cloned())
                .or_else(|| {
                    name_to_slug
                        .get(&catalog::normalize_name(&it.item))
                        .cloned()
                });
            let lite = slug.as_deref().and_then(|s| facts.get(s));
            let median = lite.and_then(|l| l.median);
            let owned = lite.map(|l| l.owned).unwrap_or(0);
            let cost = it.ducats;
            let cost_per_plat = match (cost, median) {
                (Some(c), Some(m)) if m > 0 => Some(c as f64 / m as f64),
                _ => None,
            };
            // Stable id for persisting manual checks; never empty.
            let item_ref = it
                .unique_name
                .clone()
                .or_else(|| slug.clone())
                .unwrap_or_else(|| catalog::normalize_name(&it.item));
            let (checked, check_source) = if owned > 0 {
                (true, Some("owned".to_string()))
            } else if manual.contains(&item_ref) {
                (true, Some("manual".to_string()))
            } else {
                (false, None)
            };
            VendorIntelRow {
                item: it.item.clone(),
                slug: slug.clone(),
                thumbnail_url: lite.and_then(|l| l.thumb.clone()),
                median_plat: median,
                owned_qty: owned,
                cost,
                credits: it.credits,
                cost_per_plat,
                good_deal: owned == 0 && median.unwrap_or(0) >= DEAL_MIN_PLAT,
                item_ref,
                tradeable: slug.is_some(),
                checked,
                check_source,
            }
        })
        .collect())
}
