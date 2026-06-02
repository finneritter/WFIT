use crate::db::Db;
use crate::domain::mod_rarity;
use crate::error::AppResult;
use crate::types::CatalogRow;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;

/// A catalog row ready to upsert (Pass A: skeleton + ducats from /v2/items).
#[derive(Debug, Clone)]
pub struct CatalogUpsert {
    pub slug: String,
    pub wfm_id: Option<String>,
    pub display_name: String,
    pub part_type: String,
    pub category: String, // 'warframe'|'weapon'|'set'|'mod'|'arcane'
    pub set_slug: Option<String>,
    pub ducats: Option<i64>,
    pub game_ref: Option<String>, // DE internal `uniqueName` path (joins to game inventory)
    pub max_rank: Option<i64>,    // rank ceiling (mods/arcanes); null for prime parts
    pub is_vaulted: bool,
    pub is_tradeable: bool,
    pub thumbnail_url: Option<String>,
}

pub fn count(db: &Db) -> AppResult<i64> {
    db.with(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM catalog_items", [], |r| r.get(0))?;
        Ok(n)
    })
}

/// Count catalog rows still missing the `game_ref` join key. Non-zero after the
/// 0003 migration until a catalog refetch backfills them (the API supplies it).
pub fn missing_game_ref_count(db: &Db) -> AppResult<i64> {
    db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE game_ref IS NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

/// True once any catalog row carries `max_rank` — i.e. a post-0004 refresh has run.
/// Prime parts legitimately have null max_rank, so we can't check "all"; "any"
/// non-null means the backfill happened. Used to trigger that one-time refetch.
pub fn has_any_max_rank(db: &Db) -> AppResult<bool> {
    db.with(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE max_rank IS NOT NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    })
}

/// Upsert the catalog in one transaction. Preserves existing ducats / thumbnails
/// when a refresh somehow omits them (COALESCE), but always refreshes the rest.
pub fn upsert_many(db: &Db, items: &[CatalogUpsert]) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO catalog_items
                    (slug, wfm_id, display_name, part_type, category, set_slug,
                     ducats, game_ref, max_rank, is_vaulted, is_tradeable, thumbnail_url,
                     mod_rarity, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(slug) DO UPDATE SET
                    wfm_id        = COALESCE(excluded.wfm_id, catalog_items.wfm_id),
                    display_name  = excluded.display_name,
                    part_type     = excluded.part_type,
                    category      = excluded.category,
                    set_slug      = excluded.set_slug,
                    ducats        = COALESCE(excluded.ducats, catalog_items.ducats),
                    game_ref      = COALESCE(excluded.game_ref, catalog_items.game_ref),
                    max_rank      = COALESCE(excluded.max_rank, catalog_items.max_rank),
                    -- is_vaulted is owned by db::vault::apply (warframe-items), not the
                    -- catalog API (which has no vault data) — don't clobber it on refresh.
                    is_tradeable  = excluded.is_tradeable,
                    thumbnail_url = COALESCE(excluded.thumbnail_url, catalog_items.thumbnail_url),
                    mod_rarity    = COALESCE(excluded.mod_rarity, catalog_items.mod_rarity),
                    updated_at    = excluded.updated_at",
            )?;
            for it in items {
                // Mods only: bundled rarity keyed on game_ref (uniqueName).
                let rarity = if it.category == "mod" {
                    it.game_ref.as_deref().and_then(mod_rarity::rarity_for)
                } else {
                    None
                };
                stmt.execute(params![
                    it.slug,
                    it.wfm_id,
                    it.display_name,
                    it.part_type,
                    it.category,
                    it.set_slug,
                    it.ducats,
                    it.game_ref,
                    it.max_rank,
                    it.is_vaulted as i64,
                    it.is_tradeable as i64,
                    it.thumbnail_url,
                    rarity,
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(items.len())
    })
}

/// Current bundled mod-rarity dataset version. Bump alongside
/// `domain/data/mod_rarity.tsv` to force a one-time re-backfill on next launch.
const MOD_RARITY_VER: &str = "1";

/// Populate `catalog_items.mod_rarity` for existing mods from the bundled map
/// (keyed on game_ref). Runs once per dataset version — the ongoing upsert keeps
/// new mods current, this just fills rows that predate the column. Idempotent.
pub fn backfill_mod_rarity(db: &Db) -> AppResult<usize> {
    use crate::db::settings;
    if settings::get(db, settings::KEY_MOD_RARITY_VER)?.as_deref() == Some(MOD_RARITY_VER) {
        return Ok(0);
    }
    let n = db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let pairs: Vec<(String, String)> = {
            let mut stmt = tx.prepare(
                "SELECT slug, game_ref FROM catalog_items
                 WHERE category = 'mod' AND game_ref IS NOT NULL",
            )?;
            let rows =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut updated = 0usize;
        for (slug, game_ref) in &pairs {
            if let Some(rarity) = mod_rarity::rarity_for(game_ref) {
                tx.execute(
                    "UPDATE catalog_items SET mod_rarity = ?1 WHERE slug = ?2",
                    params![rarity, slug],
                )?;
                updated += 1;
            }
        }
        tx.commit()?;
        Ok(updated)
    })?;
    settings::set(db, settings::KEY_MOD_RARITY_VER, MOD_RARITY_VER)?;
    Ok(n)
}

