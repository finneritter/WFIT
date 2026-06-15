//! The user's "wanted" item set: everything on the watchlist, plus the missing
//! parts of sets they've already started (own ≥1 part, missing this one). Shared by
//! wanted-now reward matching (F3) and relic crack-now (F1).

use crate::db::Db;
use crate::error::AppResult;

/// (slug, display_name) for every wanted item. A slug on the watchlist that is also
/// a missing set part appears once (the UNION dedupes identical rows).
pub fn wanted_items(db: &Db) -> AppResult<Vec<(String, String)>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT ci.slug, ci.display_name
               FROM watchlist w JOIN catalog_items ci ON ci.slug = w.slug
             UNION
             SELECT ci.slug, ci.display_name
               FROM catalog_items ci
              WHERE ci.set_slug IS NOT NULL
                AND COALESCE((SELECT qty FROM inventory_items ii WHERE ii.slug = ci.slug), 0) = 0
                AND EXISTS (
                    SELECT 1 FROM catalog_items m
                    JOIN inventory_items mi ON mi.slug = m.slug
                    WHERE m.set_slug = ci.set_slug AND mi.qty > 0
                )",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}
