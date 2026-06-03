mod commands;
mod db;
mod domain;
mod error;
mod gamescan;
mod market;
mod types;
mod wfm_account;
mod worldstate;

use chrono::{DateTime, Duration, Utc};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: db::Db,
    pub market: market::Market,
    pub worldstate: worldstate::WorldstateClient,
    /// True for the whole launch warm-up (catalog → vault → owned → drain), so the UI
    /// can show a "syncing…" indicator the entire time prices are still filling in —
    /// distinguishing "still loading" from a settled value (incl. a fresh post-wipe sync).
    pub pricing_active: AtomicBool,
}

const CATALOG_STALE_HOURS: i64 = 24;
const PRICE_TTL_HOURS: i64 = 6;
const DRAIN_BATCH: i64 = 40;
// Bump whenever the price-derivation logic changes. On launch a mismatch wipes the
// derived price caches and recomputes them, so fixes take effect without a manual
// "rebuild cache" and stale old-logic prices can't survive behind the TTL.
const PRICING_VERSION: &str = "3";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,wfit_lib=debug")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("create app data dir");
            let db_path = app_data_dir.join("wfit.sqlite");
            tracing::info!(?db_path, "opening database");

            let db = db::Db::open(&db_path).expect("open db");
            let state = Arc::new(AppState {
                db,
                market: market::Market::new(),
                worldstate: worldstate::WorldstateClient::new(),
                pricing_active: AtomicBool::new(false),
            });
            app.manage(state.clone());

            // Kick off catalog/price warm-up off the UI thread; never block launch.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = launch_refresh(state).await {
                    tracing::warn!(error = %e, "launch refresh failed");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // catalog
            commands::catalog_count,
            commands::catalog_refresh,
            commands::get_catalog,
            commands::search_catalog,
            // inventory
            commands::get_inventory,
            commands::add_to_inventory,
            commands::set_qty,
            commands::remove_item,
            commands::get_summary,
            // sales
            commands::record_sale,
            commands::undo_sale,
            commands::get_sales,
            // watchlist
            commands::get_watchlist,
            commands::add_watch,
            commands::remove_watch,
            commands::set_target,
            // buy list
            commands::get_buy_list,
            commands::add_to_buy_list,
            commands::set_buy_qty,
            commands::remove_buy,
            commands::purchase_buy,
            commands::get_budget,
            commands::set_budget,
            commands::get_excluded_rarities,
            commands::set_excluded_rarities,
            commands::get_excluded_min_plat,
            commands::set_excluded_min_plat,
            commands::get_excluded_min_plat_by_cat,
            commands::set_excluded_min_plat_by_cat,
            commands::get_pricing_progress,
            // computed
            commands::get_sets,
            commands::get_ducats,
            commands::get_arcane_dashboard,
            commands::get_trends,
            // prices / detail
            commands::prices_refresh,
            commands::get_item_detail,
            commands::get_item_history,
            commands::get_item_orders,
            commands::rebuild_cache,
            commands::wipe_app,
            // worldstate
            commands::get_worldstate,
            // wfm account
            commands::get_wfm_account,
            commands::wfm_connect,
            commands::wfm_set_session,
            commands::wfm_signout,
            commands::wfm_sync_listings,
            commands::wfm_get_listings,
            commands::wfm_fetch_listings,
            commands::wfm_apply_import,
            // set composition (Pass B)
            commands::sets_refresh,
            // game inventory import (memory-scan)
            commands::game_scan_status,
            commands::game_scan_consent,
            commands::game_scan_revoke,
            commands::game_scan_preview,
            commands::game_scan_apply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// RAII flag for the "syncing…" indicator: marks `pricing_active` true for its
/// lifetime and false on drop, so the flag clears on every exit path of the warm-up
/// (normal completion or an early error) and can never get stuck on.
struct PricingGuard<'a>(&'a AtomicBool);
impl<'a> PricingGuard<'a> {
    fn new(b: &'a AtomicBool) -> Self {
        b.store(true, Ordering::Relaxed);
        Self(b)
    }
}
impl Drop for PricingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

