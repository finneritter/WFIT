use crate::db::wfm::{ImportApply, ListingMirror};
use crate::db::{
    account, buylist, catalog, gamescan as gamescan_db, inventory, meta, prices, recommend,
    relic_data, relics, sales, sets, settings, trends, vault, vendor, wanted, watchlist, wfm,
};
use crate::error::{AppError, AppResult};
use crate::gamescan;
use crate::types::*;
use crate::wfm_account;
use crate::AppState;
use chrono::{Duration, Utc};
use rusqlite::OptionalExtension;
use std::sync::Arc;
use tauri::{Manager, State};

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

/// One-click "Update game data" for after a Warframe patch: force-refresh the catalog
/// (new tradeable items + ducats), vault status (vault/unvault rotations), set
/// composition, and relic data (new relics/drops from WFCD). Each step is best-effort —
/// a single source being down still returns a partial summary rather than erroring.
/// Prices for new items fill in via the background pricer.
#[tauri::command]
pub async fn update_game_data(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
) -> AppResult<GameDataUpdate> {
    use tauri::Emitter;
    const STEPS: u32 = 5;
    // Emit a progress tick on `game-data-progress` for the UI bar (best-effort).
    let tick = |step: u32, label: &str, current: u32, total: u32| {
        let _ = app.emit(
            "game-data-progress",
            GameDataProgress {
                step,
                steps: STEPS,
                label: label.to_string(),
                current,
                total,
            },
        );
    };

    let catalog_before = catalog::count(&state.db)?;
    let relics_before = relic_data::relic_count(&state.db)?;

    // 1) Catalog — new items + ducats from warframe.market.
    tick(1, "Refreshing item catalog…", 0, 0);
    if let Ok(items) = state.market.fetch_catalog().await {
        catalog::upsert_many(&state.db, &items)?;
        meta::set(
            &state.db,
            meta::KEY_LAST_CATALOG_SYNC,
            &Utc::now().to_rfc3339(),
        )?;
    }
    // 2) Vault rotations (forced, ignores the 30-day TTL).
    tick(2, "Checking vault status…", 0, 0);
    let vault_refreshed = vault::refresh_force(&state.db).await.unwrap_or(false);
    // 3) Set composition (new/changed sets) — the slow pass; report per-set progress.
    tick(3, "Syncing set composition…", 0, 0);
    let sets_synced = sets_refresh_inner(&state, |done, total| {
        tick(3, "Syncing set composition…", done as u32, total as u32);
    })
    .await
    .unwrap_or(0);
    // 4) Relic data from WFCD (new relics/drop tables/vault), applied live.
    tick(4, "Updating relic data…", 0, 0);
    let relics_refreshed = relic_data::refresh(&state.db).await.unwrap_or(false);
    // 5) Item manifest from WFCD (non-tradeable name/icon/mastery for the Account screen).
    tick(5, "Updating item manifest…", 0, 0);
    let manifest_refreshed = account::refresh_manifest(&state.db).await.unwrap_or(false);

    let catalog_total = catalog::count(&state.db)?;
    let relics_total = relic_data::relic_count(&state.db)?;
    let manifest_total = account::manifest_count(&state.db)?;
    Ok(GameDataUpdate {
        catalog_new: (catalog_total - catalog_before).max(0),
        catalog_total,
        vault_refreshed,
        sets_synced: sets_synced as i64,
        relics_new: (relics_total - relics_before).max(0),
        relics_total,
        relics_refreshed,
        manifest_total,
        manifest_refreshed,
    })
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

/// A single catalog row by slug (or null). Lets a screen preselect an item it only
/// has the slug for — e.g. the Drawer's "Market" button jumping to the Market view.
#[tauri::command]
pub fn get_catalog_item(
    state: State<'_, Arc<AppState>>,
    slug: String,
) -> AppResult<Option<CatalogRow>> {
    catalog::get(&state.db, &slug)
}

/// DEV factory reset: erase ALL local data — inventory, sales, watchlist, buy list,
/// settings, every cache and the catalog — then restart so the app comes back up
/// exactly like a fresh install (re-fetches catalog/vault/prices from scratch).
/// Destructive + irreversible; the UI gates it behind a dev-mode two-step confirm.
#[tauri::command]
pub fn wipe_app(state: State<'_, Arc<AppState>>, app: tauri::AppHandle) -> AppResult<()> {
    state.db.with_mut(|conn| {
        conn.pragma_update(None, "foreign_keys", "OFF")?;
        let tables: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let tx = conn.transaction()?;
        for t in &tables {
            // Table names come from sqlite_master (our own schema), not user input.
            tx.execute(&format!("DELETE FROM \"{t}\""), [])?;
        }
        tx.commit()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Ok(())
    })?;
    tracing::warn!("app wiped (dev factory reset); restarting");
    app.restart();
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
        // Value-weighted 7d portfolio change — shared with the Trends holdings
        // band so the two screens can never disagree.
        let portfolio_7d = inventory::portfolio_7d_change(c)?;

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

/// Pricing/sync progress for the "syncing…" indicator. Reflects owned items when an
/// inventory exists ("your value is settling"); falls back to the whole tradeable
/// catalog when it's empty (fresh install / post-wipe), so a reset still shows
/// progress while the catalog re-prices.
#[tauri::command]
pub fn get_pricing_progress(state: State<'_, Arc<AppState>>) -> AppResult<PricingProgress> {
    let active = state
        .pricing_active
        .load(std::sync::atomic::Ordering::Relaxed);
    state.db.with(|c| {
        let owned_total: i64 = c.query_row(
            "SELECT COUNT(*) FROM inventory_items WHERE qty > 0",
            [],
            |r| r.get(0),
        )?;
        let (priced, total) = if owned_total > 0 {
            let owned_priced: i64 = c.query_row(
                "SELECT COUNT(*) FROM inventory_items ii
                 JOIN price_cache pc ON pc.slug = ii.slug
                 WHERE ii.qty > 0 AND pc.median_plat IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            (owned_priced, owned_total)
        } else {
            let cat_total: i64 = c.query_row(
                "SELECT COUNT(*) FROM catalog_items WHERE is_tradeable = 1",
                [],
                |r| r.get(0),
            )?;
            let cat_priced: i64 = c.query_row(
                "SELECT COUNT(*) FROM catalog_items ci
                 JOIN price_cache pc ON pc.slug = ci.slug
                 WHERE ci.is_tradeable = 1 AND pc.median_plat IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            (cat_priced, cat_total)
        };
        let last_price_sync: Option<String> = c
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                rusqlite::params![meta::KEY_LAST_PRICE_SYNC],
                |r| r.get(0),
            )
            .ok();
        Ok(PricingProgress {
            active,
            priced,
            total,
            last_price_sync,
        })
    })
}

#[tauri::command]
pub fn set_budget(state: State<'_, Arc<AppState>>, value: i64) -> AppResult<()> {
    settings::set(&state.db, settings::KEY_BUDGET, &value.to_string())
}

/// Mod rarities excluded from portfolio valuation (canonical lowercase slugs).
#[tauri::command]
pub fn get_excluded_rarities(state: State<'_, Arc<AppState>>) -> AppResult<Vec<String>> {
    settings::excluded_rarities(&state.db)
}

/// Set the excluded mod rarities. Only canonical rarities are kept; order/dupes
/// are normalized, so the stored value is stable.
#[tauri::command]
pub fn set_excluded_rarities(
    state: State<'_, Arc<AppState>>,
    rarities: Vec<String>,
) -> AppResult<()> {
    let clean: Vec<&str> = crate::domain::mod_rarity::RARITIES
        .iter()
        .copied()
        .filter(|r| rarities.iter().any(|x| x == r))
        .collect();
    settings::set(&state.db, settings::KEY_EXCLUDED_RARITIES, &clean.join(","))
}

/// Value floor (plat) sparing the pricier mods of an excluded rarity. 0 = no floor.
#[tauri::command]
pub fn get_excluded_min_plat(state: State<'_, Arc<AppState>>) -> AppResult<i64> {
    settings::excluded_min_plat(&state.db)
}

#[tauri::command]
pub fn set_excluded_min_plat(state: State<'_, Arc<AppState>>, value: i64) -> AppResult<()> {
    settings::set(
        &state.db,
        settings::KEY_EXCLUDED_MIN_PLAT,
        &value.max(0).to_string(),
    )
}

/// Per-category cheap-item plat floors (category → min plat). Items at/below their
/// category's floor are dropped from the portfolio value.
#[tauri::command]
pub fn get_excluded_min_plat_by_cat(
    state: State<'_, Arc<AppState>>,
) -> AppResult<std::collections::HashMap<String, i64>> {
    settings::excluded_min_plat_by_cat(&state.db)
}

#[tauri::command]
pub fn set_excluded_min_plat_by_cat(
    state: State<'_, Arc<AppState>>,
    thresholds: std::collections::HashMap<String, i64>,
) -> AppResult<()> {
    // Keep only known categories with a positive floor, so the stored value is clean.
    const CATS: [&str; 5] = ["warframe", "weapon", "set", "mod", "arcane"];
    let clean: std::collections::HashMap<&str, i64> = CATS
        .iter()
        .filter_map(|&c| thresholds.get(c).filter(|&&v| v > 0).map(|&v| (c, v)))
        .collect();
    let json = serde_json::to_string(&clean).map_err(crate::error::AppError::from)?;
    settings::set(&state.db, settings::KEY_EXCLUDED_MIN_PLAT_BY_CAT, &json)
}

#[tauri::command]
pub fn get_notification_prefs(
    state: State<'_, Arc<AppState>>,
) -> AppResult<settings::NotificationPrefs> {
    settings::notification_prefs(&state.db)
}

#[tauri::command]
pub fn set_notification_prefs(
    state: State<'_, Arc<AppState>>,
    prefs: settings::NotificationPrefs,
) -> AppResult<()> {
    settings::set_notification_prefs(&state.db, &prefs)?;
    // Mirror into the cached flag the window-close handler reads, so the change
    // takes effect on the very next close with no restart.
    state
        .close_to_tray
        .store(prefs.close_to_tray, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Fire a notification immediately so the user can confirm OS toasts work (and
/// grant the permission prompt on platforms that gate it).
#[tauri::command]
pub fn send_test_notification(app: tauri::AppHandle) -> AppResult<()> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("WFIT")
        .body("Notifications are working.")
        .show()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
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
                    ci.is_vaulted, pc.trend, ci.thumbnail_url
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
            let is_vaulted: bool = r.get::<_, i64>(6)? != 0;
            let trend: Option<String> = r.get(7)?;
            let thumbnail_url: Option<String> = r.get(8)?;
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
                is_vaulted,
                trend,
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
// Arcanes / Vosfor
// ===========================================================================

#[tauri::command]
pub fn get_arcane_dashboard(state: State<'_, Arc<AppState>>) -> AppResult<ArcaneDashboard> {
    crate::db::arcanes::dashboard(&state.db)
}

/// Every arcane in one collection with its plat + Vosfor value, for the breakdown
/// modal. Sorted by EV contribution (what's driving the collection's value).
#[tauri::command]
pub fn get_collection_breakdown(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> AppResult<Vec<ArcaneBreakdown>> {
    crate::db::arcanes::collection_breakdown(&state.db, &key)
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
// Listing recommendations
// ===========================================================================

/// Owned items the user should list for plat: liquid (10+/day), not better
/// ducated, outlier-cleaned, and not already up. Powers the Listings "Recommended" tab.
#[tauri::command]
pub fn get_listing_recommendations(
    state: State<'_, Arc<AppState>>,
) -> AppResult<Vec<RecommendationRow>> {
    recommend::list(&state.db)
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
    // Surface this refresh in the "pricing…" indicator; reset even on error.
    state
        .pricing_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let result = async {
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
        Ok::<usize, AppError>(n)
    }
    .await;
    state
        .pricing_active
        .store(false, std::sync::atomic::Ordering::Relaxed);
    result
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
    let listed: bool = state.db.read(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM market_listings WHERE slug = ?1 AND order_type = 'sell'",
            rusqlite::params![slug],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    })?;
    let volume_7d: Option<i64> = state.db.read(|c| {
        Ok(c.query_row(
            "SELECT volume_7d FROM price_cache WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok()
        .flatten())
    })?;
    let (realized_plat, sold_qty): (i64, i64) = state.db.read(|c| {
        Ok(c.query_row(
            "SELECT COALESCE(SUM(qty * plat_per_unit), 0), COALESCE(SUM(qty), 0)
             FROM sale_events WHERE slug = ?1",
            rusqlite::params![slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    })?;

    // Rank breakdown (mods/arcanes) for the drawer: each owned rank with its
    // exact-or-nearest per-rank market price.
    let max_rank: Option<i64> = state.db.read(|c| {
        Ok(c.query_row(
            "SELECT max_rank FROM catalog_items WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok()
        .flatten())
    })?;
    let ranks: Vec<OwnedRank> = state.db.read(|c| {
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
        let ep = state.db.read(|c| prices::effective_price(c, &slug, None))?;
        (ep.or(row.median_plat), ep.map(|p| p * owned_qty))
    } else {
        (row.median_plat, None)
    };

    // Liquidation-adjusted stack value + liquidity signals (mirrors the grid).
    let bids = state.db.read(|c| prices::bid_ladder(c, &slug))?;
    let (realizable_plat, liquidity, daily_volume, days_to_sell) = if owned_qty > 0 {
        let market = value_plat.unwrap_or_else(|| eff_median.unwrap_or(0) * owned_qty);
        // Same rule as the inventory grid: single copies / prime parts liquidate
        // fully (φ = 1.0); only multi-copy mod/arcane stacks take the haircut.
        let (rz, phi) = inventory::realizable_for(
            &row.category,
            eff_median.unwrap_or(0),
            owned_qty,
            market,
            volume_7d,
            &bids,
        );
        let dv = volume_7d.map(|v| (v.max(0) as f64) / 7.0);
        let dts = match volume_7d {
            Some(v) if v > 0 => Some((owned_qty as f64 / (v as f64 / 7.0)).round() as i64),
            _ => None,
        };
        (Some(rz), Some(phi), dv, dts)
    } else {
        (None, None, None, None)
    };
    let confidence =
        inventory::confidence_of(&slug, eff_median.is_some(), volume_7d, !bids.is_empty())
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

/// Per-seller live SELL orders for the Market page (with whisper data + the live
/// buy-side aggregate). Resolves the item name + rank ceiling from the local
/// catalog so the whisper line needs no second round-trip.
#[tauri::command]
pub async fn get_item_sellers(
    state: State<'_, Arc<AppState>>,
    slug: String,
) -> AppResult<crate::types::ItemSellers> {
    let resolved: Option<(String, Option<i64>)> = state.db.read(|c| {
        Ok(c.query_row(
            "SELECT display_name, max_rank FROM catalog_items WHERE slug = ?1",
            rusqlite::params![slug],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok())
    })?;
    let (display_name, max_rank) = resolved.unwrap_or_else(|| (slug.clone(), None));
    state
        .market
        .fetch_item_sellers(&slug, display_name, max_rank)
        .await
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

/// Hard reset for the Rotation screen: discard the cached worldstate +
/// arbitration schedule and re-fetch everything from the live sources now.
#[tauri::command]
pub async fn force_worldstate_refresh(
    state: State<'_, Arc<AppState>>,
) -> AppResult<crate::worldstate::Worldstate> {
    state.worldstate.force_refresh().await
}

/// Baro + Varzia stock cross-referenced against the catalog: market value, owned
/// qty, cost-per-plat, and a "worth grabbing" flag. Reads the (cached) worldstate,
/// then enriches via `db::vendor` — the worldstate module stays DB-free.
#[tauri::command]
pub async fn get_vendor_intel(state: State<'_, Arc<AppState>>) -> AppResult<VendorIntel> {
    let ws = state.worldstate.get().await?;
    let baro = match &ws.baro {
        Some(t) => vendor::enrich(&state.db, &t.inventory)?,
        None => Vec::new(),
    };
    let varzia = match &ws.varzia {
        Some(t) => vendor::enrich(&state.db, &t.inventory)?,
        None => Vec::new(),
    };
    Ok(VendorIntel { baro, varzia })
}

/// Pre-normalized wanted item, kept hot across many reward comparisons.
struct WantedNorm {
    slug: String,
    name: String,
    name_norm: String,
}

/// Match one reward string against every wanted item, pushing a row for each hit
/// (deduped per slug+source via `seen`).
fn match_reward(
    reward: &str,
    label: &str,
    eta: &Option<String>,
    wanted: &[WantedNorm],
    seen: &mut std::collections::HashSet<String>,
    out: &mut Vec<WantedNowRow>,
) {
    let reward_norm = catalog::normalize_name(reward);
    for w in wanted {
        if crate::domain::reward_match::reward_matches(&reward_norm, &w.name_norm)
            && seen.insert(format!("{}|{label}", w.slug))
        {
            out.push(WantedNowRow {
                slug: w.slug.clone(),
                display_name: w.name.clone(),
                source_label: label.to_string(),
                eta: eta.clone(),
            });
        }
    }
}

/// Wanted items (watchlist + missing set parts) that a live reward source —
/// invasions or the current Steel Path rotation — is handing out right now. Empty
/// when nothing you want is currently farmable. Free-text reward matching is
/// deliberately conservative (see `domain::reward_match`).
#[tauri::command]
pub async fn get_wanted_now(state: State<'_, Arc<AppState>>) -> AppResult<Vec<WantedNowRow>> {
    let wanted_raw = wanted::wanted_items(&state.db)?;
    if wanted_raw.is_empty() {
        return Ok(Vec::new());
    }
    let wanted: Vec<WantedNorm> = wanted_raw
        .into_iter()
        .map(|(slug, name)| {
            let name_norm = catalog::normalize_name(&name);
            WantedNorm {
                slug,
                name,
                name_norm,
            }
        })
        .collect();

    let ws = state.worldstate.get().await?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    for inv in &ws.invasions {
        let label = format!("Invasion · {}", inv.node);
        if let Some(r) = &inv.attacker_reward {
            match_reward(r, &label, &inv.eta, &wanted, &mut seen, &mut out);
        }
        if let Some(r) = &inv.defender_reward {
            match_reward(r, &label, &inv.eta, &wanted, &mut seen, &mut out);
        }
    }
    if let Some(sp) = &ws.steel_path {
        if let Some(cur) = &sp.current_reward {
            match_reward(
                &cur.name,
                "Steel Path · Teshin",
                &sp.expiry,
                &wanted,
                &mut seen,
                &mut out,
            );
        }
    }
    Ok(out)
}

// ===========================================================================
// Relics (owned void relics — drop-EV valued, crack-now against live fissures)
// ===========================================================================

#[tauri::command]
pub fn get_relics(state: State<'_, Arc<AppState>>) -> AppResult<Vec<RelicRow>> {
    relics::owned_relics(&state.db)
}

/// Every known relic (tier + name), for the manual-add picker. Static reference data.
#[tauri::command]
pub fn list_relic_choices() -> Vec<RelicChoice> {
    relics::list_choices()
}

#[tauri::command]
pub fn add_relic(
    state: State<'_, Arc<AppState>>,
    tier: String,
    name: String,
    refinement: Option<String>,
    qty: Option<i64>,
) -> AppResult<()> {
    relics::add(
        &state.db,
        &tier,
        &name,
        refinement.as_deref(),
        qty.unwrap_or(1),
    )
}

#[tauri::command]
pub fn set_relic_qty(
    state: State<'_, Arc<AppState>>,
    tier: String,
    name: String,
    refinement: Option<String>,
    qty: i64,
) -> AppResult<()> {
    relics::set_qty(&state.db, &tier, &name, refinement.as_deref(), qty)
}

#[tauri::command]
pub fn remove_relic(
    state: State<'_, Arc<AppState>>,
    tier: String,
    name: String,
    refinement: Option<String>,
) -> AppResult<()> {
    relics::remove(&state.db, &tier, &name, refinement.as_deref())
}

/// Owned relics that can drop a wanted item (watch/buy list or a near-complete set
/// part), each flagged with whether a live fissure can crack it now. Powers the
/// Rotation "Crack" tab.
#[tauri::command]
pub async fn get_crack_now(state: State<'_, Arc<AppState>>) -> AppResult<Vec<CrackNowRow>> {
    let ws = state.worldstate.get().await?;
    let live_tiers: std::collections::HashSet<String> =
        ws.fissures.iter().map(|f| f.tier.clone()).collect();
    let wanted = wanted::crack_targets(&state.db)?;
    relics::crack_now(&state.db, &live_tiers, &wanted)
}

/// Owned relics worth cracking next, ranked by a combined priority (completes a
/// near-complete set → drops a watch/buy-list item → drops a vaulted part →
/// crackable now → EV). Powers the Relics screen "To crack" tab.
#[tauri::command]
pub async fn get_crack_plan(state: State<'_, Arc<AppState>>) -> AppResult<Vec<CrackPlanRow>> {
    let ws = state.worldstate.get().await?;
    let live_tiers: std::collections::HashSet<String> =
        ws.fissures.iter().map(|f| f.tier.clone()).collect();
    let signals = wanted::crack_signals(&state.db)?;
    relics::crack_plan(&state.db, &live_tiers, &signals)
}

// ===========================================================================
// warframe.market account (Listings) — read-only in v1
// ===========================================================================

#[tauri::command]
pub fn get_wfm_account(state: State<'_, Arc<AppState>>) -> AppResult<WfmAccount> {
    let mut acct = wfm::get_account(&state.db)?;
    acct.has_session = wfm_account::has_session();
    let (expires_at, expired) = wfm_account::session_expiry();
    acct.session_expires_at = expires_at;
    acct.session_expired = expired;
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
    let _ = wfm::get_account(&state.db)?
        .username
        .ok_or_else(|| AppError::NotConnected("connect a username first".into()))?;
    // Validate against an authenticated endpoint so a bad/expired token is caught now,
    // not later on the first write (the public orders endpoint can't tell us this).
    state
        .market
        .fetch_me(jwt.trim())
        .await
        .map_err(|e| AppError::Invalid(format!("session token rejected: {e}")))?;
    wfm_account::store_jwt(jwt.trim())?;
    get_wfm_account(state)
}

#[tauri::command]
pub fn wfm_signout(state: State<'_, Arc<AppState>>) -> AppResult<()> {
    // Drop presence first so the keeper can push "invisible" and close the socket
    // while the token is still available, then forget the session.
    state.presence.set(crate::wfm_socket::Desired::Offline);
    wfm_account::delete_jwt()?;
    wfm::clear_account(&state.db)
}

/// Refresh the read-only listings mirror from warframe.market.
#[tauri::command]
pub async fn wfm_sync_listings(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    sync_listings_impl(state.inner()).await
}

/// Command body, callable without a `State` wrapper — the live heartbeat
/// (`lib.rs`) piggybacks a listings sync on its tick every ~10 min.
pub(crate) async fn sync_listings_impl(state: &Arc<AppState>) -> AppResult<usize> {
    let acct = wfm::get_account(&state.db)?;
    let username = acct
        .username
        .ok_or_else(|| AppError::NotConnected("not connected".into()))?;
    let jwt = wfm_account::load_jwt()?;
    let orders = state
        .market
        .fetch_user_orders(&username, jwt.as_deref())
        .await?;

    // Resolve warframe.market item ids -> our catalog slugs; drop untracked items.
    let id_to_slug = catalog::id_slug_map(&state.db)?;
    let mirror: Vec<ListingMirror> = orders
        .into_iter()
        .filter_map(|o| {
            let slug = id_to_slug.get(&o.item_id)?.clone();
            Some(ListingMirror {
                order_id: o.id,
                slug,
                order_type: o.order_type,
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

    let id_to_slug = catalog::id_slug_map(&state.db)?;
    let mut out = Vec::new();
    for o in orders {
        if o.order_type != "sell" {
            continue;
        }
        let Some(slug) = id_to_slug.get(&o.item_id) else {
            continue;
        };
        if let Some(r) = catalog::get(&state.db, slug)? {
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

// ---------------------------------------------------------------------------
// Order management (Tier 2 — writes; require a session JWT in the keychain)
// ---------------------------------------------------------------------------

/// Load the session JWT or fail with a clear "needs a session" error.
fn require_jwt() -> AppResult<String> {
    wfm_account::load_jwt()?
        .ok_or_else(|| AppError::NotConnected("writing orders requires a session token".into()))
}

const STATUSES: [&str; 3] = ["ingame", "online", "invisible"];

/// Create a sell order on warframe.market, then re-sync the mirror.
#[tauri::command]
pub async fn wfm_create_order(
    state: State<'_, Arc<AppState>>,
    slug: String,
    platinum: i64,
    quantity: i64,
    per_trade: Option<i64>,
    rank: Option<i64>,
    visible: bool,
) -> AppResult<usize> {
    if platinum <= 0 {
        return Err(AppError::Invalid("price must be greater than 0".into()));
    }
    if quantity < 1 {
        return Err(AppError::Invalid("quantity must be at least 1".into()));
    }
    // warframe.market requires `perTrade` (units moved per in-game trade). Default
    // to 1 — safe whether the API treats it as a per-trade min or max — and never
    // let it exceed the listed quantity.
    let per_trade = per_trade.unwrap_or(1).clamp(1, quantity);
    let jwt = require_jwt()?;
    let item_id = catalog::wfm_id_for(&state.db, &slug)?
        .ok_or_else(|| AppError::NotFound(format!("no warframe.market id for {slug}")))?;
    tracing::info!(
        slug,
        item_id,
        platinum,
        quantity,
        per_trade,
        ?rank,
        visible,
        "wfm_create_order"
    );
    state
        .market
        .create_order(
            &jwt, &item_id, "sell", platinum, quantity, per_trade, rank, visible,
        )
        .await
        .inspect_err(|e| tracing::warn!(error = %e, "wfm_create_order failed"))?;
    sync_listings_impl(state.inner()).await
}

/// Edit an existing order's price / quantity / visibility, then re-sync the mirror.
#[tauri::command]
pub async fn wfm_update_order(
    state: State<'_, Arc<AppState>>,
    order_id: String,
    platinum: i64,
    quantity: i64,
    visible: bool,
) -> AppResult<usize> {
    if platinum <= 0 {
        return Err(AppError::Invalid("price must be greater than 0".into()));
    }
    if quantity < 1 {
        return Err(AppError::Invalid("quantity must be at least 1".into()));
    }
    let jwt = require_jwt()?;
    state
        .market
        .update_order(&jwt, &order_id, platinum, quantity, visible)
        .await?;
    sync_listings_impl(state.inner()).await
}

/// Delete an order, then re-sync the mirror.
#[tauri::command]
pub async fn wfm_delete_order(
    state: State<'_, Arc<AppState>>,
    order_id: String,
) -> AppResult<usize> {
    let jwt = require_jwt()?;
    state.market.delete_order(&jwt, &order_id).await?;
    sync_listings_impl(state.inner()).await
}

/// Mark one unit of a listing sold: drop the order's quantity by 1 on
/// warframe.market (deleting it once it hits 0), log a single-unit sale at the
/// listed price so it counts toward plat-earned, decrement owned inventory, then
/// re-sync the mirror. Each press sells one.
#[tauri::command]
pub async fn wfm_mark_sold(state: State<'_, Arc<AppState>>, order_id: String) -> AppResult<usize> {
    let jwt = require_jwt()?;

    // Read the current order from the mirror (price/qty/visibility/slug).
    let (slug, price, qty, visible): (String, Option<i64>, i64, bool) = state.db.with(|c| {
        c.query_row(
            "SELECT slug, your_price, qty, visible FROM market_listings WHERE order_id = ?1",
            rusqlite::params![order_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? != 0)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("no listing for order {order_id}"))
            }
            other => AppError::Sqlite(other),
        })
    })?;

    // Apply the sale to warframe.market: one fewer in stock, or close the order.
    let remaining = qty - 1;
    if remaining >= 1 {
        state
            .market
            .update_order(
                &jwt,
                &order_id,
                price.unwrap_or(1).max(1),
                remaining,
                visible,
            )
            .await?;
    } else {
        state.market.delete_order(&jwt, &order_id).await?;
    }

    // Log it locally at the price it sold for, decrementing inventory.
    let category: Option<String> = state.db.with(|c| {
        Ok(c.query_row(
            "SELECT category FROM catalog_items WHERE slug = ?1",
            rusqlite::params![slug],
            |r| r.get(0),
        )
        .ok())
    })?;
    let members = if category.as_deref() == Some("set") {
        inventory::set_members(&state.db, &slug)?
    } else {
        Vec::new()
    };
    sales::record_sold(&state.db, &slug, price, &members)?;

    sync_listings_impl(state.inner()).await
}

/// Set the account's market presence so orders show active to buyers. warframe.market
/// has no REST status endpoint — presence is held over a WebSocket — so this drives
/// the background presence keeper (`wfm_socket`) rather than making a one-shot call.
#[tauri::command]
pub fn wfm_set_status(state: State<'_, Arc<AppState>>, status: String) -> AppResult<WfmAccount> {
    if !STATUSES.contains(&status.as_str()) {
        return Err(AppError::Invalid(format!("unknown status: {status}")));
    }
    // A session is required to broadcast presence; surface that clearly here.
    require_jwt()?;
    let desired = match status.as_str() {
        "invisible" => crate::wfm_socket::Desired::Offline,
        s => crate::wfm_socket::Desired::Online(s.to_string()),
    };
    state.presence.set(desired);
    wfm::set_status(&state.db, &status)?;
    get_wfm_account(state)
}

/// The lowball-resistant recommended sell price for an item at a given rank.
/// Read-only over the cached robust signals; drives the ListingForm prefill.
#[tauri::command]
pub fn get_recommended_price(
    state: State<'_, Arc<AppState>>,
    slug: String,
    rank: Option<i64>,
) -> AppResult<Option<i64>> {
    state.db.read(|c| prices::fair_sell_price(c, &slug, rank))
}

/// Preview a bulk reprice: every current sell order with its recommended new price.
/// Rows whose item has no price signal are skipped. Does NOT write anything.
#[tauri::command]
pub async fn wfm_reprice_preview(state: State<'_, Arc<AppState>>) -> AppResult<Vec<RepriceRow>> {
    let acct = wfm::get_account(&state.db)?;
    let username = acct
        .username
        .ok_or_else(|| AppError::NotConnected("not connected".into()))?;
    let jwt = wfm_account::load_jwt()?;
    let orders = state
        .market
        .fetch_user_orders(&username, jwt.as_deref())
        .await?;
    let id_to_slug = catalog::id_slug_map(&state.db)?;

    state.db.read(|c| {
        let mut meta = c.prepare(
            "SELECT display_name, part_type, thumbnail_url FROM catalog_items WHERE slug = ?1",
        )?;
        let mut out = Vec::new();
        for o in &orders {
            if o.order_type != "sell" {
                continue;
            }
            let Some(slug) = id_to_slug.get(&o.item_id) else {
                continue;
            };
            let Some(new_price) = prices::fair_sell_price(c, slug, o.rank)? else {
                continue; // no price signal — can't recommend, skip
            };
            let row = meta
                .query_row(rusqlite::params![slug], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                })
                .optional()?;
            let Some((display_name, part_type, thumbnail_url)) = row else {
                continue;
            };
            out.push(RepriceRow {
                order_id: o.id.clone(),
                slug: slug.clone(),
                display_name,
                part_type,
                thumbnail_url,
                qty: o.quantity.unwrap_or(1),
                visible: o.visible,
                current_price: o.platinum,
                new_price,
            });
        }
        out.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        Ok(out)
    })
}

/// Apply user-confirmed reprices: update each order, then re-sync the mirror once.
#[tauri::command]
pub async fn wfm_reprice_apply(
    state: State<'_, Arc<AppState>>,
    orders: Vec<RepriceApply>,
) -> AppResult<usize> {
    let jwt = require_jwt()?;
    let mut n = 0;
    for o in &orders {
        if o.platinum <= 0 || o.quantity < 1 {
            continue;
        }
        state
            .market
            .update_order(&jwt, &o.order_id, o.platinum, o.quantity, o.visible)
            .await
            .inspect_err(|e| tracing::warn!(order = %o.order_id, error = %e, "reprice failed"))?;
        n += 1;
    }
    sync_listings_impl(state.inner()).await?;
    Ok(n)
}

// ===========================================================================
// Set composition (Pass B) — optional background enrichment
// ===========================================================================

/// Fetch set composition for set-tagged items and fill set_membership. Cheap
/// path (~157 calls): only the 'set' category. Throttled by the shared limiter.
#[tauri::command]
pub async fn sets_refresh(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    sets_refresh_inner(&state, |_, _| {}).await
}

/// `on_progress(done, total)` is called after each set is processed, so a caller can
/// surface progress (the set pass is the slow ~157-call step of "Update game data").
async fn sets_refresh_inner(
    state: &Arc<AppState>,
    mut on_progress: impl FnMut(usize, usize),
) -> AppResult<usize> {
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

    let total = set_slugs.len();
    let mut written = 0usize;
    for (i, set_slug) in set_slugs.into_iter().enumerate() {
        on_progress(i, total);
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
    on_progress(total, total);
    Ok(written)
}

// ===========================================================================
// Game inventory import (memory-scan). Opt-in, consent-gated, Linux-only.
// Mirrors the wfm listings preview/apply split. ToS-prohibited / ban-risky —
// see docs/GAME_INVENTORY_IMPORT.md.
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
pub async fn game_scan_preview(state: State<'_, Arc<AppState>>) -> AppResult<Vec<ScanDiffRow>> {
    if !gamescan::is_supported() {
        return Err(AppError::Invalid(
            "game inventory scan is Linux-only".into(),
        ));
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
    let res = gamescan::scan().await?;
    let raw = &res.inventory;
    let map = gamescan_db::game_ref_to_slug(&state.db)?;
    let resolved = gamescan::map::resolve(&raw.items, &map);
    gamescan_db::record_scan(&state.db, raw.account_id.as_deref())?;
    // Same blob also refreshes the Account snapshot (silent — it's a rebuildable cache).
    if let Err(e) = account::store_snapshot(&state.db, &res.account) {
        tracing::warn!(error = %e, "account snapshot store failed during preview");
    }
    gamescan_db::diff(&state.db, &resolved)
}

/// Apply the user-confirmed subset of the diff. The only writer; transactional.
#[tauri::command]
pub fn game_scan_apply(state: State<'_, Arc<AppState>>, rows: Vec<ScanApply>) -> AppResult<usize> {
    if !gamescan_db::is_consented(&state.db)? {
        return Err(AppError::Invalid(
            "game inventory scan requires consent first".into(),
        ));
    }
    gamescan_db::merge_from_scan(&state.db, &rows)
}

/// Scan the running game for owned void relics and import them (source='de_scan').
/// Consent-gated like the item scan; relics are additive (no slug diff), so this
/// imports directly rather than through the item preview/apply split. Returns count.
#[tauri::command]
pub async fn import_scanned_relics(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    if !gamescan::is_supported() {
        return Err(AppError::Invalid(
            "game inventory scan is Linux-only".into(),
        ));
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
    let raw = gamescan::scan().await?.inventory;
    let found = gamescan::map::resolve_relics(&raw.items);
    gamescan_db::record_scan(&state.db, raw.account_id.as_deref())?;
    let tuples: Vec<(&str, &str, &str, i64)> = found
        .iter()
        .map(|r| {
            (
                r.tier.as_str(),
                r.name.as_str(),
                r.refinement.as_str(),
                r.qty,
            )
        })
        .collect();
    relics::apply_scan(&state.db, &tuples)
}

// ===========================================================================
// Account section — scan-populated Profile / Codex / Resources / Arsenal.
// Reads work with the game CLOSED (the snapshot persists); only account_scan
// needs the running client. account_scan is consent + OS gated like the item scan.
// ===========================================================================

/// Full account scan: one fetch, parse the Account snapshot, store it (silent — a
/// rebuildable cache, no review modal), and return the fresh Profile.
#[tauri::command]
pub async fn account_scan(state: State<'_, Arc<AppState>>) -> AppResult<AccountProfile> {
    if !gamescan::is_supported() {
        return Err(AppError::Invalid(
            "game inventory scan is Linux-only".into(),
        ));
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
    let res = gamescan::scan().await?;
    gamescan_db::record_scan(&state.db, res.account.account_id.as_deref())?;
    account::store_snapshot(&state.db, &res.account)?;
    account::get_profile(&state.db)
}

#[tauri::command]
pub fn get_account_profile(state: State<'_, Arc<AppState>>) -> AppResult<AccountProfile> {
    account::get_profile(&state.db)
}

#[tauri::command]
pub fn get_account_arsenal(state: State<'_, Arc<AppState>>) -> AppResult<Vec<GearRow>> {
    account::get_arsenal(&state.db)
}

#[tauri::command]
pub fn get_account_resources(state: State<'_, Arc<AppState>>) -> AppResult<Vec<ResourceRow>> {
    account::get_resources(&state.db)
}

#[tauri::command]
pub fn get_account_codex(state: State<'_, Arc<AppState>>) -> AppResult<CodexData> {
    account::get_codex(&state.db)
}

// ===========================================================================
// Backups
// ===========================================================================

/// `<app_data_dir>/wfit.sqlite` — the one DB location (mirrors lib.rs setup).
fn app_db_path(app: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("resolve app data dir: {e}")))?
        .join("wfit.sqlite"))
}

/// One-click snapshot (VACUUM INTO) into <app_data_dir>/backups, pruned to the
/// newest few. Returns the snapshot path for the toast.
#[tauri::command]
pub fn backup_now(state: State<'_, Arc<AppState>>, app: tauri::AppHandle) -> AppResult<String> {
    let db_path = app_db_path(&app)?;
    let dest = crate::db::backup::snapshot(&state.db, &db_path, None)?;
    tracing::info!(path = %dest.display(), "manual backup saved");
    Ok(dest.display().to_string())
}

/// Backups newest-first. Takes AppHandle (not State) so it also works while the
/// app is in recovery mode.
#[tauri::command]
pub fn list_backups(app: tauri::AppHandle) -> AppResult<Vec<crate::db::backup::BackupInfo>> {
    let db_path = app_db_path(&app)?;
    crate::db::backup::list(&crate::db::backup::backups_dir(&db_path))
}

/// Open the backups folder in the system file manager. Spawned directly (the
/// shell plugin's `open` is deprecated in favor of a whole extra plugin — not
/// worth it for one folder).
#[tauri::command]
pub fn open_backups_dir(app: tauri::AppHandle) -> AppResult<()> {
    let dir = crate::db::backup::backups_dir(&app_db_path(&app)?);
    std::fs::create_dir_all(&dir)?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map_err(|e| AppError::Other(format!("open folder: {e}")))?;
    Ok(())
}

// ===========================================================================
// Recovery — commands that work WITHOUT AppState (startup failed). They take
// AppHandle and gate on RecoveryInfo so the live DB can never be raw-copied
// or renamed out from under the writer in healthy mode.
// ===========================================================================

#[derive(serde::Serialize)]
pub struct StartupStatus {
    pub ok: bool,
    pub error: Option<String>,
    pub db_path: Option<String>,
}

/// Which mode is the app in? The frontend's Boot gate calls this before
/// mounting anything that would invoke a State-backed command.
#[tauri::command]
pub fn startup_status(app: tauri::AppHandle) -> StartupStatus {
    if app.try_state::<Arc<AppState>>().is_some() {
        return StartupStatus {
            ok: true,
            error: None,
            db_path: None,
        };
    }
    match app.try_state::<crate::RecoveryInfo>() {
        Some(r) => StartupStatus {
            ok: false,
            error: Some(r.error.clone()),
            db_path: Some(r.db_path.display().to_string()),
        },
        None => StartupStatus {
            ok: false,
            error: Some("startup state missing (setup did not run?)".into()),
            db_path: None,
        },
    }
}

fn recovery_info(app: &tauri::AppHandle) -> AppResult<tauri::State<'_, crate::RecoveryInfo>> {
    app.try_state::<crate::RecoveryInfo>().ok_or_else(|| {
        AppError::Invalid("recovery actions are only available when startup failed".into())
    })
}

/// Raw file copy of the (unopenable) DB + WAL sidecars into backups/.
#[tauri::command]
pub fn recovery_backup_db(app: tauri::AppHandle) -> AppResult<String> {
    let info = recovery_info(&app)?;
    let dest = crate::db::backup::raw_copy(&info.db_path)?;
    tracing::warn!(path = %dest.display(), "recovery: raw DB backup saved");
    Ok(dest.display().to_string())
}

/// Move the broken DB aside (rename, never delete) and restart into a fresh one.
#[tauri::command]
pub fn recovery_reset_db(app: tauri::AppHandle) -> AppResult<()> {
    let info = recovery_info(&app)?;
    let moved = crate::db::backup::reset_aside(&info.db_path)?;
    tracing::warn!(moved = %moved.display(), "recovery: DB moved aside; restarting");
    app.restart();
}
