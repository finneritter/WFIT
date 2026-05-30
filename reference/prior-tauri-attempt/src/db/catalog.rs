use crate::db::Db;
use crate::error::AppResult;
use rusqlite::params;

#[derive(Debug, Clone)]
pub struct CatalogUpsert {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub set_slug: Option<String>,
    pub ducats: Option<i64>,
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

pub fn upsert_many(db: &Db, items: &[CatalogUpsert]) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO catalog_items
                    (slug, display_name, part_type, set_slug, ducats, is_vaulted, is_tradeable, thumbnail_url)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(slug) DO UPDATE SET
                    display_name = excluded.display_name,
                    part_type    = excluded.part_type,
                    set_slug     = excluded.set_slug,
                    ducats       = COALESCE(excluded.ducats, catalog_items.ducats),
                    is_vaulted   = excluded.is_vaulted,
                    is_tradeable = excluded.is_tradeable,
                    thumbnail_url = COALESCE(excluded.thumbnail_url, catalog_items.thumbnail_url)",
            )?;
            for it in items {
                stmt.execute(params![
                    it.slug,
                    it.display_name,
                    it.part_type,
                    it.set_slug,
                    it.ducats,
                    it.is_vaulted as i64,
                    it.is_tradeable as i64,
                    it.thumbnail_url,
                ])?;
            }
        }
        tx.commit()?;
        Ok(items.len())
    })
}
