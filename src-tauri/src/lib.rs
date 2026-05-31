mod commands;
mod db;
mod domain;
mod error;
mod market;
mod types;
mod wfm_account;
mod worldstate;

use chrono::{DateTime, Duration, Utc};
use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: db::Db,
    pub market: market::Market,
    pub worldstate: worldstate::WorldstateClient,
}

const CATALOG_STALE_HOURS: i64 = 24;
const PRICE_TTL_HOURS: i64 = 6;
const DRAIN_BATCH: i64 = 40;

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
            // computed
            commands::get_sets,
            commands::get_ducats,
            commands::get_trends,
            // prices / detail
            commands::prices_refresh,
            commands::get_item_detail,
            commands::get_item_history,
            commands::get_item_orders,
            commands::rebuild_cache,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// On launch: refresh the catalog if empty/stale, prime owned + watchlist prices,
/// then drain the rest in the background at the throttled rate. UI never blocks
/// and the 350 ms global limit is never exceeded.
async fn launch_refresh(state: Arc<AppState>) -> error::AppResult<()> {
    use db::{catalog, meta, prices};

    // 1) Catalog skeleton (1 call) if empty or older than the stale window.
    let need_catalog = {
        let count = catalog::count(&state.db)?;
        if count == 0 {
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

    // 2) Foreground-priority prices: owned, then watchlist.
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

    // 3) Background drain of everything else, oldest-first, batch by batch.
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
