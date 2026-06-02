use crate::db::Db;
use crate::domain::partname;
use crate::error::AppResult;
use crate::types::{SetPart, SetRow};
use std::collections::HashMap;

/// Set completion via the set_slug heuristic (quantity_in_set assumed 1). When
/// Pass B fills set_membership this can be swapped for authoritative membership;
/// for v1 grouping catalog parts by their derived set_slug is sufficient.
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

    // 3) Group parts by set_slug and assemble.
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
        let total_parts = members.len() as i64;
        let owned_parts = members.iter().filter(|m| m.owned_qty >= 1).count() as i64;
        let complete = total_parts > 0 && owned_parts == total_parts;

        let missing_sum: i64 = members
            .iter()
            .filter(|m| m.owned_qty < 1)
            .map(|m| m.median_plat.unwrap_or(0))
            .sum();
        let missing_value = if missing_sum > 0 {
            Some(missing_sum)
        } else {
            None
        };

        let parts: Vec<SetPart> = members
            .iter()
            .map(|m| SetPart {
                slug: m.slug.clone(),
                part_name: partname::split_name(&m.display_name, &m.part_type).1,
                owned: m.owned_qty >= 1,
                median_plat: m.median_plat,
            })
            .collect();

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
