use crate::db::wfm::{ImportApply, ListingMirror};
use crate::db::{
    buylist, catalog, gamescan as gamescan_db, inventory, meta, prices, sales, sets, settings,
    trends, watchlist, wfm,
};
use crate::error::{AppError, AppResult};
use crate::gamescan;
use crate::types::*;
use crate::wfm_account;
use crate::AppState;
use chrono::{Duration, Utc};
use std::sync::Arc;
use tauri::State;

const PRICE_TTL_HOURS: i64 = 6;
const HISTORY_DRAWER_DAYS: i64 = 90;
const FG_REFRESH_CAP: usize = 60;

// ===========================================================================
// Catalog
// ===========================================================================

#[tauri::command]
pub fn catalog_count(state: State<'_, Arc<AppState>>) -> AppResult<i64> {
    catalog::count(&state.db)
}

#[tauri::command]
pub async fn catalog_refresh(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    tracing::info!("catalog_refresh: GET /v2/items");
    let items = state.market.fetch_catalog().await?;
    tracing::info!(n = items.len(), "catalog_refresh: upserting");
    let n = catalog::upsert_many(&state.db, &items)?;
    meta::set(
        &state.db,
        meta::KEY_LAST_CATALOG_SYNC,
        &Utc::now().to_rfc3339(),
    )?;
    Ok(n)
}

/// Wipe the rebuildable API caches (prices, history, set composition) and
/// re-fetch the catalog. User data (inventory/sales/watchlist/buy_list) is never
/// touched. Prices repopulate via the background drain afterwards.
#[tauri::command]
pub async fn rebuild_cache(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    state.db.with(|c| {
        c.execute_batch(
            "DELETE FROM price_history;
             DELETE FROM price_cache;
             DELETE FROM set_membership;",
        )?;
        Ok(())
    })?;
    let items = state.market.fetch_catalog().await?;
    let n = catalog::upsert_many(&state.db, &items)?;
    meta::set(
        &state.db,
        meta::KEY_LAST_CATALOG_SYNC,
        &Utc::now().to_rfc3339(),
    )?;
    Ok(n)
}

#[tauri::command]
pub fn get_catalog(
    state: State<'_, Arc<AppState>>,
    category: Option<String>,
) -> AppResult<Vec<CatalogRow>> {
    catalog::list(&state.db, category.as_deref())
}

#[tauri::command]
pub fn search_catalog(
    state: State<'_, Arc<AppState>>,
    q: String,
    limit: Option<i64>,
) -> AppResult<Vec<CatalogRow>> {
    catalog::search(&state.db, &q, limit.unwrap_or(50))
}

// ===========================================================================
// Inventory
// ===========================================================================

#[tauri::command]
pub fn get_inventory(state: State<'_, Arc<AppState>>) -> AppResult<Vec<InventoryRow>> {
    inventory::list_ranked(&state.db)
}

/// Add to inventory, then best-effort fetch this item's price so the tile shows
/// a value immediately (a missing price is non-fatal — the drain backfills it).
#[tauri::command]
pub async fn add_to_inventory(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: Option<i64>,
) -> AppResult<i64> {
    let refresh = inventory::add_item_or_set(&state.db, &slug, qty.unwrap_or(1))?;
    for s in &refresh {
        if let Ok(Some(p)) = state.market.fetch_statistics(s).await {
            let _ = prices::upsert_many(&state.db, &[p], Duration::hours(PRICE_TTL_HOURS));
        }
    }
    Ok(refresh.len() as i64)
}

#[tauri::command]
pub fn set_qty(state: State<'_, Arc<AppState>>, slug: String, qty: i64) -> AppResult<i64> {
    inventory::set_qty_aware(&state.db, &slug, qty)
}

