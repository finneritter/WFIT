use crate::db::Db;
use crate::domain::partname;
use crate::error::AppResult;
use crate::types::{SetPart, SetRow};
use std::collections::HashMap;

/// Set completion: parts grouped by the derived set_slug heuristic, with
/// per-part required quantities from set_membership (the set pass). A part
/// without a membership row requires 1 — true for everything except the dual
/// weapons (Aksomati Prime needs ×2 barrels/receivers, issue #1). Counts are
/// in UNITS, so "one away" and completion stay honest for ×2 parts.
pub fn list(db: &Db) -> AppResult<Vec<SetRow>> {
    struct PartRow {
        slug: String,
        display_name: String,
        part_type: String,
        category: String,
        set_slug: String,
        median_plat: Option<i64>,
        owned_qty: i64,
    }
    // 1) Every component part that points at a set.
    let parts: Vec<PartRow> = db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT p.slug, p.display_name, p.part_type, p.category, p.set_slug,
                    pc.median_plat, COALESCE(ii.qty, 0)
             FROM catalog_items p
             LEFT JOIN price_cache pc ON pc.slug = p.slug
             LEFT JOIN inventory_items ii ON ii.slug = p.slug
             WHERE p.set_slug IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(PartRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                set_slug: r.get(4)?,
                median_plat: r.get(5)?,
                owned_qty: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })?;

    // 2) The set items themselves (name + full-set value).
    struct SetItem {
        display_name: String,
        median_plat: Option<i64>,
    }
    let set_items: HashMap<String, SetItem> = db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT s.slug, s.display_name, pc.median_plat
             FROM catalog_items s
             LEFT JOIN price_cache pc ON pc.slug = s.slug
             WHERE s.category = 'set'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                SetItem {
                    display_name: r.get(1)?,
                    median_plat: r.get(2)?,
                },
            ))
        })?;
        let mut map = HashMap::new();
        for r in rows {
            let (slug, item) = r?;
            map.insert(slug, item);
        }
        Ok(map)
    })?;

    // 2.5) Per-part required quantities (set pass). Absent row = 1.
    let required: HashMap<(String, String), i64> = db.read(|c| {
        let mut stmt =
            c.prepare("SELECT set_slug, part_slug, quantity_in_set FROM set_membership")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut map = HashMap::new();
        for r in rows {
            let (key, qty) = r?;
            map.insert(key, qty);
        }
        Ok(map)
    })?;

    // 3) Group parts by set_slug and assemble. All counts are units, not
    // distinct part types, so a ×2 part owned once is 1/2 — not complete.
    let mut grouped: HashMap<String, Vec<PartRow>> = HashMap::new();
    for p in parts {
        grouped.entry(p.set_slug.clone()).or_default().push(p);
    }

    let mut out = Vec::new();
    for (set_slug, mut members) in grouped {
        members.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        let category = members
            .first()
            .map(|m| m.category.clone())
            .unwrap_or_else(|| "warframe".into());

        let mut total_parts = 0i64;
        let mut owned_parts = 0i64;
        let mut missing_sum = 0i64;
        let mut parts: Vec<SetPart> = Vec::with_capacity(members.len());
        for m in &members {
            let need = required
                .get(&(set_slug.clone(), m.slug.clone()))
                .copied()
                .unwrap_or(1)
                .max(1);
            let have = m.owned_qty.clamp(0, need);
            total_parts += need;
            owned_parts += have;
            missing_sum += (need - have) * m.median_plat.unwrap_or(0);
            parts.push(SetPart {
                slug: m.slug.clone(),
                part_name: partname::split_name(&m.display_name, &m.part_type).1,
                owned: have >= need,
                owned_qty: m.owned_qty.max(0),
                required: need,
                median_plat: m.median_plat,
            });
        }
        let complete = total_parts > 0 && owned_parts == total_parts;
        let missing_value = if missing_sum > 0 {
            Some(missing_sum)
        } else {
            None
        };

        let set_item = set_items.get(&set_slug);
        let set_name = set_item
            .map(|s| s.display_name.clone())
            .unwrap_or_else(|| prettify_set_slug(&set_slug));
        let set_value = set_item.and_then(|s| s.median_plat);

        out.push(SetRow {
            set_slug,
            set_name,
            category,
            total_parts,
            owned_parts,
            complete,
            parts,
            set_value,
            missing_value,
        });
    }

    // Closest-to-complete first, then by name.
    out.sort_by(|a, b| {
        let ra = a.total_parts - a.owned_parts;
        let rb = b.total_parts - b.owned_parts;
        ra.cmp(&rb).then(a.set_name.cmp(&b.set_name))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::{seed_item, test_db};

    fn own(db: &crate::db::Db, slug: &str, qty: i64) {
        db.with(|c| {
            c.execute(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at)
                 VALUES (?1, ?2, '2026-01-01', '2026-01-01')
                 ON CONFLICT(slug) DO UPDATE SET qty = excluded.qty",
                rusqlite::params![slug, qty],
            )?;
            Ok(())
        })
        .unwrap();
    }

    /// Issue #1: Aksomati Prime needs ×2 barrels — one of each part must NOT
    /// read as complete, and counts / missing value are unit-based.
    #[test]
    fn quantity_in_set_gates_completion() {
        let db = test_db("sets-qty");
        seed_item(&db, "ak_set", "set", Some(100));
        seed_item(&db, "ak_barrel", "weapon", Some(10));
        seed_item(&db, "ak_link", "weapon", Some(5));
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
            Ok(())
        })
        .unwrap();
        own(&db, "ak_barrel", 1);
        own(&db, "ak_link", 1);

        let rows = list(&db).unwrap();
        let row = rows.iter().find(|r| r.set_slug == "ak_set").unwrap();
        assert_eq!((row.total_parts, row.owned_parts), (3, 2));
        assert!(!row.complete, "1 of 2 barrels must not complete the set");
        assert_eq!(row.missing_value, Some(10), "one barrel short");
        let barrel = row.parts.iter().find(|p| p.slug == "ak_barrel").unwrap();
        assert!(!barrel.owned);
        assert_eq!((barrel.owned_qty, barrel.required), (1, 2));

        own(&db, "ak_barrel", 2);
        let rows = list(&db).unwrap();
        assert!(
            rows.iter()
                .find(|r| r.set_slug == "ak_set")
                .unwrap()
                .complete
        );
    }

    /// No membership rows (set pass never ran) → every part requires 1, the
    /// pre-fix behavior.
    #[test]
    fn defaults_to_one_without_membership() {
        let db = test_db("sets-qty-default");
        seed_item(&db, "solo_set", "set", None);
        seed_item(&db, "solo_blade", "weapon", Some(7));
        db.with(|c| {
            c.execute(
                "UPDATE catalog_items SET set_slug = 'solo_set' WHERE slug = 'solo_blade'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        own(&db, "solo_blade", 1);
        let rows = list(&db).unwrap();
        let row = rows.iter().find(|r| r.set_slug == "solo_set").unwrap();
        assert!(row.complete);
        assert_eq!((row.total_parts, row.owned_parts), (1, 1));
    }
}

fn prettify_set_slug(slug: &str) -> String {
    let words = slug
        .trim_end_matches("_set")
        .split('_')
        .map(|w| {
            let mut ch = w.chars();
            match ch.next() {
                Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("{words} Set")
}
