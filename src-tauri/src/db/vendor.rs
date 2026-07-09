//! Vendor stock enrichment for the Vendors screen. Pure cross-join of vendor
//! inventories — live worldstate stock (`enrich`) or bundled static datasets
//! (`enrich_static`) — against the catalog + prices + ownership + manual
//! check-offs. The `worldstate/` module stays DB-free (its isolation contract),
//! so this DB-touching logic lives here instead.

use crate::db::{catalog, gamescan, vendor_checkoff, Db};
use crate::domain::vendors::StaticOffer;
use crate::error::AppResult;
use crate::types::VendorIntelRow;
use crate::worldstate::VendorItem;
use std::collections::{HashMap, HashSet};

/// A vendor item you don't own is flagged a "good deal" once its market value clears
/// this floor — i.e. it's worth grabbing, not chaff.
const DEAL_MIN_PLAT: i64 = 40;

/// Per-slug catalog facts needed to enrich a vendor line.
struct CatLite {
    median: Option<i64>,
    owned: i64,
    thumb: Option<String>,
}

/// The resolution tables every enrichment shares, built once per vendor:
/// catalog facts, the fuzzy name index, the DE uniqueName→slug map, and the
/// vendor's manual check-off set.
struct Lookup {
    facts: HashMap<String, CatLite>,
    name_to_slug: HashMap<String, String>,
    game_ref: HashMap<String, String>,
    manual: HashSet<String>,
}

impl Lookup {
    fn build(db: &Db, vendor_key: &str) -> AppResult<Self> {
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
        Ok(Self {
            facts,
            name_to_slug,
            game_ref: gamescan::game_ref_to_slug(db)?,
            manual: vendor_checkoff::set_for(db, vendor_key)?,
        })
    }

    /// Enrich one raw vendor line. Slug resolution order: explicit `slug_hint`
    /// (static datasets) → DE `uniqueName` exact match → fuzzy display name.
    #[allow(clippy::too_many_arguments)]
    fn row(
        &self,
        item: &str,
        unique_name: Option<&str>,
        slug_hint: Option<&str>,
        cost: Option<i64>,
        credits: Option<i64>,
        currency: &str,
        rank: Option<u8>,
    ) -> VendorIntelRow {
        let slug = slug_hint
            .map(String::from)
            .or_else(|| unique_name.and_then(|u| self.game_ref.get(u).cloned()))
            .or_else(|| {
                self.name_to_slug
                    .get(&catalog::normalize_name(item))
                    .cloned()
            });
        let lite = slug.as_deref().and_then(|s| self.facts.get(s));
        let median = lite.and_then(|l| l.median);
        let owned = lite.map(|l| l.owned).unwrap_or(0);
        let cost_per_plat = match (cost, median) {
            (Some(c), Some(m)) if m > 0 => Some(c as f64 / m as f64),
            _ => None,
        };
        // Stable id for persisting manual checks; never empty.
        let item_ref = unique_name
            .map(String::from)
            .or_else(|| slug.clone())
            .unwrap_or_else(|| catalog::normalize_name(item));
        let (checked, check_source) = if owned > 0 {
            (true, Some("owned".to_string()))
        } else if self.manual.contains(&item_ref) {
            (true, Some("manual".to_string()))
        } else {
            (false, None)
        };
        VendorIntelRow {
            item: item.to_string(),
            slug: slug.clone(),
            thumbnail_url: lite.and_then(|l| l.thumb.clone()),
            median_plat: median,
            owned_qty: owned,
            cost,
            currency: currency.to_string(),
            credits,
            cost_per_plat,
            good_deal: owned == 0 && median.unwrap_or(0) >= DEAL_MIN_PLAT,
            item_ref,
            tradeable: slug.is_some(),
            checked,
            check_source,
            rank,
        }
    }
}

/// Enrich a rotating vendor's worldstate stock. Resolution prefers the DE
/// `uniqueName` → slug map (`game_ref`, exact) and falls back to fuzzy
/// display-name matching. Items that resolve to no tracked slug pass through
/// priceless and `tradeable = false` (manual-check only).
///
/// `base_currency` is the vendor's single currency ("ducats", "steel_essence").
/// Varzia is the exception — her stock mixes two currencies, resolved PER ITEM
/// (verified 2026-07-02 against DE raw `PrimeVaultTraders[].Manifest`):
/// warframestat `credits` = DE `RegularPrice` = **Aya** (relics), warframestat
/// `ducats` = DE `PrimePrice` = **Regal Aya** (frames/packs/cosmetics). Every item
/// has exactly one of the two.
pub fn enrich(
    db: &Db,
    vendor_key: &str,
    items: &[VendorItem],
    base_currency: &str,
) -> AppResult<Vec<VendorIntelRow>> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let lookup = Lookup::build(db, vendor_key)?;
    Ok(items
        .iter()
        .map(|it| {
            let (cost, currency) = match vendor_key {
                "varzia" if it.credits.is_some() => (it.credits, "aya"),
                "varzia" => (it.ducats, "regal_aya"),
                _ => (it.ducats, base_currency),
            };
            lookup.row(
                &it.item,
                it.unique_name.as_deref(),
                None,
                cost,
                it.credits,
                currency,
                None,
            )
        })
        .collect())
}

/// Enrich a static vendor's bundled dataset (`domain/vendors.rs`). Same
/// pipeline as the worldstate path — owned auto-check, deal flags, market
/// prices, manual check-offs — with the offer's own currency and rank gate.
pub fn enrich_static(
    db: &Db,
    vendor_key: &str,
    offers: &[StaticOffer],
) -> AppResult<Vec<VendorIntelRow>> {
    if offers.is_empty() {
        return Ok(Vec::new());
    }
    let lookup = Lookup::build(db, vendor_key)?;
    Ok(offers
        .iter()
        .map(|o| {
            lookup.row(
                &o.item,
                None,
                o.slug_hint.as_deref(),
                Some(o.cost),
                None,
                &o.currency,
                o.rank,
            )
        })
        .collect())
}
