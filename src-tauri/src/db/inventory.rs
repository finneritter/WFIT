use crate::db::prices;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::types::InventoryRow;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;

pub fn add(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    db.with(|c| {
        let exists: i64 = c.query_row(
            "SELECT COUNT(*) FROM catalog_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::NotFound(format!("unknown slug: {slug}")));
        }
        let now = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = inventory_items.qty + ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        let new_qty: i64 = c.query_row(
            "SELECT qty FROM inventory_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )?;
        Ok(new_qty)
    })
}

/// Add an item to inventory — or, if `slug` is a set, add each of its member
/// parts instead (a set is owned by owning its parts). Returns the slugs whose
/// price should be refreshed: the item, or the set + all its parts.
pub fn add_item_or_set(db: &Db, slug: &str, qty: i64) -> AppResult<Vec<String>> {
    if qty <= 0 {
        return Err(AppError::Invalid("qty must be > 0".into()));
    }
    let category: String = db.with(|c| {
        c.query_row(
            "SELECT category FROM catalog_items WHERE slug = ?1",
            params![slug],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("unknown slug: {slug}")))
    })?;

    if category == "set" {
        let parts: Vec<String> = db.with(|c| {
            let mut stmt = c.prepare("SELECT slug FROM catalog_items WHERE set_slug = ?1")?;
            let rows = stmt.query_map(params![slug], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })?;
        if parts.is_empty() {
            // No known composition — fall back to adding the set item itself.
            add(db, slug, qty)?;
            return Ok(vec![slug.to_string()]);
        }
        for p in &parts {
            add(db, p, qty)?;
        }
        let mut refresh = parts;
        refresh.push(slug.to_string()); // also refresh the set's own price for valuation
        Ok(refresh)
    } else {
        add(db, slug, qty)?;
        Ok(vec![slug.to_string()])
    }
}

fn is_set(db: &Db, slug: &str) -> AppResult<bool> {
    db.with(|c| {
        let cat: Option<String> = c
            .query_row(
                "SELECT category FROM catalog_items WHERE slug = ?1",
                params![slug],
                |r| r.get(0),
            )
            .ok();
        Ok(cat.as_deref() == Some("set"))
    })
}

/// Move owned holdings toward `target` complete sets by applying the delta
/// uniformly across member parts. Preserves extras beyond a complete set.
fn adjust_set(db: &Db, set_slug: &str, target: i64) -> AppResult<()> {
    let members = set_members(db, set_slug)?;
    if members.is_empty() {
        return Ok(());
    }
    let delta = target - complete_set_count(db, set_slug)?;
    if delta == 0 {
        return Ok(());
    }
    let now = Utc::now().to_rfc3339();
    db.with(|c| {
        for m in &members {
            let cur: i64 = c
                .query_row(
                    "SELECT qty FROM inventory_items WHERE slug = ?1",
                    params![m],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let nq = (cur + delta).max(0);
            if nq == 0 {
                c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![m])?;
            } else {
                c.execute(
                    "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
                     VALUES (?1, ?2, ?3, ?3, 'manual')
                     ON CONFLICT(slug) DO UPDATE SET qty = ?2, last_modified_at = ?3",
                    params![m, nq, now],
                )?;
            }
        }
        Ok(())
    })
}

/// set_qty that understands sets (adjusts member parts); otherwise plain set_qty.
pub fn set_qty_aware(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if is_set(db, slug)? {
        adjust_set(db, slug, qty.max(0))?;
        Ok(qty.max(0))
    } else {
        set_qty(db, slug, qty)
    }
}

/// remove that understands sets (removes a complete set's worth of parts).
pub fn remove_aware(db: &Db, slug: &str) -> AppResult<()> {
    if is_set(db, slug)? {
        adjust_set(db, slug, 0)
    } else {
        remove(db, slug)
    }
}

pub fn set_qty(db: &Db, slug: &str, qty: i64) -> AppResult<i64> {
    if qty < 0 {
        return Err(AppError::Invalid("qty must be >= 0".into()));
    }
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        if qty == 0 {
            c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![slug])?;
            return Ok(0);
        }
        c.execute(
            "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
             VALUES (?1, ?2, ?3, ?3, 'manual')
             ON CONFLICT(slug) DO UPDATE SET
                qty = ?2,
                last_modified_at = ?3",
            params![slug, qty, now],
        )?;
        Ok(qty)
    })
}

