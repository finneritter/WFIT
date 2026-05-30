use crate::db::{catalog, inventory, meta, prices, sales};
use crate::error::AppResult;
use crate::types::{InventoryRow, SaleRow, Summary};
use crate::AppState;
use chrono::{Duration, Utc};
use std::sync::Arc;
use tauri::State;

const PRICE_TTL_HOURS: i64 = 6;

#[tauri::command]
pub fn catalog_count(state: State<'_, Arc<AppState>>) -> AppResult<i64> {
    catalog::count(&state.db)
}

#[tauri::command]
pub async fn catalog_refresh(state: State<'_, Arc<AppState>>) -> AppResult<usize> {
    tracing::info!("catalog_refresh: fetching warframe.market /items");
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

#[tauri::command]
pub fn inventory_add(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: Option<i64>,
) -> AppResult<i64> {
    let qty = qty.unwrap_or(1);
    inventory::add(&state.db, &slug, qty)
}

#[tauri::command]
pub fn inventory_set_qty(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: i64,
) -> AppResult<i64> {
    inventory::set_qty(&state.db, &slug, qty)
}

#[tauri::command]
pub fn inventory_remove(state: State<'_, Arc<AppState>>, slug: String) -> AppResult<()> {
    inventory::remove(&state.db, &slug)
}

#[tauri::command]
pub fn inventory_list(state: State<'_, Arc<AppState>>) -> AppResult<Vec<InventoryRow>> {
    inventory::list_ranked(&state.db)
}

#[tauri::command]
pub fn sale_record(
    state: State<'_, Arc<AppState>>,
    slug: String,
    qty: Option<i64>,
    plat_per_unit: Option<i64>,
    notes: Option<String>,
) -> AppResult<i64> {
    sales::record(
        &state.db,
        sales::SaleRecord {
            slug,
            qty: qty.unwrap_or(1),
            plat_per_unit,
            notes,
        },
    )
}

#[tauri::command]
pub fn sale_list(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> AppResult<Vec<SaleRow>> {
    sales::list_recent(&state.db, limit.unwrap_or(200))
}

#[tauri::command]
pub async fn prices_refresh(
    state: State<'_, Arc<AppState>>,
    force: Option<bool>,
) -> AppResult<usize> {
    let slugs = if force.unwrap_or(false) {
        // refresh every inventory slug regardless of TTL
        state
            .db
            .with(|c| {
                let mut stmt = c.prepare("SELECT slug FROM inventory_items WHERE qty > 0")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                let mut out = Vec::new();
                for r in rows {
                    out.push(r?);
                }
                Ok(out)
            })?
    } else {
        prices::stale_slugs(&state.db)?
    };

    let mut updates = Vec::with_capacity(slugs.len());
    for slug in &slugs {
        match state.market.fetch_price(slug).await {
            Ok(Some(p)) => updates.push(p),
            Ok(None) => tracing::debug!(slug, "no stats"),
            Err(e) => tracing::warn!(slug, error = %e, "fetch_price failed"),
        }
    }
    let n = if !updates.is_empty() {
        prices::upsert_many(&state.db, &updates, Duration::hours(PRICE_TTL_HOURS))?
    } else {
        0
    };
    meta::set(
        &state.db,
        meta::KEY_LAST_PRICE_SYNC,
        &Utc::now().to_rfc3339(),
    )?;
    Ok(n)
}

#[tauri::command]
pub fn summary(state: State<'_, Arc<AppState>>) -> AppResult<Summary> {
    state.db.with(|c| {
        let total_plat: i64 = c
            .query_row(
                "SELECT COALESCE(SUM(COALESCE(pc.median_plat, 0) * ii.qty), 0)
                 FROM inventory_items ii
                 LEFT JOIN price_cache pc ON pc.slug = ii.slug
                 WHERE ii.qty > 0",
                [],
                |r| r.get(0),
            )?;
        let prime_part_count: i64 = c
            .query_row(
                "SELECT COALESCE(SUM(ii.qty), 0)
                 FROM inventory_items ii
                 JOIN catalog_items ci ON ci.slug = ii.slug
                 WHERE ii.qty > 0 AND ci.part_type != 'Set'",
                [],
                |r| r.get(0),
            )?;
        let total_ducats: i64 = c
            .query_row(
                "SELECT COALESCE(SUM(COALESCE(ci.ducats, 0) * ii.qty), 0)
                 FROM inventory_items ii
                 JOIN catalog_items ci ON ci.slug = ii.slug
                 WHERE ii.qty > 0",
                [],
                |r| r.get(0),
            )?;
        // Full-set count: a set is complete when all parts sharing the set_slug have qty >= 1.
        // Approximation: count distinct set_slug values where every part of that set is owned with qty >= 1.
        let full_set_count: i64 = c.query_row(
            "WITH set_parts AS (
                SELECT ci.set_slug AS sslug,
                       COUNT(*) AS total_parts,
                       SUM(CASE WHEN ii.qty IS NOT NULL AND ii.qty >= 1 THEN 1 ELSE 0 END) AS owned_parts
                FROM catalog_items ci
                LEFT JOIN inventory_items ii ON ii.slug = ci.slug
                WHERE ci.set_slug IS NOT NULL
                GROUP BY ci.set_slug
            )
            SELECT COUNT(*) FROM set_parts WHERE total_parts > 0 AND owned_parts = total_parts",
            [],
            |r| r.get(0),
        )?;

        let last_synced: Option<String> = c
            .query_row(
                "SELECT value FROM app_meta WHERE key = ?1",
                rusqlite::params![meta::KEY_LAST_PRICE_SYNC],
                |r| r.get(0),
            )
            .ok();

        Ok(Summary {
            total_plat,
            prime_part_count,
            full_set_count,
            total_ducats,
            last_synced,
        })
    })
}
