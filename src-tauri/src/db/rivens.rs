//! Riven reference caches (weapons + attributes) and the user's saved searches.
//! Reference tables are rebuildable caches refreshed from warframe.market;
//! `riven_saved_searches` is user data. Writes go through `db.with`/`with_mut`,
//! reads through the pool (`db.read`).
use crate::db::Db;
use crate::error::AppResult;
use crate::rivens::{RivenAttribute, RivenWeapon, SavedSearch};
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;

/// Replace the whole weapons cache in one transaction.
pub fn replace_weapons(db: &Db, weapons: &[RivenWeapon]) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM riven_weapons", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO riven_weapons (slug, name, riven_type, group_name, disposition)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for w in weapons {
                stmt.execute(params![
                    w.slug,
                    w.name,
                    w.riven_type,
                    w.group,
                    w.disposition
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Replace the whole attributes cache in one transaction.
pub fn replace_attributes(db: &Db, attrs: &[RivenAttribute]) -> AppResult<()> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM riven_attributes", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO riven_attributes (slug, name, unit, exclusive_to, positive_is_negative)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for a in attrs {
                let excl = a
                    .exclusive_to
                    .as_ref()
                    .map(|v| v.join(","))
                    .unwrap_or_default();
                stmt.execute(params![
                    a.slug,
                    a.name,
                    a.unit,
                    excl,
                    a.positive_is_negative as i64
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

fn map_weapon(r: &rusqlite::Row) -> rusqlite::Result<RivenWeapon> {
    Ok(RivenWeapon {
        slug: r.get(0)?,
        name: r.get(1)?,
        riven_type: r.get(2)?,
        group: r.get(3)?,
        disposition: r.get(4)?,
    })
}

pub fn weapon(db: &Db, slug: &str) -> AppResult<Option<RivenWeapon>> {
    db.read(|c| {
        let w = c
            .query_row(
                "SELECT slug, name, riven_type, group_name, disposition
                 FROM riven_weapons WHERE slug = ?1",
                params![slug],
                map_weapon,
            )
            .ok();
        Ok(w)
    })
}

pub fn list_weapons(db: &Db) -> AppResult<Vec<RivenWeapon>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT slug, name, riven_type, group_name, disposition
             FROM riven_weapons ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], map_weapon)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

fn map_attr(r: &rusqlite::Row) -> rusqlite::Result<RivenAttribute> {
    let excl: String = r.get(3)?;
    let exclusive_to = if excl.is_empty() {
        None
    } else {
        Some(excl.split(',').map(|s| s.to_string()).collect())
    };
    Ok(RivenAttribute {
        slug: r.get(0)?,
        name: r.get(1)?,
        unit: r.get(2)?,
        exclusive_to,
        positive_is_negative: r.get::<_, i64>(4)? != 0,
    })
}

pub fn list_attributes(db: &Db) -> AppResult<Vec<RivenAttribute>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT slug, name, unit, exclusive_to, positive_is_negative
             FROM riven_attributes ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], map_attr)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

pub fn attributes_map(db: &Db) -> AppResult<HashMap<String, RivenAttribute>> {
    Ok(list_attributes(db)?
        .into_iter()
        .map(|a| (a.slug.clone(), a))
        .collect())
}

pub fn weapons_empty(db: &Db) -> AppResult<bool> {
    db.read(|c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM riven_weapons", [], |r| r.get(0))?;
        Ok(n == 0)
    })
}

// ---- saved searches (user data) ------------------------------------------

fn map_saved(r: &rusqlite::Row) -> rusqlite::Result<SavedSearch> {
    let positives: String = r.get(3)?;
    let min_values_json: String = r.get(8)?;
    Ok(SavedSearch {
        id: r.get(0)?,
        label: r.get(1)?,
        weapon: r.get(2)?,
        positives: if positives.is_empty() {
            Vec::new()
        } else {
            positives.split(',').map(|s| s.to_string()).collect()
        },
        negative: r.get(4)?,
        polarity: r.get(5)?,
        re_rolls_max: r.get(6)?,
        mastery_rank_max: r.get(7)?,
        // Stored as a JSON object; tolerate empty/garbage by falling back to {}.
        min_values: serde_json::from_str(&min_values_json).unwrap_or_default(),
        created_at: r.get(9)?,
        notify: r.get::<_, i64>(10)? != 0,
    })
}