pub fn remove(db: &Db, slug: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM inventory_items WHERE slug = ?1", params![slug])?;
        Ok(())
    })
}

/// The owned inventory as displayed/valued: complete sets are collapsed into a
/// single set entry priced at the set's median; leftover/partial parts and
/// non-set items pass through. Ranked by value.
pub fn list_ranked(db: &Db) -> AppResult<Vec<InventoryRow>> {
    let mut out = owned_holdings(db)?;
    out.sort_by(|a, b| {
        row_value(b)
            .cmp(&row_value(a))
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    Ok(out)
}

/// Set-aware total plat value of the inventory (complete sets at set price,
/// mods/arcanes at their rank-aware value).
pub fn total_value(db: &Db) -> AppResult<i64> {
    Ok(owned_holdings(db)?.iter().map(row_value).sum())
}

/// The plat value of one owned row: rank-aware value when present, else median × qty.
fn row_value(r: &InventoryRow) -> i64 {
    r.value_plat.unwrap_or_else(|| r.median_plat.unwrap_or(0) * r.qty)
}

/// Number of complete sets currently owned (all member parts present).
pub fn complete_set_count(db: &Db, set_slug: &str) -> AppResult<i64> {
    let members = set_members(db, set_slug)?;
    if members.is_empty() {
        return Ok(0);
    }
    db.with(|c| {
        let mut min_qty = i64::MAX;
        for m in &members {
            let q: i64 = c
                .query_row(
                    "SELECT qty FROM inventory_items WHERE slug = ?1",
                    params![m],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            min_qty = min_qty.min(q);
        }
        Ok(min_qty.max(0))
    })
}

pub fn set_members(db: &Db, set_slug: &str) -> AppResult<Vec<String>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT slug FROM catalog_items WHERE set_slug = ?1")?;
        let rows = stmt.query_map(params![set_slug], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Raw owned rows joined with catalog + price (no set collapsing).
fn fetch_owned(db: &Db) -> AppResult<Vec<InventoryRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT
                ci.slug, ci.display_name, ci.part_type, ci.category, ci.set_slug,
                ii.qty, ci.ducats, ci.is_vaulted,
                pc.median_plat, pc.trend, pc.delta_7d, pc.volume_7d,
                ci.thumbnail_url, ii.last_modified_at
             FROM inventory_items ii
             JOIN catalog_items ci ON ci.slug = ii.slug
             LEFT JOIN price_cache pc ON pc.slug = ii.slug
             WHERE ii.qty > 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(InventoryRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: r.get(3)?,
                set_slug: r.get(4)?,
                qty: r.get(5)?,
                ducats: r.get(6)?,
                is_vaulted: r.get::<_, i64>(7)? != 0,
                median_plat: r.get(8)?,
                trend: r.get(9)?,
                delta_7d: r.get(10)?,
                volume_7d: r.get(11)?,
                thumbnail_url: r.get(12)?,
                last_modified_at: r.get(13)?,
                value_plat: None,
            })
        })?;
        let mut owned = rows.collect::<Result<Vec<_>, _>>()?;
        // Second pass: rank-aware value for mods/arcanes; live-sell value for other
        // illiquid items. Both prefer the live ask over the trade median (effective_price).
        for row in &mut owned {
            if let Some(v) = rank_aware_value(c, &row.slug)? {
                // Ranked: value off per-rank effective price; show the blended
                // per-unit price so price × qty == value in the grid/drawer.
                row.value_plat = Some(v);
                if row.qty > 0 {
                    row.median_plat = Some(v / row.qty);
                }
            } else if let Some(ep) = prices::effective_price(c, &row.slug, None)? {
                // Non-ranked: show the live-sell-preferred price and value off it.
                row.median_plat = Some(ep);
                row.value_plat = Some(ep * row.qty);
            }
        }
        Ok(owned)
    })
}