#[tauri::command]
pub fn remove_item(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<()> {
    inventory::remove_aware(&state.db, &slug)
}

#[tauri::command]
pub fn get_summary(state: State<'_, Arc<AppState>>) -> AppResult<Summary> {
    let at_target_count = watchlist::at_target_count(&state.db)?;
    let sold_7d = sales::earned_since(&state.db, 7)?;
    // Set-aware: complete sets are valued at the set price, not the sum of parts.
    let total_plat = inventory::total_value(&state.db)?;
    let realizable_plat = inventory::total_realizable(&state.db)?;
    state.db.with(|c| {
        let total_ducats: i64 = c.query_row(
            "SELECT COALESCE(SUM(COALESCE(ci.ducats, 0) * ii.qty), 0)
             FROM inventory_items ii JOIN catalog_items ci ON ci.slug = ii.slug
             WHERE ii.qty > 0",
            [],
            |r| r.get(0),
        )?;
        let part_count: i64 = c.query_row(
            "SELECT COALESCE(SUM(ii.qty), 0)
             FROM inventory_items ii JOIN catalog_items ci ON ci.slug = ii.slug
             WHERE ii.qty > 0 AND ci.category != 'set'",
            [],
            |r| r.get(0),
        )?;
        let distinct_count: i64 = c.query_row(
            "SELECT COUNT(*) FROM inventory_items WHERE qty > 0",
            [],
            |r| r.get(0),
        )?;
        let full_set_count: i64 = c.query_row(
            "WITH g AS (
                SELECT ci.set_slug AS s, COUNT(*) AS total,
                       SUM(CASE WHEN ii.qty >= 1 THEN 1 ELSE 0 END) AS owned
                FROM catalog_items ci
                LEFT JOIN inventory_items ii ON ii.slug = ci.slug
                WHERE ci.set_slug IS NOT NULL
                GROUP BY ci.set_slug
             )
             SELECT COUNT(*) FROM g WHERE total > 0 AND owned = total",
            [],
            |r| r.get(0),
        )?;
        let hot_count: i64 = c.query_row(
            "SELECT COUNT(*) FROM inventory_items ii
             JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0 AND pc.trend = 'up'",
            [],
            |r| r.get(0),
        )?;
        // Value-weighted 7d portfolio change.
        let (num, den): (f64, f64) = c.query_row(
            "SELECT
                COALESCE(SUM(COALESCE(pc.delta_7d, 0) * pc.median_plat * ii.qty), 0),
                COALESCE(SUM(CASE WHEN pc.delta_7d IS NOT NULL THEN pc.median_plat * ii.qty ELSE 0 END), 0)
             FROM inventory_items ii JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let portfolio_7d = if den > 0.0 { Some(num / den) } else { None };

        let last_synced: Option<String> = c
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                rusqlite::params![meta::KEY_LAST_PRICE_SYNC],
                |r| r.get(0),
            )
            .ok();

        Ok(Summary {
            total_plat,
            realizable_plat,
            total_ducats,
            part_count,
            distinct_count,
            full_set_count,
            portfolio_7d,
            hot_count,
            sold_7d,
            at_target_count,
            last_synced,
        })
    })
}

// ===========================================================================
// Sales
// ===========================================================================

