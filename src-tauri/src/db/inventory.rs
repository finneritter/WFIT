use crate::db::prices;
use crate::db::settings;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::InventoryRow;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;

pub fn add(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    db.with(|c| {
        let exists: i64 = c.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::NotFound(format!("unknown slug: {slug}")));
        }
        let now = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = inventory_items.qty + ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        let new_qty: i64 = c.query_row(
            "SELECT qty FROM inventory_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        Ok(new_qty)
    })
}

/// Add an item to inventory — or, if `slug` is a set, add each of its member
/// parts instead (a set is owned by owning its parts). Returns the slugs whose
/// price should be refreshed: the item, or the set + all its parts.
pub fn add_item_or_set(db: &Db, slug: &str, qty: i64) -> AppResult<Vec<String>> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    let category: String = db.with(|c| {
        c.query_row(
            "SELECT category FROM catalog_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("unknown slug: {slug}")))
    })?;

    if category == "set" {
        let parts: Vec<String> = db.with(|c| {
            let mut stmt = c.prepare("SELECT slug FROM catalog_items WHERE set_slug = ?1")?;
            let rows = stmt.query_map(params![slug], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })?;
        if parts.is_empty() {
            // No known composition — fall back to adding the set item itself.
            add(db, slug, qty)?;
            return Ok(vec![slug.to_string()]);
        }
        for p in &parts {
            add(db, p, qty)?;
        }
        let mut refresh = parts;
        refresh.push(slug.to_string()); // also refresh the set's own price for valuation
        Ok(refresh)
    } else {
        add(db, slug, qty)?;
        Ok(vec![slug.to_string()])
    }
}

fn is_set(db: &Db, slug: &str) -> AppResult<bool> {
    db.with(|c| {
        let cat: Option<String> = c
            .query_row(
                "SELECT category FROM catalog_items WHERE slug = ?1",
                params![slug],
                |r| r.get(0),
            )
            .ok();
        Ok(cat.as_deref() == Some("set"))
    })
}

/// Move owned holdings toward `target` complete sets by applying the delta
/// uniformly across member parts. Preserves extras beyond a complete set.
fn adjust_set(db: &Db, set_slug: &str, target: i64) -> AppResult<()> {
    let members = set_members(db, set_slug)?;
    if members.is_empty() {
        return Ok(());
    }
    let delta = target - complete_set_count(db, set_slug)?;
    if delta == 0 {
        return Ok(());
    }
    let now = Utc::now().to_rfc3339();
    db.with(|c| {
        for m in &members {
            let cur: i64 = c
                .query_row(
                    "SELECT qty FROM inventory_items WHERE slug = ?1",
                    params![m],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let nq = (cur + delta).max(0);
            if nq == 0 {
                c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![m])?;
            } else {
                c.execute(
                    "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
                     VALUES (?1, ?2, ?3, ?3, 'manual')
                     ON CONFLICT(slug) DO UPDATE SET qty = ?2, last_modified_at = ?3",
                    params![m, nq, now],
                )?;
            }
        }
        Ok(())
    })
}

/// set_qty that understands sets (adjusts member parts); otherwise plain set_qty.
pub fn set_qty_aware(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if is_set(db, slug)? {
        adjust_set(db, slug, qty.max(0))?;
        Ok(qty.max(0))
    } else {
        set_qty(db, slug, qty)
    }
}

/// remove that understands sets (removes a complete set's worth of parts).
pub fn remove_aware(db: &Db, slug: &str) -> AppResult<()> {
    if is_set(db, slug)? {
        adjust_set(db, slug, 0)
    } else {
        remove(db, slug)
    }
}

pub fn set_qty(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty < 0 {
        return Err(AppError::Invalid("qty must be >= 0".into()));
    }
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        if qty == 0 {
            c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![slug])?;
            return Ok(0);
        }
        c.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        Ok(qty)
    })
}

pub fn remove(db: &Db, slug: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![slug])?;
        Ok(())
    })
}

