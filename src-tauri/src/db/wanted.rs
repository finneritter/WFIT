//! The user's "wanted" item set: everything on the watchlist, plus the missing
//! parts of sets they've already started (own ≥1 part, short on this one —
//! quantity_in_set-aware, so 1 of 2 barrels still counts as missing). Powers
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
                AND COALESCE((SELECT qty FROM inventory_items ii WHERE ii.slug = ci.slug), 0)
                    < COALESCE((SELECT quantity_in_set FROM set_membership sm
                                 WHERE sm.set_slug = ci.set_slug AND sm.part_slug = ci.slug), 1)
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
        // "One away" is unit-based: the set's total shortfall (per-part required
        // minus owned, quantity_in_set-aware) is exactly 1 — owning 0 of a ×2
        // barrel is NOT one away even if it's the only missing part type.
        let mut ns = c.prepare(
            "SELECT ci.slug, ci.set_slug, COALESCE(s.display_name, ci.set_slug)
               FROM catalog_items ci
               LEFT JOIN catalog_items s ON s.slug = ci.set_slug AND s.category = 'set'
              WHERE ci.set_slug IS NOT NULL
                AND COALESCE((SELECT qty FROM inventory_items ii WHERE ii.slug = ci.slug), 0)
                    < COALESCE((SELECT quantity_in_set FROM set_membership sm
                                 WHERE sm.set_slug = ci.set_slug AND sm.part_slug = ci.slug), 1)
                AND EXISTS (
                    SELECT 1 FROM catalog_items m
                    JOIN inventory_items mi ON mi.slug = m.slug
                    WHERE m.set_slug = ci.set_slug AND mi.qty > 0
                )
                AND (
                    SELECT COALESCE(SUM(MAX(
                             COALESCE(sm2.quantity_in_set, 1)
                             - COALESCE(
                                 (SELECT qty FROM inventory_items mi2 WHERE mi2.slug = m2.slug), 0),
                             0)), 0)
                      FROM catalog_items m2
                      LEFT JOIN set_membership sm2
                             ON sm2.set_slug = m2.set_slug AND sm2.part_slug = m2.slug
                     WHERE m2.set_slug = ci.set_slug
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::{seed_item, test_db};

    /// Quantity-aware wanted/one-away (issue #1): 1 of 2 barrels is still
    /// wanted, and "one away" means one UNIT short, not one part type.
    #[test]
    fn shortfall_is_quantity_aware() {
        let db = test_db("wanted-qty");
        seed_item(&db, "ak_set", "set", None);
        seed_item(&db, "ak_barrel", "weapon", None);
        seed_item(&db, "ak_link", "weapon", None);
        db.with(|c| {
            c.execute(
                "UPDATE catalog_items SET set_slug = 'ak_set'
                  WHERE slug IN ('ak_barrel', 'ak_link')",
                [],
            )?;
            c.execute(
                "INSERT INTO set_membership (set_slug, part_slug, quantity_in_set)
                 VALUES ('ak_set', 'ak_barrel', 2), ('ak_set', 'ak_link', 1)",
                [],
            )?;
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
                 VALUES ('ak_barrel', 1, '2026-01-01', '2026-01-01'),
                        ('ak_link', 1, '2026-01-01', '2026-01-01')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Own 1/2 barrels + the link: barrel is still wanted, and the set is
        // exactly one unit away.
        let wanted = wanted_items(&db).unwrap();
        assert!(wanted.iter().any(|(s, _)| s == "ak_barrel"));
        assert!(!wanted.iter().any(|(s, _)| s == "ak_link"));
        let signals = crack_signals(&db).unwrap();
        assert!(signals.one_away.contains_key("ak_barrel"));

        // Own 0/2 barrels: still wanted, but two units short — NOT one away.
        db.with(|c| {
            c.execute(
                "UPDATE inventory_items SET qty = 0 WHERE slug = 'ak_barrel'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        let wanted = wanted_items(&db).unwrap();
        assert!(wanted.iter().any(|(s, _)| s == "ak_barrel"));
        let signals = crack_signals(&db).unwrap();
        assert!(!signals.one_away.contains_key("ak_barrel"));
    }
}
