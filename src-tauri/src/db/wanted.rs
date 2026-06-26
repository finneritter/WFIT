//! The user's "wanted" item set: everything on the watchlist, plus the missing
//! parts of sets they've already started (own ≥1 part, missing this one). Powers
//! wanted-now reward matching (F3) and the Relics "To crack" planner.

use crate::db::Db;
use crate::error::AppResult;
use std::collections::HashSet;

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

/// Crack signals for the Relics "To crack" planner, split by source so each can be
/// flagged/scored independently. The vaulted signal is sourced elsewhere (`relic::is_vaulted`).
pub struct CrackSignals {
    /// Slugs on the watchlist or buy list.
    pub watch_buy: HashSet<String>,
    /// Missing part slug → (set slug, set display name) for sets you're **exactly one
    /// part** away from completing — a relic dropping that part would finish the set.
    pub one_away: std::collections::HashMap<String, (String, String)>,
}

/// Build [`CrackSignals`] — the watch/buy list, and the missing part of every set you're
/// exactly one part from completing (with the set's slug + name for a backlink).
pub fn crack_signals(db: &Db) -> AppResult<CrackSignals> {
    db.read(|c| {
        let mut wb = c.prepare("SELECT slug FROM watchlist UNION SELECT slug FROM buy_list")?;
        let watch_buy = wb
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        let mut ns = c.prepare(
            "SELECT ci.slug, ci.set_slug, COALESCE(s.display_name, ci.set_slug)
               FROM catalog_items ci
               LEFT JOIN catalog_items s ON s.slug = ci.set_slug AND s.category = 'set'
              WHERE ci.set_slug IS NOT NULL
                AND COALESCE((SELECT qty FROM inventory_items ii WHERE ii.slug = ci.slug), 0) = 0
                AND EXISTS (
                    SELECT 1 FROM catalog_items m
                    JOIN inventory_items mi ON mi.slug = m.slug
                    WHERE m.set_slug = ci.set_slug AND mi.qty > 0
                )
                AND (
                    SELECT COUNT(*) FROM catalog_items m2
                     WHERE m2.set_slug = ci.set_slug
                       AND COALESCE(
                             (SELECT qty FROM inventory_items mi2 WHERE mi2.slug = m2.slug), 0) = 0
                ) = 1",
        )?;
        let one_away = ns
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
                ))
            })?
            .collect::<Result<std::collections::HashMap<_, _>, _>>()?;
        Ok(CrackSignals {
            watch_buy,
            one_away,
        })
    })
}