/// Build the warframe.market id -> slug map (for resolving setParts ids in Pass B).
pub fn id_slug_map(db: &Db) -> AppResult<HashMap<String, String>> {
    db.with(|c| {
        let mut stmt =
            c.prepare("SELECT wfm_id, slug FROM catalog_items WHERE wfm_id IS NOT NULL")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = HashMap::new();
        for r in rows {
            let (id, slug) = r?;
            map.insert(id, slug);
        }
        Ok(map)
    })
}

const CATALOG_SELECT: &str = "SELECT
        ci.slug, ci.display_name, ci.part_type, ci.category, ci.set_slug,
        ci.ducats, ci.is_vaulted, pc.median_plat, pc.trend, pc.delta_7d,
        ci.thumbnail_url,
        CASE WHEN ci.category = 'set' THEN (
            SELECT COALESCE(MIN(COALESCE(mi.qty, 0)), 0)
            FROM catalog_items m
            LEFT JOIN inventory_items mi ON mi.slug = m.slug
            WHERE m.set_slug = ci.slug
        ) ELSE COALESCE(ii.qty, 0) END AS owned_qty,
        CASE WHEN w.slug IS NOT NULL THEN 1 ELSE 0 END AS on_watchlist,
        COALESCE(bl.buy_qty, 0) AS buy_qty
     FROM catalog_items ci
     LEFT JOIN price_cache pc ON pc.slug = ci.slug
     LEFT JOIN inventory_items ii ON ii.slug = ci.slug
     LEFT JOIN watchlist w ON w.slug = ci.slug
     LEFT JOIN buy_list bl ON bl.slug = ci.slug";

fn map_catalog_row(r: &rusqlite::Row) -> rusqlite::Result<CatalogRow> {
    Ok(CatalogRow {
        slug: r.get(0)?,
        display_name: r.get(1)?,
        part_type: r.get(2)?,
        category: r.get(3)?,
        set_slug: r.get(4)?,
        ducats: r.get(5)?,
        is_vaulted: r.get::<_, i64>(6)? != 0,
        median_plat: r.get(7)?,
        trend: r.get(8)?,
        delta_7d: r.get(9)?,
        thumbnail_url: r.get(10)?,
        owned_qty: r.get(11)?,
        on_watchlist: r.get::<_, i64>(12)? != 0,
        buy_qty: r.get(13)?,
    })
}

/// List the catalog, optionally filtered to one category. Used by the Add Items modal.
pub fn list(db: &Db, category: Option<&str>) -> AppResult<Vec<CatalogRow>> {
    db.with(|c| {
        let mut out = Vec::new();
        match category {
            Some(cat) => {
                let sql =
                    format!("{CATALOG_SELECT} WHERE ci.category = ?1 ORDER BY ci.display_name ASC");
                let mut stmt = c.prepare(&sql)?;
                let rows = stmt.query_map(params![cat], map_catalog_row)?;
                for r in rows {
                    out.push(r?);
                }
            }
            None => {
                let sql = format!("{CATALOG_SELECT} ORDER BY ci.display_name ASC");
                let mut stmt = c.prepare(&sql)?;
                let rows = stmt.query_map([], map_catalog_row)?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    })
}

/// Search the catalog by display name (case-insensitive substring).
pub fn search(db: &Db, q: &str, limit: i64) -> AppResult<Vec<CatalogRow>> {
    db.with(|c| {
        let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
        let sql = format!(
            "{CATALOG_SELECT} WHERE ci.display_name LIKE ?1 ESCAPE '\\'
             ORDER BY ci.display_name ASC LIMIT ?2"
        );
        let mut stmt = c.prepare(&sql)?;
        let rows = stmt.query_map(params![like, limit], map_catalog_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// One catalog row by slug (for the Drawer when an item isn't owned).
pub fn get(db: &Db, slug: &str) -> AppResult<Option<CatalogRow>> {
    db.with(|c| {
        let sql = format!("{CATALOG_SELECT} WHERE ci.slug = ?1");
        let row = c.query_row(&sql, params![slug], map_catalog_row).ok();
        Ok(row)
    })
}
