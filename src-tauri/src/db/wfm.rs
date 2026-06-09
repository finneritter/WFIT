use crate::db::Db;
use crate::error::AppResult;
use crate::types::{ListingRow, WfmAccount};
use chrono::Utc;
use rusqlite::params;

/// The single account row (id = 1). `has_session` is filled by the caller from
/// the keychain — the JWT never lives in SQLite.
pub fn get_account(db: &Db) -> AppResult<WfmAccount> {
    db.with(|c| {
        let row = c
            .query_row(
                "SELECT username, status, last_import_at FROM wfm_account WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .ok();
        Ok(match row {
            Some((username, status, last_import_at)) => WfmAccount {
                connected: username.is_some(),
                username,
                status,
                last_import_at,
                has_session: false,
                session_expires_at: None,
                session_expired: false,
            },
            None => WfmAccount {
                username: None,
                status: None,
                last_import_at: None,
                connected: false,
                has_session: false,
                session_expires_at: None,
                session_expired: false,
            },
        })
    })
}

pub fn set_account(db: &Db, username: &str, status: Option<&str>) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO wfm_account (id, username, status) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                status = COALESCE(excluded.status, wfm_account.status)",
            params![username, status],
        )?;
        Ok(())
    })
}

/// Persist the account's market presence (mirrors `wfm_set_status` after the API call).
pub fn set_status(db: &Db, status: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE wfm_account SET status = ?1 WHERE id = 1",
            params![status],
        )?;
        Ok(())
    })
}

pub fn mark_imported(db: &Db) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "UPDATE wfm_account SET last_import_at = ?1 WHERE id = 1",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(())
    })
}

pub fn clear_account(db: &Db) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM market_listings", [])?;
        c.execute("DELETE FROM wfm_account WHERE id = 1", [])?;
        Ok(())
    })
}

/// A row to write into the listings mirror.
#[derive(Debug, Clone)]
pub struct ListingMirror {
    pub order_id: String,
    pub slug: String,
    pub order_type: String,
    pub your_price: Option<i64>,
    pub qty: i64,
    pub visible: bool,
}

/// Replace the listings mirror wholesale (it reflects warframe.market's truth).
pub fn replace_listings(db: &Db, listings: &[ListingMirror]) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM market_listings", [])?;
        let now = Utc::now().to_rfc3339();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO market_listings
                    (order_id, slug, order_type, your_price, qty, visible, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for l in listings {
                stmt.execute(params![
                    l.order_id,
                    l.slug,
                    l.order_type,
                    l.your_price,
                    l.qty,
                    l.visible as i64,
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(listings.len())
    })
}

pub fn list_listings(db: &Db) -> AppResult<Vec<ListingRow>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT ml.order_id, ml.slug, ci.display_name, ci.part_type, ml.order_type,
                    ml.your_price, ml.qty, ml.visible, pc.median_plat, ml.updated_at,
                    ci.is_vaulted, pc.trend, ci.thumbnail_url
             FROM market_listings ml
             JOIN catalog_items ci ON ci.slug = ml.slug
             LEFT JOIN price_cache pc ON pc.slug = ml.slug
             WHERE ml.order_type = 'sell'
             ORDER BY ci.display_name ASC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(ListingRow {
                order_id: r.get(0)?,
                slug: r.get(1)?,
                display_name: r.get(2)?,
                part_type: r.get(3)?,
                order_type: r.get(4)?,
                your_price: r.get(5)?,
                qty: r.get(6)?,
                visible: r.get::<_, i64>(7)? != 0,
                market_low: r.get(8)?,
                updated_at: r.get(9)?,
                is_vaulted: r.get::<_, i64>(10)? != 0,
                trend: r.get(11)?,
                thumbnail_url: r.get(12)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// A user-confirmed import line: merge into inventory (never clobber a larger manual count).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ImportApply {
    pub slug: String,
    pub qty: i64,
}

/// Transactional merge of confirmed import rows into inventory. Sets qty to the
/// max of the existing count and the imported count. Marks new rows 'wfm_import'.
pub fn apply_import(db: &Db, rows: &[ImportApply]) -> AppResult<usize> {
    db.with_mut(|conn| {
        let tx = conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO inventory_items (slug, qty, first_added_at, last_modified_at, source)
                 VALUES (?1, ?2, ?3, ?3, 'wfm_import')
                 ON CONFLICT(slug) DO UPDATE SET
                    qty = MAX(inventory_items.qty, ?2),
                    last_modified_at = ?3",
            )?;
            for r in rows {
                if r.qty > 0 {
                    stmt.execute(params![r.slug, r.qty, now])?;
                }
            }
        }
        tx.commit()?;
        Ok(rows.len())
    })
}