/// On launch: refresh the catalog if empty/stale, prime owned + watchlist prices,
/// then drain the rest in the background at the throttled rate. UI never blocks
/// and the 350 ms global limit is never exceeded.
async fn launch_refresh(state: Arc<AppState>) -> error::AppResult<()> {
    use db::{catalog, meta, prices, vault};

    // Hold the "syncing…" flag for the entire warm-up (catalog → vault → owned →
    // drain) so the UI shows progress the whole time; the guard resets it on any exit.
    let _active = PricingGuard::new(&state.pricing_active);

    // 0) If the pricing logic changed since these caches were built, wipe the
    // DERIVED price caches (not raw history) so everything re-derives below with
    // the current logic. Owned prices repopulate first, the rest via the drain.
    if meta::get(&state.db, meta::KEY_PRICING_VERSION)?.as_deref() != Some(PRICING_VERSION) {
        tracing::info!("pricing logic changed → clearing price caches for a clean reprice");
        state.db.with(|c| {
            c.execute_batch(
                "DELETE FROM price_cache; DELETE FROM price_rank; DELETE FROM order_cache; DELETE FROM buy_orders;",
            )?;
            Ok(())
        })?;
        meta::set(&state.db, meta::KEY_PRICING_VERSION, PRICING_VERSION)?;
    }

    // 0.5) Backfill mod rarity into existing catalog rows from the bundled dataset
    // (no network; version-gated so it runs once). New mods get it via the upsert.
    let filled = catalog::backfill_mod_rarity(&state.db)?;
    if filled > 0 {
        tracing::info!(n = filled, "backfilled mod rarity");
    }

    // 1) Catalog skeleton (1 call) if empty or older than the stale window.
    let need_catalog = {
        let count = catalog::count(&state.db)?;
        if count == 0 {
            true
        } else if catalog::missing_game_ref_count(&state.db)? > 0 {
            // 0003 added game_ref; existing rows are NULL until one refetch backfills
            // them from /v2/items `gameRef`. Needed for the game-inventory mapping.
            true
        } else if !catalog::has_any_max_rank(&state.db)? {
            // 0004 added max_rank; one refetch backfills it from /v2/items `maxRank`
            // (needed for rank-aware mod/arcane valuation + the drawer breakdown).
            true
        } else {
            match meta::get(&state.db, meta::KEY_LAST_CATALOG_SYNC)? {
                Some(ts) => DateTime::parse_from_rfc3339(&ts)
                    .map(|t| Utc::now().signed_duration_since(t.with_timezone(&Utc)))
                    .map(|age| age > Duration::hours(CATALOG_STALE_HOURS))
                    .unwrap_or(true),
                None => true,
            }
        }
    };
    if need_catalog {
        tracing::info!("launch: refreshing catalog");
        let items = state.market.fetch_catalog().await?;
        catalog::upsert_many(&state.db, &items)?;
        meta::set(
            &state.db,
            meta::KEY_LAST_CATALOG_SYNC,
            &Utc::now().to_rfc3339(),
        )?;
    }

    // 1.5) Vault status from warframe-items (own host; TTL-gated ~monthly, bundled
    // fallback). Runs after the catalog so the set→parts propagation has rows to mark.
    if let Err(e) = vault::refresh_if_stale(&state.db).await {
        tracing::warn!(error = %e, "vault status refresh failed");
    }

    // 2+3) Owned (then watchlist) pricing — the phase the inventory value depends on.
    // pricing_active is held for the WHOLE warm-up by the guard at the top of this fn,
    // so the "syncing…" indicator stays up through the background drain below too.
    // Owned orders go first (primary price), then the slower statistics pass.
    refresh_owned_orders(&state, false).await?;
    let mut priority = prices::stale_inventory_slugs(&state.db)?;
    for s in prices::stale_watchlist_slugs(&state.db)? {
        if !priority.contains(&s) {
            priority.push(s);
        }
    }
    refresh_slugs(&state, &priority).await?;
    if !priority.is_empty() {
        meta::set(
            &state.db,
            meta::KEY_LAST_PRICE_SYNC,
            &Utc::now().to_rfc3339(),
        )?;
    }

    // 4) Background drain of everything else, oldest-first, batch by batch.
    loop {
        let batch = prices::stale_catalog_slugs(&state.db, DRAIN_BATCH)?;
        if batch.is_empty() {
            break;
        }
        refresh_slugs(&state, &batch).await?;
        meta::set(
            &state.db,
            meta::KEY_LAST_PRICE_SYNC,
            &Utc::now().to_rfc3339(),
        )?;
    }
    tracing::info!("launch: price drain complete");
    Ok(())
}

/// Fetch + persist statistics for each slug (throttled inside the client).
async fn refresh_slugs(state: &Arc<AppState>, slugs: &[String]) -> error::AppResult<()> {
    use db::prices;
    let mut updates = Vec::new();
    for slug in slugs {
        match state.market.fetch_statistics(slug).await {
            Ok(Some(p)) => updates.push(p),
            Ok(None) => {}
            Err(e) => tracing::warn!(slug, error = %e, "fetch_statistics failed"),
        }
        // Persist in small chunks so progress survives and the UI sees data early.
        if updates.len() >= 20 {
            prices::upsert_many(&state.db, &updates, Duration::hours(PRICE_TTL_HOURS))?;
            updates.clear();
        }
    }
    if !updates.is_empty() {
        prices::upsert_many(&state.db, &updates, Duration::hours(PRICE_TTL_HOURS))?;
    }
    Ok(())
}

/// Fetch + store live lowest-sell prices for illiquid owned items, so their value
/// tracks real asks instead of sparse/gameable trade statistics. Throttled inside
/// the market client. Bounded to the (usually small) illiquid-owned subset.
pub(crate) async fn refresh_owned_orders(
    state: &Arc<AppState>,
    force: bool,
) -> error::AppResult<()> {
    use db::prices;
    // force → cutoff = now (nothing is fresher, so refetch all); else skip orders
    // refreshed within the price TTL.
    let cutoff = if force {
        Utc::now().to_rfc3339()
    } else {
        (Utc::now() - Duration::hours(PRICE_TTL_HOURS)).to_rfc3339()
    };
    let slugs = prices::owned_order_slugs(&state.db, &cutoff)?;
    if slugs.is_empty() {
        return Ok(());
    }
    tracing::info!(
        n = slugs.len(),
        "refreshing live sell orders for owned items"
    );
    let mut priced = 0usize;
    for slug in &slugs {
        match state.market.fetch_order_book(slug).await {
            Ok(book) if !book.sells.is_empty() || !book.bids.is_empty() => {
                prices::store_order_book(&state.db, slug, &book.sells, &book.bids)?;
                priced += 1;
            }
            Ok(_) => {}
            Err(e) => tracing::warn!(slug, error = %e, "fetch_order_book failed"),
        }
    }
    tracing::info!(priced, of = slugs.len(), "live sell orders refreshed");
    Ok(())
}
