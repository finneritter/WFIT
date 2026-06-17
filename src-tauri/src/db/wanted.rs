//! The user's "wanted" item set: everything on the watchlist, plus the missing
//! parts of sets they've already started (own ≥1 part, missing this one). Shared by
//! wanted-now reward matching (F3) and relic crack-now (F1).

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

/// Slugs the Rotation "Crack" tab treats as wanted: everything on the **watchlist**
/// or **buy list**, plus the missing parts of any set you're **close to completing**
/// (own ≥1 part and the whole set is missing ≤ [`SET_CLOSE_THRESHOLD`] parts). Stricter
/// than [`wanted_items`] on sets (near-complete only) but broader on lists (adds the
/// buy list) — a relic only earns a spot on the Crack tab if a drop lands in here.
pub fn crack_targets(db: &Db) -> AppResult<HashSet<String>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT slug FROM watchlist
             UNION
             SELECT slug FROM buy_list
             UNION
             SELECT ci.slug
               FROM catalog_items ci
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
                ) <= ?1",
        )?;
        let rows = stmt.query_map([SET_CLOSE_THRESHOLD], |r| r.get::<_, String>(0))?;
        let mut out = HashSet::new();
        for r in rows {
            out.insert(r?);
        }
        Ok(out)
    })
}

/// A set is "close to completing" when it's missing at most this many parts — so a
/// relic dropping one of those missing parts would finish (or nearly finish) it.
const SET_CLOSE_THRESHOLD: i64 = 2;

/// The crack signals split by source, so the Relics "To crack" planner can flag and
/// score each independently (a relic completing a near-set should outrank a
/// watch-list-only one). `crack_targets` is the union of these two; this is the same
/// data, kept separate. The vaulted signal is sourced elsewhere (catalog `is_vaulted`).
pub struct CrackSignals {
    /// Slugs on the watchlist or buy list.
    pub watch_buy: HashSet<String>,
    /// Missing parts of sets you're within [`SET_CLOSE_THRESHOLD`] parts of completing.
    pub near_set: HashSet<String>,
}

/// Build [`CrackSignals`] — watch/buy list and near-complete-set missing parts as
/// separate sets (reuses the same SQL shape as [`crack_targets`]).
pub fn crack_signals(db: &Db) -> AppResult<CrackSignals> {
    db.read(|c| {
        let mut wb = c.prepare("SELECT slug FROM watchlist UNION SELECT slug FROM buy_list")?;
        let watch_buy = wb
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        let mut ns = c.prepare(
            "SELECT ci.slug
               FROM catalog_items ci
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
                ) <= ?1",
        )?;
        let near_set = ns
            .query_map([SET_CLOSE_THRESHOLD], |r| r.get::<_, String>(0))?
            .collect::<Result<HashSet<_>, _>>()?;
        Ok(CrackSignals {
            watch_buy,
            near_set,
        })
    })
}