#[tauri::command]
pub fn record_sale(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: Option<i64>,
    plat_per_unit: Option<i64>,
    notes: Option<String>,
) -> AppResult<i64> {
    let qty = qty.unwrap_or(1);
    let category: Option<String> = state.db.with(|c| {
        Ok(c.query_row(
            "SELECT category FROM catalog_items WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok())
    })?;
    // Selling a set sells one of each member part (a set is owned as its parts).
    if category.as_deref() == Some("set") {
        let members = inventory::set_members(&state.db, &slug)?;
        return sales::record_set(&state.db, &slug, &members, qty, plat_per_unit, notes);
    }
    sales::record(
        &state.db,
        sales::SaleRecord {
            slug,
            qty,
            plat_per_unit,
            notes,
        },
    )
}

#[tauri::command]
pub fn undo_sale(state: State<'_, Arc<AppState>>, id: i64) -> AppResult<()> {
    sales::undo(&state.db, id)
}

#[tauri::command]
pub fn get_sales(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> AppResult<Vec<SaleRow>> {
    sales::list_recent(&state.db, limit.unwrap_or(200))
}

// ===========================================================================
// Watchlist
// ===========================================================================

#[tauri::command]
pub fn get_watchlist(state: State<'_, Arc<AppState>>) -> AppResult<Vec<WatchRow>> {
    watchlist::list(&state.db)
}

#[tauri::command]
pub fn add_watch(
    state: State<'_, Arc<AppState>>,
    slug: String,
    target: Option<i64>,
) -> AppResult<()> {
    watchlist::add(&state.db, &slug, target)
}

#[tauri::command]
pub fn remove_watch(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<()> {
    watchlist::remove(&state.db, &slug)
}

#[tauri::command]
pub fn set_target(
    state: State<'_, Arc<AppState>>,
    slug: String,
    target: Option<i64>,
) -> AppResult<()> {
    watchlist::set_target(&state.db, &slug, target)
}

// ===========================================================================
// Buy list + budget
// ===========================================================================

#[tauri::command]
pub fn get_buy_list(state: State<'_, Arc<AppState>>) -> AppResult<Vec<BuyRow>> {
    buylist::list(&state.db)
}

#[tauri::command]
pub fn add_to_buy_list(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: Option<i64>,
) -> AppResult<()> {
    buylist::add(&state.db, &slug, qty.unwrap_or(1))
}

#[tauri::command]
pub fn set_buy_qty(state: State<'_, Arc<AppState>>, slug: String, qty: i64) -> AppResult<()> {
    buylist::set_qty(&state.db, &slug, qty)
}

#[tauri::command]
pub fn remove_buy(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<()> {
    buylist::remove(&state.db, &slug)
}

#[tauri::command]
pub fn purchase_buy(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<i64> {
    buylist::purchase(&state.db, &slug)
}

#[tauri::command]
pub fn get_budget(state: State<'_, Arc<AppState>>) -> AppResult<Option<i64>> {
    let v = settings::get(&state.db, settings::KEY_BUDGET)?;
    Ok(v.and_then(|s| s.parse::<i64>().ok()))
}

#[tauri::command]
pub fn set_budget(state: State<'_, Arc<AppState>>, value: i64) -> AppResult<()> {
    settings::set(&state.db, settings::KEY_BUDGET, &value.to_string())
}

// ===========================================================================
// Sets + Ducats (computed)
// ===========================================================================

#[tauri::command]
pub fn get_sets(state: State<'_, Arc<AppState>>) -> AppResult<Vec<SetRow>> {
    sets::list(&state.db)
}

#[tauri::command]
pub fn get_ducats(state: State<'_, Arc<AppState>>) -> AppResult<Vec<DucatRow>> {
    let mut rows: Vec<DucatRow> = state.db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT ci.slug, ci.display_name, ci.part_type, ii.qty, pc.median_plat, ci.ducats,
                    ci.thumbnail_url
             FROM inventory_items ii
             JOIN catalog_items ci ON ci.slug = ii.slug
             LEFT JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0 AND ci.ducats IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            let slug: String = r.get(0)?;
            let display_name: String = r.get(1)?;
            let part_type: String = r.get(2)?;
            let qty: i64 = r.get(3)?;
            let median_plat: Option<i64> = r.get(4)?;
            let ducats: i64 = r.get(5)?;
            let thumbnail_url: Option<String> = r.get(6)?;
            let ducats_per_plat = median_plat
                .filter(|&m| m > 0)
                .map(|m| ducats as f64 / m as f64);
            let cheap = median_plat.map(|m| m <= 8).unwrap_or(true);
            let efficient = ducats_per_plat.map(|d| d >= 5.0).unwrap_or(false);
            let verdict = if cheap || efficient { "ducat" } else { "plat" };
            Ok(DucatRow {
                slug,
                display_name,
                part_type,
                qty,
                median_plat,
                ducats,
                ducats_per_plat,
                verdict: verdict.to_string(),
                thumbnail_url,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })?;
    // Best efficiency first, tie-broken by qty.
    rows.sort_by(|a, b| {
        let da = a.ducats_per_plat.unwrap_or(0.0);
        let db = b.ducats_per_plat.unwrap_or(0.0);
        db.partial_cmp(&da)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.qty.cmp(&a.qty))
    });
    Ok(rows)
}

// ===========================================================================
// Trends
// ===========================================================================

#[tauri::command]
pub fn get_trends(
    state: State<'_, Arc<AppState>>,
    timeframe: Option<String>,
    exclude_outliers: Option<bool>,
) -> AppResult<TrendsData> {
    trends::get(
        &state.db,
        timeframe.as_deref().unwrap_or("7d"),
        exclude_outliers.unwrap_or(true),
    )
}

// ===========================================================================
// Prices / item detail
// ===========================================================================

/// Refresh prices. `slugs` overrides selection; otherwise refresh owned +
/// watchlist (stale/missing), capped. `force` ignores the TTL for owned items.
#[tauri::command]
pub async fn prices_refresh(
    state: State<'_, Arc<AppState>>,
    slugs: Option<Vec<String>>,
    force: Option<bool>,
) -> AppResult<usize> {
    let targets: Vec<String> = if let Some(s) = slugs {
        s
    } else if force.unwrap_or(false) {
        inventory::owned_slugs(&state.db)?
    } else {
        let mut v = prices::stale_inventory_slugs(&state.db)?;
        for s in prices::stale_watchlist_slugs(&state.db)? {
            if !v.contains(&s) {
                v.push(s);
            }
        }
        v.truncate(FG_REFRESH_CAP);
        v
    };

    let mut updates = Vec::with_capacity(targets.len());
    for slug in &targets {
        match state.market.fetch_statistics(slug).await {
            Ok(Some(p)) => updates.push(p),
            Ok(None) => tracing::debug!(slug, "no stats"),
            Err(e) => tracing::warn!(slug, error = %e, "fetch_statistics failed"),
        }
    }
    let n = if updates.is_empty() {
        0
    } else {
        prices::upsert_many(&state.db, &updates, Duration::hours(PRICE_TTL_HOURS))?
    };
    meta::set(
        &state.db,
        meta::KEY_LAST_PRICE_SYNC,
        &Utc::now().to_rfc3339(),
    )?;
    // A forced refresh ("Refresh prices") also re-pulls live sell orders for
    // illiquid owned items, so their value reflects real asks.
    if force.unwrap_or(false) {
        crate::refresh_owned_orders(state.inner(), true).await?;
    }
    Ok(n)
}

#[tauri::command]
pub fn get_item_detail(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<ItemDetail> {
    let row = catalog::get(&state.db, &slug)?
        .ok_or_else(|| AppError::NotFound(format!("unknown slug: {slug}")))?;
    // A set isn't stored in inventory directly — you own it by owning its parts.
    let owned_qty = if row.category == "set" {
        inventory::complete_set_count(&state.db, &slug)?
    } else {
        row.owned_qty
    };
    let history = prices::history(&state.db, &slug, HISTORY_DRAWER_DAYS)?;
    let on_watchlist = watchlist::is_watched(&state.db, &slug)?;
    let listed: bool = state.db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM market_listings WHERE slug = ?1 AND order_type = 'sell'",
            rusqlite::params![slug],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    })?;
    let volume_7d: Option<i64> = state.db.with(|c| {
        Ok(c.query_row(
            "SELECT volume_7d FROM price_cache WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok()
        .flatten())
    })?;
    let (realized_plat, sold_qty): (i64, i64) = state.db.with(|c| {
        Ok(c.query_row(
            "SELECT COALESCE(SUM(qty * plat_per_unit), 0), COALESCE(SUM(qty), 0)
             FROM sale_events WHERE slug = ?1",
            rusqlite::params![slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    })?;

    // Rank breakdown (mods/arcanes) for the drawer: each owned rank with its
    // exact-or-nearest per-rank market price.
    let max_rank: Option<i64> = state.db.with(|c| {
        Ok(c.query_row(
            "SELECT max_rank FROM catalog_items WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok()
        .flatten())
    })?;
    let ranks: Vec<OwnedRank> = state.db.with(|c| {
        let mut stmt =
            c.prepare("SELECT rank, qty FROM inventory_ranks WHERE slug = ?1 ORDER BY rank")?;
        let raw: Vec<(i64, i64)> = stmt
            .query_map(rusqlite::params![slug], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let mut out = Vec::with_capacity(raw.len());
        for (rank, qty) in raw {
            let median = prices::effective_price(c, &slug, Some(rank))?; // live ask preferred
            out.push(OwnedRank { rank, qty, median });
        }
        Ok(out)
    })?;
    // Value + displayed price prefer the live ask (effective_price): ranked → Σ
    // per-rank; non-ranked owned → live-sell × owned; else the statistics median.
    let (eff_median, value_plat): (Option<i64>, Option<i64>) = if !ranks.is_empty() {
        let v: i64 = ranks.iter().map(|r| r.median.unwrap_or(0) * r.qty).sum();
        // Blended per-unit so the headline price × owned == the stack value shown.
        let per_unit = if owned_qty > 0 {
            Some(v / owned_qty)
        } else {
            row.median_plat
        };
        (per_unit, Some(v))
    } else if owned_qty > 0 {
        let ep = state.db.with(|c| prices::effective_price(c, &slug, None))?;
        (ep.or(row.median_plat), ep.map(|p| p * owned_qty))
    } else {
        (row.median_plat, None)
    };

    // Liquidation-adjusted stack value + liquidity signals (mirrors the grid).
    let bids = state.db.with(|c| prices::bid_ladder(c, &slug))?;
    let (realizable_plat, liquidity, daily_volume, days_to_sell) = if owned_qty > 0 {
        let market = value_plat.unwrap_or_else(|| eff_median.unwrap_or(0) * owned_qty);
        let (rz, phi) =
            inventory::realizable_default(eff_median.unwrap_or(0), owned_qty, market, volume_7d, &bids);
        let dv = volume_7d.map(|v| (v.max(0) as f64) / 7.0);
        let dts = match volume_7d {
            Some(v) if v > 0 => Some((owned_qty as f64 / (v as f64 / 7.0)).round() as i64),
            _ => None,
        };
        (Some(rz), Some(phi), dv, dts)
    } else {
        (None, None, None, None)
    };
    let confidence = inventory::confidence_of(&slug, eff_median.is_some(), volume_7d, !bids.is_empty())
        .map(String::from);

    Ok(ItemDetail {
        slug: row.slug,
        display_name: row.display_name,
        part_type: row.part_type,
        category: row.category,
        set_slug: row.set_slug,
        ducats: row.ducats,
        median_plat: eff_median,
        trend: row.trend,
        delta_7d: row.delta_7d,
        volume_7d,
        thumbnail_url: row.thumbnail_url,
        owned_qty,
        on_watchlist,
        listed,
        realized_plat,
        sold_qty,
        max_rank,
        ranks,
        value_plat,
        realizable_plat,
        daily_volume,
        liquidity,
        days_to_sell,
        confidence,
        history,
    })
}

#[tauri::command]
pub fn get_item_history(
    state: State<'_, Arc<AppState>>,
    slug: String,
    timeframe: Option<String>,
) -> AppResult<Vec<HistoryPoint>> {
    let days = match timeframe.as_deref() {
        Some("24h") => 2,
        Some("7d") => 7,
        Some("30d") => 30,
        _ => 90,
    };
    prices::history(&state.db, &slug, days)
}

/// Live best buy/sell + buyer/seller counts for the drawer's spread row.
#[tauri::command]
pub async fn get_item_orders(
    state: State<'_, Arc<AppState>>,
    slug: String,
) -> AppResult<crate::types::ItemOrders> {
    state.market.fetch_item_orders(&slug).await
}

// ===========================================================================
// Worldstate (Rotation) — isolated source
// ===========================================================================

#[tauri::command]
pub async fn get_worldstate(
    state: State<'_, Arc<AppState>>,
) -> AppResult<crate::worldstate::Worldstate> {
    state.worldstate.get().await
}

// ===========================================================================
// warframe.market account (Listings) — read-only in v1
// ===========================================================================

#[tauri::command]
pub fn get_wfm_account(state: State<'_, Arc<AppState>>) -> AppResult<WfmAccount> {
    let mut acct = wfm::get_account(&state.db)?;
    acct.has_session = wfm_account::has_session();
    Ok(acct)
}

/// Tier 1: connect by public username. Validates by fetching visible orders.
#[tauri::command]
pub async fn wfm_connect(
    state: State<'_, Arc<AppState>>,
    username: String,
) -> AppResult<WfmAccount> {
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::Invalid("username is empty".into()));
    }
    // A successful (even empty) fetch confirms the profile is reachable.
    let _ = state.market.fetch_user_orders(&username, None).await?;
    wfm::set_account(&state.db, &username, Some("online"))?;
    get_wfm_account(state)
}

/// Tier 2: store a pasted JWT in the keychain after a validating call.
#[tauri::command]
pub async fn wfm_set_session(
    state: State<'_, Arc<AppState>>,
    jwt: String,
) -> AppResult<WfmAccount> {
    let acct = wfm::get_account(&state.db)?;
    let username = acct
        .username
        .ok_or_else(|| AppError::NotConnected("connect a username first".into()))?;
    // Validate the token by making one authenticated call.
    let _ = state
        .market
        .fetch_user_orders(&username, Some(jwt.trim()))
        .await?;
    wfm_account::store_jwt(jwt.trim())?;
    get_wfm_account(state)
}

#[tauri::command]
pub fn wfm_signout(state: State<'_, Arc<AppState>>) -> AppResult<()> {
    wfm_account::delete_jwt()?;
    wfm::clear_account(&state.db)
}

/// Refresh the read-only listings mirror from warframe.market.
#[tauri::command]
pub async fn wfm_sync_listings(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    let acct = wfm::get_account(&state.db)?;
    let username = acct
        .username
        .ok_or_else(|| AppError::NotConnected("not connected".into()))?;
    let jwt = wfm_account::load_jwt()?;
    let orders = state
        .market
        .fetch_user_orders(&username, jwt.as_deref())
        .await?;

    // Keep only orders that map to a tracked catalog slug.
    let mirror: Vec<ListingMirror> = orders
        .into_iter()
        .filter_map(|o| {
            let known: bool = state
                .db
                .with(|c| {
                    let n: i64 = c.query_row(
                        "SELECT COUNT(*) FROM catalog_items WHERE slug = ?1",
                        rusqlite::params![o.item.url_name],
                        |r| r.get(0),
                    )?;
                    Ok(n > 0)
                })
                .unwrap_or(false);
            if !known {
                return None;
            }
            Some(ListingMirror {
                order_id: o.id,
                slug: o.item.url_name,
                order_type: "sell".into(),
                your_price: o.platinum,
                qty: o.quantity.unwrap_or(1),
                visible: o.visible,
            })
        })
        .collect();
    wfm::replace_listings(&state.db, &mirror)
}

#[tauri::command]
pub fn wfm_get_listings(state: State<'_, Arc<AppState>>) -> AppResult<Vec<ListingRow>> {
    wfm::list_listings(&state.db)
}

/// Preview the import: map current orders to catalog rows. Does NOT write.
#[tauri::command]
pub async fn wfm_fetch_listings(state: State<'_, Arc<AppState>>) -> AppResult<Vec<ImportRow>> {
    let acct = wfm::get_account(&state.db)?;
    let username = acct
        .username
        .ok_or_else(|| AppError::NotConnected("not connected".into()))?;
    let jwt = wfm_account::load_jwt()?;
    let orders = state
        .market
        .fetch_user_orders(&username, jwt.as_deref())
        .await?;

    let mut out = Vec::new();
    for o in orders {
        let row = catalog::get(&state.db, &o.item.url_name)?;
        if let Some(r) = row {
            out.push(ImportRow {
                slug: r.slug,
                display_name: r.display_name,
                part_type: r.part_type,
                listed_qty: o.quantity.unwrap_or(1),
                your_price: o.platinum,
                current_qty: r.owned_qty,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn wfm_apply_import(
    state: State<'_, Arc<AppState>>,
    rows: Vec<ImportApply>,
) -> AppResult<usize> {
    let n = wfm::apply_import(&state.db, &rows)?;
    wfm::mark_imported(&state.db)?;
    Ok(n)
}

// ===========================================================================
// Set composition (Pass B) — optional background enrichment
// ===========================================================================

/// Fetch set composition for set-tagged items and fill set_membership. Cheap
/// path (~157 calls): only the 'set' category. Throttled by the shared limiter.
#[tauri::command]
pub async fn sets_refresh(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    let set_slugs: Vec<String> = state.db.with(|c| {
        let mut stmt = c.prepare("SELECT slug FROM catalog_items WHERE category = 'set'")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })?;
    let id_map = catalog::id_slug_map(&state.db)?;

    let mut written = 0usize;
    for set_slug in set_slugs {
        let Ok(Some(detail)) = state.market.fetch_detail(&set_slug).await else {
            continue;
        };
        for part_id in detail.set_parts {
            if let Some(part_slug) = id_map.get(&part_id) {
                if part_slug == &set_slug {
                    continue; // the set item lists itself
                }
                state.db.with(|c| {
                    c.execute(
                        "INSERT INTO set_membership (set_slug, part_slug, quantity_in_set)
                         VALUES (?1, ?2, ?3)
                         ON CONFLICT(set_slug, part_slug) DO UPDATE SET
                            quantity_in_set = excluded.quantity_in_set",
                        rusqlite::params![set_slug, part_slug, detail.quantity_in_set.max(1)],
                    )?;
                    Ok(())
                })?;
                written += 1;
            }
        }
    }
    Ok(written)
}

// ===========================================================================
// Game inventory import (memory-scan). Opt-in, consent-gated, Linux-only.
// Mirrors the wfm listings preview/apply split. ToS-prohibited / ban-risky —
// see GAME_INVENTORY_IMPORT.md.
// ===========================================================================

/// Drive the Settings UI. Does NOT scan — only reads consent state + detects the
/// game process (process listing, not memory).
#[tauri::command]
pub fn game_scan_status(state: State<'_, Arc<AppState>>) -> AppResult<GameScanStatus> {
    let st = gamescan_db::get_state(&state.db)?;
    Ok(GameScanStatus {
        supported: gamescan::is_supported(),
        consented: st.consent_at.is_some(),
        warframe_running: gamescan::is_supported() && gamescan::warframe_running(),
        auto_sync: st.auto_sync,
        last_scan_at: st.last_scan_at,
    })
}

/// Record risk acceptance — only on an exact match of the required phrase.
#[tauri::command]
pub fn game_scan_consent(state: State<'_, Arc<AppState>>, phrase: String) -> AppResult<()> {
    if !gamescan::consent::validate(&phrase) {
        return Err(AppError::Invalid(
            "the acknowledgment phrase did not match exactly".into(),
        ));
    }
    gamescan_db::set_consent(&state.db)
}

/// Revoke consent — restores the warning prompt. Does not touch inventory.
#[tauri::command]
pub fn game_scan_revoke(state: State<'_, Arc<AppState>>) -> AppResult<()> {
    gamescan_db::clear_consent(&state.db)
}

/// Read-only preview: gated on consent + a running game, scan → map → diff.
/// Writes nothing (other than last-scan bookkeeping).
#[tauri::command]
pub async fn game_scan_preview(
    state: State<'_, Arc<AppState>>,
) -> AppResult<Vec<ScanDiffRow>> {
    if !gamescan::is_supported() {
        return Err(AppError::Invalid("game inventory scan is Linux-only".into()));
    }
    if !gamescan_db::is_consented(&state.db)? {
        return Err(AppError::Invalid(
            "game inventory scan requires consent first".into(),
        ));
    }
    if !gamescan::warframe_running() {
        return Err(AppError::NotConnected(
            "Warframe does not appear to be running".into(),
        ));
    }
    let raw = gamescan::scan().await?;
    let map = gamescan_db::game_ref_to_slug(&state.db)?;
    let resolved = gamescan::map::resolve(&raw.items, &map);
    gamescan_db::record_scan(&state.db, raw.account_id.as_deref())?;
    gamescan_db::diff(&state.db, &resolved)
}

/// Apply the user-confirmed subset of the diff. The only writer; transactional.
#[tauri::command]
pub fn game_scan_apply(
    state: State<'_, Arc<AppState>>,
    rows: Vec<ScanApply>,
) -> AppResult<usize> {
    if !gamescan_db::is_consented(&state.db)? {
        return Err(AppError::Invalid(
            "game inventory scan requires consent first".into(),
        ));
    }
    gamescan_db::merge_from_scan(&state.db, &rows)
}