/// Σ qty_r × effective per-rank price (live ask preferred over trade median) for a
/// slug's rank breakdown. None when the slug has no breakdown (prime parts) —
/// callers then fall back to the non-ranked effective price.
fn rank_aware_value(c: &rusqlite::Connection, slug: &str) -> AppResult<Option<i64>> {
    let breakdown: Vec<(i64, i64)> = {
        let mut stmt = c.prepare("SELECT rank, qty FROM inventory_ranks WHERE slug = ?1")?;
        let rows = stmt.query_map(params![slug], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if breakdown.is_empty() {
        return Ok(None);
    }
    let mut total = 0i64;
    for (rank, qty) in breakdown {
        let price = prices::effective_price(c, slug, Some(rank))?.unwrap_or(0);
        total += price * qty;
    }
    Ok(Some(total))
}

/// set_slug → its catalog/price row, used as the collapsed-set template.
fn set_templates(db: &Db) -> AppResult<HashMap<String, InventoryRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT ci.slug, ci.display_name, ci.part_type, ci.ducats, ci.is_vaulted,
                    pc.median_plat, pc.trend, pc.delta_7d, pc.volume_7d, ci.thumbnail_url
             FROM catalog_items ci
             LEFT JOIN price_cache pc ON pc.slug = ci.slug
             WHERE ci.category = 'set'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(InventoryRow {
                slug: r.get(0)?,
                display_name: r.get(1)?,
                part_type: r.get(2)?,
                category: "set".into(),
                set_slug: None,
                qty: 0,
                ducats: r.get(3)?,
                is_vaulted: r.get::<_, i64>(4)? != 0,
                median_plat: r.get(5)?,
                trend: r.get(6)?,
                delta_7d: r.get(7)?,
                volume_7d: r.get(8)?,
                thumbnail_url: r.get(9)?,
                last_modified_at: String::new(),
                value_plat: None,
            })
        })?;
        let mut m = HashMap::new();
        for r in rows {
            let row = r?;
            m.insert(row.slug.clone(), row);
        }
        Ok(m)
    })
}

fn owned_holdings(db: &Db) -> AppResult<Vec<InventoryRow>> {
    let owned = fetch_owned(db)?;
    let templates = set_templates(db)?;

    // member part slugs per set, plus the qty each owned part contributes.
    let owned_qty: HashMap<&str, i64> = owned.iter().map(|r| (r.slug.as_str(), r.qty)).collect();
    let mut members: HashMap<String, Vec<String>> = HashMap::new();
    for r in &owned {
        if let Some(set) = &r.set_slug {
            members.entry(set.clone()).or_default().push(r.slug.clone());
        }
    }
    // A set is complete only if EVERY catalog member is owned, so pull the full
    // membership (not just owned parts) to detect missing ones.
    let mut consumed: HashMap<String, i64> = HashMap::new();
    let mut out: Vec<InventoryRow> = Vec::new();
    for set_slug in members.keys() {
        let Some(tmpl) = templates.get(set_slug) else { continue };
        if tmpl.median_plat.is_none() {
            continue; // no set price → don't collapse, value parts individually
        }
        let all_members = set_members(db, set_slug)?;
        let complete = all_members
            .iter()
            .map(|m| *owned_qty.get(m.as_str()).unwrap_or(&0))
            .min()
            .unwrap_or(0);
        if complete > 0 {
            let mut row = tmpl.clone();
            row.qty = complete;
            out.push(row);
            for m in &all_members {
                *consumed.entry(m.clone()).or_insert(0) += complete;
            }
        }
    }

    for r in &owned {
        let used = *consumed.get(&r.slug).unwrap_or(&0);
        let left = r.qty - used;
        if left > 0 {
            let mut row = r.clone();
            row.qty = left;
            out.push(row);
        }
    }
    Ok(out)
}

/// Owned slugs with qty > 0 — the priority set for price refresh.
pub fn owned_slugs(db: &Db) -> AppResult<Vec<String>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT slug FROM inventory_items WHERE qty > 0")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}