/// Shared SELECT column list — keep `notify` last so the indices in `map_saved`
/// (min_values=8, created_at=9, notify=10) stay put.
const SAVED_COLS: &str = "id, label, weapon, positives, negative, polarity,
     re_rolls_max, mastery_rank_max, min_values, created_at, notify";

pub fn list_saved(db: &Db) -> AppResult<Vec<SavedSearch>> {
    db.read(|c| {
        let mut stmt = c.prepare(&format!(
            "SELECT {SAVED_COLS} FROM riven_saved_searches ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map([], map_saved)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Saved searches with notifications enabled — the watcher's work list.
pub fn list_notify_searches(db: &Db) -> AppResult<Vec<SavedSearch>> {
    db.read(|c| {
        let mut stmt = c.prepare(&format!(
            "SELECT {SAVED_COLS} FROM riven_saved_searches WHERE notify = 1 ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map([], map_saved)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Toggle the per-search notification opt-in.
pub fn set_notify(db: &Db, id: i64, enabled: bool) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE riven_saved_searches SET notify = ?1 WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create_saved(
    db: &Db,
    label: &str,
    weapon: &str,
    positives: &[String],
    negative: Option<&str>,
    polarity: Option<&str>,
    re_rolls_max: Option<i64>,
    mastery_rank_max: Option<i64>,
    min_values: &HashMap<String, f64>,
) -> AppResult<i64> {
    let min_values_json = serde_json::to_string(min_values).unwrap_or_else(|_| "{}".into());
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO riven_saved_searches
                (label, weapon, positives, negative, polarity, re_rolls_max, mastery_rank_max, min_values, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                label,
                weapon,
                positives.join(","),
                negative,
                polarity,
                re_rolls_max,
                mastery_rank_max,
                min_values_json,
                now
            ],
        )?;
        Ok(c.last_insert_rowid())
    })
}

pub fn delete_saved(db: &Db, id: i64) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "DELETE FROM riven_saved_searches WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::test_db;
    use crate::rivens::RivenWeapon;

    #[test]
    fn weapons_roundtrip_and_replace() {
        let db = test_db("riven-weapons");
        assert!(weapons_empty(&db).unwrap());
        replace_weapons(
            &db,
            &[RivenWeapon {
                slug: "torid".into(),
                name: "Torid".into(),
                riven_type: "rifle".into(),
                group: "primary".into(),
                disposition: 1.3,
            }],
        )
        .unwrap();
        assert!(!weapons_empty(&db).unwrap());
        let w = weapon(&db, "torid").unwrap().unwrap();
        assert_eq!(w.disposition, 1.3);
        // Replace wipes the old set.
        replace_weapons(&db, &[]).unwrap();
        assert!(weapons_empty(&db).unwrap());
    }

    #[test]
    fn saved_search_crud() {
        let db = test_db("riven-saved");
        let min_values = HashMap::from([
            ("critical_chance".to_string(), 90.0),
            ("zoom".to_string(), 60.0),
        ]);
        let id = create_saved(
            &db,
            "crit/ms torid",
            "torid",
            &["critical_chance".into(), "multishot".into()],
            Some("zoom"),
            Some("madurai"),
            Some(5),
            None,
            &min_values,
        )
        .unwrap();
        let rows = list_saved(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].positives, vec!["critical_chance", "multishot"]);
        assert_eq!(rows[0].negative.as_deref(), Some("zoom"));
        assert_eq!(rows[0].min_values.get("critical_chance"), Some(&90.0));
        assert_eq!(rows[0].min_values.get("zoom"), Some(&60.0));
        // notify is off by default and excluded from the watcher's list.
        assert!(!rows[0].notify);
        assert!(list_notify_searches(&db).unwrap().is_empty());
        set_notify(&db, id, true).unwrap();
        assert!(list_saved(&db).unwrap()[0].notify);
        assert_eq!(list_notify_searches(&db).unwrap().len(), 1);
        delete_saved(&db, id).unwrap();
        assert!(list_saved(&db).unwrap().is_empty());
    }
}