/// The owned inventory as displayed/valued: complete sets are collapsed into a
/// single set entry priced at the set's median; leftover/partial parts and
/// non-set items pass through. Ranked by value.
pub fn list_ranked(db: &Db) -> AppResult<Vec<InventoryRow>> {
    let mut out = owned_holdings(db)?;
    out.sort_by(|a, b| {
        row_value(b)
            .cmp(&row_value(a))
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    Ok(out)
}

/// Set-aware total plat value of the inventory at full market price — the
/// optimistic "ceiling" (complete sets at set price, mods/arcanes rank-aware).
pub fn total_value(db: &Db) -> AppResult<i64> {
    Ok(owned_holdings(db)?.iter().map(row_value).sum())
}

/// Liquidation-adjusted total — what the inventory could realistically realize,
/// each holding haircut by its market depth. This is the honest headline; it is
/// always ≤ `total_value`.
pub fn total_realizable(db: &Db) -> AppResult<i64> {
    Ok(owned_holdings(db)?
        .iter()
        .map(|r| r.realizable_plat.unwrap_or_else(|| row_value(r)))
        .sum())
}

/// Value-weighted 7d portfolio change over priced owned items (weight =
/// median × qty; items with no 7d delta are excluded from the basis). The
/// single source of truth — the Inventory header and the Trends "Your
/// holdings" band must show the SAME number.
pub fn portfolio_7d_change(c: &rusqlite::Connection) -> rusqlite::Result<Option<f64>> {
    let (num, den): (f64, f64) = c.query_row(
        "SELECT
            COALESCE(SUM(COALESCE(pc.delta_7d, 0) * pc.median_plat * ii.qty), 0),
            COALESCE(SUM(CASE WHEN pc.delta_7d IS NOT NULL THEN pc.median_plat * ii.qty ELSE 0 END), 0)
         FROM inventory_items ii JOIN price_cache pc ON pc.slug = ii.slug
         WHERE ii.qty > 0",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((den > 0.0).then(|| num / den))
}

/// The plat value of one owned row: rank-aware value when present, else median × qty.
fn row_value(r: &InventoryRow) -> i64 {
    r.value_plat
        .unwrap_or_else(|| r.median_plat.unwrap_or(0) * r.qty)
}

// --- Liquidation-adjusted (realizable) valuation ---------------------------
// A market price is a MARGINAL price; `× qty` falsely assumes it holds for the
// whole stack. We value each holding by LIQUIDATING it: fill the standing buy
// orders (the demand curve) best-bid-first, then a volume-capped tail for what
// off-book demand could absorb over the window (discounted), and anything beyond
// that is worth ~0. So 500 copies of a mod nobody is bidding on ≈ nothing.
// (See .claude/plans/pricing-rework + docs/CLAUDE_ECONOMIC_RESEARCH.)
const WINDOW_DAYS: f64 = 30.0; // horizon for off-book (volume-driven) sales
const K: f64 = 1.0; // share of market volume you could capture
const TAIL_FACTOR: f64 = 0.35; // off-book sales beyond live bids net ~a third of sticker

/// Realizable plat for a stack: `bids` (price, qty) filled best-first, plus a
/// volume-capped, discounted tail; units beyond both real bids and that capacity
/// are worth ~0. `per_unit` is the reference price for the tail.
///
/// TWIN: `split_sell_dissolve` walks this same curve with a dissolve floor —
/// change the fill/tail math in BOTH or the no-floor property test fails.
pub fn realizable_value(
    per_unit: i64,
    qty: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
    window_days: f64,
    k: f64,
    tail_factor: f64,
) -> i64 {
    if qty <= 0 {
        return 0;
    }
    // 1) liquidate into the standing demand, best bid first.
    let mut remaining = qty;
    let mut bid_value = 0i64;
    for &(price, q) in bids {
        if remaining == 0 {
            break;
        }
        let take = remaining.min(q.max(0));
        bid_value += take * price.max(0);
        remaining -= take;
    }
    let filled = qty - remaining;
    // 2) volume-capped tail beyond the bids — off-book demand at a discount.
    let daily = volume_7d.unwrap_or(0).max(0) as f64 / 7.0;
    let capacity = (k * daily * window_days).floor() as i64;
    let tail_units = (capacity - filled).max(0).min(remaining);
    let tail_value = (tail_units as f64 * per_unit.max(0) as f64 * tail_factor).round() as i64;
    bid_value + tail_value
}

/// Per-item confidence in the value (Fair-Value-Hierarchy, ECONOMIC_DATA §1.4):
/// 'high' = actively traded, 'medium' = trades occasionally or has live bids,
/// 'low' = barely trades / no demand / riven. None when there's no price at all.
pub fn confidence_of(
    slug: &str,
    has_price: bool,
    volume_7d: Option<i64>,
    has_bids: bool,
) -> Option<&'static str> {
    if !has_price {
        return None;
    }
    if slug.contains("riven") {
        return Some("low"); // roll-dependent, near-unique — never a confident point
    }
    let daily = volume_7d.unwrap_or(0).max(0) as f64 / 7.0;
    Some(if daily >= 3.0 {
        "high"
    } else if daily >= 0.5 || has_bids {
        "medium"
    } else {
        "low"
    })
}

/// `realizable_value` with the app defaults (`WINDOW_DAYS`/`K`/`TAIL_FACTOR`), no
/// market clamp. Lets other modules value a stack on the same realizable curve the
/// inventory uses without reaching into the private consts.
pub fn realizable_value_default(
    per_unit: i64,
    qty: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
) -> i64 {
    realizable_value(per_unit, qty, volume_7d, bids, WINDOW_DAYS, K, TAIL_FACTOR)
}

/// `realizable_value` with the app defaults, clamped to the market ceiling, plus
/// φ = realizable / market.
pub fn realizable_default(
    per_unit: i64,
    qty: i64,
    market: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
) -> (i64, f64) {
    let rz = realizable_value(per_unit, qty, volume_7d, bids, WINDOW_DAYS, K, TAIL_FACTOR)
        .min(market.max(0));
    let phi = if market > 0 {
        rz as f64 / market as f64
    } else {
        1.0
    };
    (rz, phi)
}

/// Realizable value + φ for an owned stack, applying the app-wide "no haircut for
/// liquid/fungible holdings" rule: a prime part (warframe/weapon/set) OR a SINGLE
/// copy (`qty <= 1`) liquidates fully — it only takes one buyer to clear one item —
/// so it's worth full market value (φ = 1.0). Only multi-copy mod/arcane stacks get
/// the liquidation haircut, where `qty × price` overstates what the market absorbs.
/// This is the SINGLE source of truth used by both the inventory grid and the drawer.
pub fn realizable_for(
    category: &str,
    per_unit: i64,
    qty: i64,
    market: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
) -> (i64, f64) {
    if qty <= 1 || matches!(category, "warframe" | "weapon" | "set") {
        (market, 1.0)
    } else {
        realizable_default(per_unit, qty, market, volume_7d, bids)
    }
}

/// Split a stack of `qty` identical units between selling and dissolving, given the
/// per-unit `dissolve_unit` floor (the plat-equivalent of dissolving one). Walks the
/// SAME demand curve as `realizable_value` (live bids best-first, then a volume-capped
/// off-book tail at `tail_factor × per_unit`) and keeps selling a unit only while its
/// marginal price beats the dissolve floor. The curve is monotonically decreasing, so
/// this is the value-maximizing split. Returns `(sell_qty, sell_plat)`; the remaining
/// `qty − sell_qty` units are the ones worth dissolving instead.
///
/// TWIN: with `dissolve_unit < 0` this must equal `realizable_value` exactly —
/// change the fill/tail math in BOTH or the no-floor property test fails.
#[allow(clippy::too_many_arguments)]
pub fn split_sell_dissolve(
    per_unit: i64,
    qty: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
    dissolve_unit: f64,
    window_days: f64,
    k: f64,
    tail_factor: f64,
) -> (i64, i64) {
    if qty <= 0 {
        return (0, 0);
    }
    let mut remaining = qty;
    let mut sell_qty = 0i64;
    let mut sell_plat = 0i64;
    // 1) Standing demand, best bid first — take while the bid beats dissolving.
    //    Bids are sorted price-desc, so once one drops to the floor all later ones do too.
    for &(price, q) in bids {
        if remaining == 0 || (price as f64) <= dissolve_unit {
            break;
        }
        let take = remaining.min(q.max(0));
        sell_qty += take;
        sell_plat += take * price.max(0);
        remaining -= take;
    }
    // 2) Volume-capped off-book tail at a discount — only worth it if it still beats
    //    dissolving (a separate channel from the bids, capped by recent demand).
    let tail_price = (per_unit.max(0) as f64) * tail_factor;
    if remaining > 0 && tail_price > dissolve_unit {
        let daily = volume_7d.unwrap_or(0).max(0) as f64 / 7.0;
        let capacity = (k * daily * window_days).floor() as i64;
        let filled = qty - remaining;
        let tail_units = (capacity - filled).max(0).min(remaining);
        sell_qty += tail_units;
        // Same association order as realizable_value's tail — float multiply
        // isn't associative, and units × (price × factor) can round 1p apart.
        sell_plat += (tail_units as f64 * per_unit.max(0) as f64 * tail_factor).round() as i64;
    }
    (sell_qty, sell_plat)
}

/// `split_sell_dissolve` with the app defaults, with the sale clamped to the market
/// ceiling (`per_unit × qty`).
pub fn split_sell_dissolve_default(
    per_unit: i64,
    qty: i64,
    volume_7d: Option<i64>,
    bids: &[(i64, i64)],
    dissolve_unit: f64,
) -> (i64, i64) {
    let (sell_qty, sell_plat) = split_sell_dissolve(
        per_unit,
        qty,
        volume_7d,
        bids,
        dissolve_unit,
        WINDOW_DAYS,
        K,
        TAIL_FACTOR,
    );
    let ceiling = (per_unit.max(0) * sell_qty.max(0)).max(0);
    (sell_qty, sell_plat.min(ceiling))
}

/// Number of complete sets currently owned (all member parts present): the
/// minimum owned qty across every catalog member, in one read-pool query
/// (a member with no inventory row counts as 0; no members at all → 0).
pub fn complete_set_count(db: &Db, set_slug: &str) -> AppResult<i64> {
    db.read(|c| {
        let n: i64 = c.query_row(
            "SELECT COALESCE(MIN(COALESCE(ii.qty, 0)), 0)
             FROM catalog_items ci
             LEFT JOIN inventory_items ii ON ii.slug = ci.slug
             WHERE ci.set_slug = ?1",
            params![set_slug],
            |r| r.get(0),
        )?;
        Ok(n.max(0))
    })
}

pub fn set_members(db: &Db, set_slug: &str) -> AppResult<Vec<String>> {
    db.read(|c| {
        let mut stmt = c.prepare("SELECT slug FROM catalog_items WHERE set_slug = ?1")?;
        let rows = stmt.query_map(params![set_slug], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Raw owned rows joined with catalog + price (no set collapsing). Values each
/// row from preloaded `PriceMaps` + owned rank breakdowns — no per-item queries.
fn fetch_owned(c: &rusqlite::Connection) -> AppResult<Vec<InventoryRow>> {
    let maps = prices::load_owned_price_maps(c)?;
    // Owned per-rank breakdowns for every slug, in one query.
    let mut breakdowns: HashMap<String, Vec<(i64, i64)>> = HashMap::new();
    {
        let mut stmt = c.prepare("SELECT slug, rank, qty FROM inventory_ranks")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (slug, rank, qty) = row?;
            breakdowns.entry(slug).or_default().push((rank, qty));
        }
    }
    let mut stmt = c.prepare(
        "SELECT
            ci.slug, ci.display_name, ci.part_type, ci.category, ci.set_slug,
            ii.qty, ci.ducats, ci.is_vaulted,
            pc.median_plat, pc.trend, pc.delta_7d, pc.volume_7d,
            ci.thumbnail_url, ii.last_modified_at, ci.mod_rarity
         FROM inventory_items ii
         JOIN catalog_items ci ON ci.slug = ii.slug
         LEFT JOIN price_cache pc ON pc.slug = ii.slug
         WHERE ii.qty > 0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(InventoryRow {
            slug: r.get(0)?,
            display_name: r.get(1)?,
            part_type: r.get(2)?,
            category: r.get(3)?,
            set_slug: r.get(4)?,
            qty: r.get(5)?,
            ducats: r.get(6)?,
            is_vaulted: r.get::<_, i64>(7)? != 0,
            median_plat: r.get(8)?,
            trend: r.get(9)?,
            delta_7d: r.get(10)?,
            volume_7d: r.get(11)?,
            thumbnail_url: r.get(12)?,
            last_modified_at: r.get(13)?,
            value_plat: None,
            realizable_plat: None,
            daily_volume: None,
            liquidity: None,
            days_to_sell: None,
            confidence: None,
            spark: Vec::new(),
            mod_rarity: r.get(14)?,
            excluded: false,
        })
    })?;
    let mut owned = rows.collect::<Result<Vec<_>, _>>()?;
    // Second pass: rank-aware value for mods/arcanes; live-sell value for other
    // illiquid items. Both prefer the live ask over the trade median.
    for row in &mut owned {
        let breakdown = breakdowns.get(&row.slug).map(Vec::as_slice).unwrap_or(&[]);
        if let Some(v) = prices::rank_aware_value_from(&maps, &row.slug, breakdown) {
            // Ranked: value off per-rank effective price; show the blended
            // per-unit price so price × qty == value in the grid/drawer.
            row.value_plat = Some(v);
            if row.qty > 0 {
                row.median_plat = Some(v / row.qty);
            }
        } else if let Some(ep) = prices::effective_price_from(&maps, &row.slug, None) {
            // Non-ranked: show the live-sell-preferred price and value off it.
            row.median_plat = Some(ep);
            row.value_plat = Some(ep * row.qty);
        }
    }
    Ok(owned)
}

/// set_slug → its catalog/price row, used as the collapsed-set template.
fn set_templates(c: &rusqlite::Connection) -> AppResult<HashMap<String, InventoryRow>> {
    {
        let mut stmt = c.prepare(
            "SELECT ci.slug, ci.display_name, ci.part_type, ci.ducats, ci.is_vaulted,
                    pc.median_plat, pc.trend, pc.delta_7d, pc.volume_7d, ci.thumbnail_url
             FROM catalog_items ci
             LEFT JOIN price_cache pc ON pc.slug = ci.slug
             WHERE ci.category = 'set'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(InventoryRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: "set".into(),
                set_slug: None,
                qty: 0,
                ducats: r.get(3)?,
                is_vaulted: r.get::<_, i64>(4)? != 0,
                median_plat: r.get(5)?,
                trend: r.get(6)?,
                delta_7d: r.get(7)?,
                volume_7d: r.get(8)?,
                thumbnail_url: r.get(9)?,
                last_modified_at: String::new(),
                value_plat: None,
                realizable_plat: None,
                daily_volume: None,
                liquidity: None,
                days_to_sell: None,
                confidence: None,
                spark: Vec::new(),
                mod_rarity: None,
                excluded: false,
            })
        })?;
        let mut m = HashMap::new();
        for r in rows {
            let row = r?;
            m.insert(row.slug.clone(), row);
        }
        Ok(m)
    }
}

/// Full catalog membership for many sets in one query: set_slug → [part slugs].
/// Batched replacement for calling `set_members` per set inside a loop.
fn memberships(
    c: &rusqlite::Connection,
    set_slugs: &[String],
) -> AppResult<HashMap<String, Vec<String>>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    if set_slugs.is_empty() {
        return Ok(out);
    }
    let ph = std::iter::repeat("?")
        .take(set_slugs.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT set_slug, slug FROM catalog_items WHERE set_slug IN ({ph})");
    let mut stmt = c.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(set_slugs.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (set_slug, slug) = row?;
        out.entry(set_slug).or_default().push(slug);
    }
    Ok(out)
}

/// The user's value-exclusion settings (excluded mod rarities + global floor +
/// per-category cheap-item floor), loaded once. `is_excluded` is the SINGLE source
/// of truth for "this item is worth too little to count" — used by the portfolio
/// valuation here AND by listing recommendations, so the two can never disagree on
/// what's been excluded.
pub struct ExclusionRules {
    rarities: Vec<String>,
    min_plat: i64,
    min_by_cat: HashMap<String, i64>,
}

impl ExclusionRules {
    pub fn load(c: &rusqlite::Connection) -> AppResult<Self> {
        Ok(Self {
            rarities: settings::excluded_rarities_conn(c)?,
            min_plat: settings::excluded_min_plat_conn(c)?,
            min_by_cat: settings::excluded_min_plat_by_cat_conn(c)?,
        })
    }

    /// True when this item's value should be excluded: its mod rarity is on the
    /// exclusion list and it doesn't clear the global floor, OR its unit price is at
    /// or below the per-category floor (only when priced — an unpriced item isn't
    /// confirmed cheap).
    pub fn is_excluded(
        &self,
        category: &str,
        mod_rarity: Option<&str>,
        median_plat: Option<i64>,
    ) -> bool {
        if let Some(rarity) = mod_rarity {
            // Keep a mod of an excluded rarity when its unit price clears the floor.
            let kept_by_value = self.min_plat > 0 && median_plat.unwrap_or(0) >= self.min_plat;
            if self.rarities.iter().any(|e| e == rarity) && !kept_by_value {
                return true;
            }
        }
        if let (Some(&floor), Some(price)) = (self.min_by_cat.get(category), median_plat) {
            if price <= floor {
                return true;
            }
        }
        false
    }
}

fn owned_holdings(db: &Db) -> AppResult<Vec<InventoryRow>> {
    // The whole valuation — exclusion settings included — runs on a single
    // pooled read connection, so it never queues behind the writer mutex.
    db.read(|c| {
        let rules = ExclusionRules::load(c)?;

        let owned = fetch_owned(c)?;
        let templates = set_templates(c)?;

        // member part slugs per set, plus the qty each owned part contributes.
        let owned_qty: HashMap<&str, i64> =
            owned.iter().map(|r| (r.slug.as_str(), r.qty)).collect();
        let mut members: HashMap<String, Vec<String>> = HashMap::new();
        for r in &owned {
            if let Some(set) = &r.set_slug {
                members.entry(set.clone()).or_default().push(r.slug.clone());
            }
        }
        // A set is complete only if EVERY catalog member is owned, so pull the full
        // membership (not just owned parts) to detect missing ones — batched.
        let set_slugs: Vec<String> = members.keys().cloned().collect();
        let membership = memberships(c, &set_slugs)?;
        let mut consumed: HashMap<String, i64> = HashMap::new();
        let mut out: Vec<InventoryRow> = Vec::new();
        for set_slug in members.keys() {
            let Some(tmpl) = templates.get(set_slug) else {
                continue;
            };
            if tmpl.median_plat.is_none() {
                continue; // no set price → don't collapse, value parts individually
            }
            let empty = Vec::new();
            let all_members = membership.get(set_slug).unwrap_or(&empty);
            let complete = all_members
                .iter()
                .map(|m| *owned_qty.get(m.as_str()).unwrap_or(&0))
                .min()
                .unwrap_or(0);
            if complete > 0 {
                let mut row = tmpl.clone();
                row.qty = complete;
                out.push(row);
                for m in all_members {
                    *consumed.entry(m.clone()).or_insert(0) += complete;
                }
            }
        }

        for r in &owned {
            let used = *consumed.get(&r.slug).unwrap_or(&0);
            let left = r.qty - used;
            if left > 0 {
                let mut row = r.clone();
                row.qty = left;
                // value_plat was computed for the full qty; for a partial leftover it
                // no longer applies (these are non-ranked parts) — fall back to median × left.
                row.value_plat = None;
                out.push(row);
            }
        }

        // Liquidity-adjusted (realizable) value + signals for every row (sets included):
        // liquidate into the live bid ladder, then a volume-capped tail. Bid ladders and
        // sparklines are batch-loaded for all rows at once (was one query per row).
        let out_slugs: Vec<String> = out.iter().map(|r| r.slug.clone()).collect();
        let bid_map = prices::bid_ladders_for(c, &out_slugs)?;
        let spark_map = prices::recent_medians_for(c, &out_slugs)?;
        let no_bids: Vec<(i64, i64)> = Vec::new();
        for row in &mut out {
            let market = row_value(row);
            let bids = bid_map.get(&row.slug).unwrap_or(&no_bids);
            let (realizable, phi) = realizable_for(
                &row.category,
                row.median_plat.unwrap_or(0),
                row.qty,
                market,
                row.volume_7d,
                bids,
            );
            row.realizable_plat = Some(realizable);
            row.liquidity = Some(phi);
            row.daily_volume = row.volume_7d.map(|v| (v.max(0) as f64) / 7.0);
            row.days_to_sell = match row.volume_7d {
                Some(v) if v > 0 => Some((row.qty as f64 / (v as f64 / 7.0)).round() as i64),
                _ => None,
            };
            row.confidence = confidence_of(
                &row.slug,
                row.median_plat.is_some(),
                row.volume_7d,
                !bids.is_empty(),
            )
            .map(String::from);
            // Display-only sparkline for the List view (sets + parts), independent of pricing.
            row.spark = spark_map.get(&row.slug).cloned().unwrap_or_default();
            // Exclude this row's value from the portfolio total when the user's
            // exclusion rules (rarity list / per-category cheap-item floor) drop it.
            // Zeroing value/realizable makes the totals (and summary/trends, which sum
            // these) drop it automatically; the row still appears in inventory, flagged
            // + with its price still in the drawer.
            if rules.is_excluded(&row.category, row.mod_rarity.as_deref(), row.median_plat) {
                row.excluded = true;
                row.value_plat = Some(0);
                row.realizable_plat = Some(0);
            }
        }
        Ok(out)
    })
}

/// Owned slugs with qty > 0 — the priority set for price refresh.
pub fn owned_slugs(db: &Db) -> AppResult<Vec<String>> {
    db.read(|c| {
        let mut stmt = c.prepare("SELECT slug FROM inventory_items WHERE qty > 0")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        realizable_default, realizable_for, realizable_value, split_sell_dissolve,
        split_sell_dissolve_default,
    };

    const W: f64 = 30.0;
    const K: f64 = 1.0;
    const T: f64 = 0.35;

    /// Pins the two liquidation walks together: with a dissolve floor below any
    /// possible price, `split_sell_dissolve` must trace exactly the same demand
    /// curve as `realizable_value` (same bids-then-tail fill, same rounding).
    /// If one is ever edited without the other, this property breaks.
    #[test]
    fn split_with_no_floor_equals_realizable_value() {
        let bid_books: &[&[(i64, i64)]] = &[
            &[],
            &[(40, 5)],
            &[(40, 2), (35, 3), (10, 50)],
            &[(1, 1)],
            &[(100, 1), (1, 1000)],
        ];
        for &per_unit in &[0i64, 1, 13, 50, 400] {
            for &qty in &[1i64, 2, 7, 40, 500] {
                for &vol in &[None, Some(0i64), Some(3), Some(70), Some(10_000)] {
                    for bids in bid_books {
                        let rz = realizable_value(per_unit, qty, vol, bids, W, K, T);
                        let (sell_qty, sell_plat) =
                            split_sell_dissolve(per_unit, qty, vol, bids, -1.0, W, K, T);
                        assert_eq!(
                            sell_plat, rz,
                            "diverged: per_unit={per_unit} qty={qty} vol={vol:?} bids={bids:?}"
                        );
                        assert!(sell_qty <= qty);
                    }
                }
            }
        }
    }

    #[test]
    fn split_sells_all_when_bids_beat_dissolve() {
        // 3 copies, a deep 40p bid, dissolve worth 20p/copy → sell all 3 to the bid.
        assert_eq!(
            split_sell_dissolve(50, 3, Some(0), &[(40, 5)], 20.0, W, K, T),
            (3, 120)
        );
    }

    #[test]
    fn split_dissolves_all_when_floor_beats_market() {
        // Bids (15p) and the off-book tail (50×0.35 ≈ 17.5p) both lose to a 30p
        // dissolve floor → keep nothing for sale.
        assert_eq!(
            split_sell_dissolve(50, 5, Some(100), &[(15, 10)], 30.0, W, K, T),
            (0, 0)
        );
    }

    #[test]
    fn split_sells_to_bids_then_dissolves_the_tail() {
        // One 30p bid for 2 (beats the 20p floor); the tail (40×0.35 = 14p) does not.
        // → sell 2 @ 30, dissolve the other 3.
        assert_eq!(
            split_sell_dissolve(40, 5, Some(0), &[(30, 2)], 20.0, W, K, T),
            (2, 60)
        );
    }

    #[test]
    fn split_no_bids_thin_volume_dissolves_all() {
        // Junk common: 500 @ 3p, no bids, ~1 sale/wk, dissolve worth 5p → dissolve all.
        assert_eq!(
            split_sell_dissolve(3, 500, Some(1), &[], 5.0, W, K, T),
            (0, 0)
        );
    }

    #[test]
    fn split_unpriced_sells_nothing() {
        assert_eq!(
            split_sell_dissolve(0, 10, Some(50), &[], 5.0, W, K, T),
            (0, 0)
        );
    }

    #[test]
    fn split_default_clamps_sale_to_market() {
        // A pathological 99p bid can't value 3 copies above 3 × 50p = 150p.
        assert_eq!(
            split_sell_dissolve_default(50, 3, Some(0), &[(99, 5)], 20.0),
            (3, 150)
        );
    }

    #[test]
    fn no_bids_and_thin_volume_is_nearly_worthless() {
        // 500 copies at 3p, ~1 sale/week, ZERO buy orders: only a tiny volume tail.
        let rz = realizable_value(3, 500, Some(1), &[], W, K, T);
        assert!(rz < 20, "expected ~nothing, got {rz}");
    }

    #[test]
    fn fills_standing_bids_best_first() {
        // No volume tail; liquidate 5 into bids 55×2, 50×1 → 110 + 50, 2 unsold.
        let rz = realizable_value(50, 5, Some(0), &[(55, 2), (50, 1)], W, K, T);
        assert_eq!(rz, 160);
    }

    #[test]
    fn no_volume_no_bids_is_zero() {
        assert_eq!(realizable_value(10, 100, None, &[], W, K, T), 0);
    }

    #[test]
    fn zero_qty_does_not_panic() {
        assert_eq!(realizable_value(5, 0, Some(7), &[(4, 3)], W, K, T), 0);
    }

    #[test]
    fn default_clamps_to_market_and_reports_phi() {
        // ammo_drum-like: 236 @ 5p (market 1180), vol 9, no bids → heavy haircut.
        let (rz, phi) = realizable_default(5, 236, 1180, Some(9), &[]);
        assert!(rz < 120 && rz > 0, "got {rz}");
        assert!(phi < 0.12);
        // bids above market can't push realizable past the ceiling.
        let (rz2, phi2) = realizable_default(5, 3, 15, Some(0), &[(99, 10)]);
        assert_eq!(rz2, 15);
        assert_eq!(phi2, 1.0);
    }

    #[test]
    fn single_copy_and_primes_liquidate_fully() {
        // One copy of an illiquid mod (would be heavily haircut as a stack) is still
        // worth full market value — it only takes one buyer to clear one item.
        let (rz, phi) = realizable_for("mod", 100, 1, 100, Some(0), &[]);
        assert_eq!(rz, 100);
        assert_eq!(phi, 1.0);
        // A prime part stack liquidates fully regardless of qty (liquid + fungible).
        let (rz2, phi2) = realizable_for("set", 50, 10, 500, Some(0), &[]);
        assert_eq!(rz2, 500);
        assert_eq!(phi2, 1.0);
        // A multi-copy mod stack still takes the haircut (matches realizable_default).
        let market = 1180;
        assert_eq!(
            realizable_for("mod", 5, 236, market, Some(9), &[]),
            realizable_default(5, 236, market, Some(9), &[]),
        );
    }

    // Order-independent fingerprint of the whole valuation over a real DB copy.
    // Run on both branches (`WFIT_PROBE_DB=… cargo test -- --ignored --nocapture
    // probe_real_db`) to prove the read-pool + batching change is value-preserving.
    #[test]
    #[ignore]
    fn probe_real_db() {
        let path = std::env::var("WFIT_PROBE_DB").expect("set WFIT_PROBE_DB");
        let db = crate::db::Db::open(std::path::Path::new(&path)).unwrap();
        let rows = super::list_ranked(&db).unwrap();
        let tv = super::total_value(&db).unwrap();
        let tr = super::total_realizable(&db).unwrap();
        let mut fp: Vec<String> = rows
            .iter()
            .map(|r| {
                format!(
                    "{}|{}|{}|{}|{}|{:?}",
                    r.slug,
                    r.qty,
                    r.value_plat.unwrap_or(-1),
                    r.realizable_plat.unwrap_or(-1),
                    r.median_plat.unwrap_or(-1),
                    r.spark
                )
            })
            .collect();
        fp.sort();
        let mut h: u64 = 1469598103934665603;
        for s in &fp {
            for b in s.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(1099511628211);
            }
        }
        println!(
            "PROBE rows={} total_value={tv} total_realizable={tr} fp_hash={h:016x}",
            rows.len()
        );
    }
}
