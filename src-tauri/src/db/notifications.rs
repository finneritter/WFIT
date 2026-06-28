//! In-app notification center store (`app_notifications`). A generic, persistent
//! list any page/background task can push to; the topbar bell reads it. User data
//! — survives `rebuild_cache`, only `wipe_app` clears it.
//!
//! Dismissal is SOFT: `dismiss`/`clear_all` stamp `dismissed_at` and keep the row
//! (and its `dedup_key`). With `insert_deduped`'s `INSERT OR IGNORE` on the UNIQUE
//! key, that's what stops a still-live source (e.g. an auction) from re-notifying
//! after you clear it. `prune_old` is the only delete, and only of dismissed+old
//! rows.
use crate::db::Db;
use crate::error::AppResult;
use chrono::{Duration, Utc};
use rusqlite::params;
use serde::Serialize;

/// How long a dismissed notification lingers before `prune_old` deletes it.
const PRUNE_AFTER_DAYS: i64 = 30;

/// A new notification to file. `dedup_key` (when set) makes the insert idempotent.
pub struct NewNotification {
    pub kind: String,
    pub dedup_key: Option<String>,
    pub title: String,
    pub body: String,
    pub nav_screen: Option<String>,
    pub nav_slug: Option<String>,
    pub payload: Option<String>,
}

/// A stored notification as shown to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub nav_screen: Option<String>,
    pub nav_slug: Option<String>,
    pub payload: Option<String>,
    pub created_at: String,
    /// RFC3339 when marked read, or null when still unread (drives the badge).
    pub read_at: Option<String>,
}

/// File a notification. Idempotent on `dedup_key` (UNIQUE) — a duplicate key is a
/// no-op. Returns the number of rows inserted (0 = ignored duplicate, 1 = new).
pub fn insert_deduped(db: &Db, n: &NewNotification) -> AppResult<usize> {
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        let rows = c.execute(
            "INSERT OR IGNORE INTO app_notifications
                (kind, dedup_key, title, body, nav_screen, nav_slug, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                n.kind,
                n.dedup_key,
                n.title,
                n.body,
                n.nav_screen,
                n.nav_slug,
                n.payload,
                now
            ],
        )?;
        Ok(rows)
    })
}

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<Notification> {
    Ok(Notification {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        nav_screen: r.get(4)?,
        nav_slug: r.get(5)?,
        payload: r.get(6)?,
        created_at: r.get(7)?,
        read_at: r.get(8)?,
    })
}

/// Active (non-dismissed) notifications, newest first.
pub fn list_active(db: &Db) -> AppResult<Vec<Notification>> {
    db.read(|c| {
        let mut stmt = c.prepare(
            "SELECT id, kind, title, body, nav_screen, nav_slug, payload, created_at, read_at
             FROM app_notifications
             WHERE dismissed_at IS NULL
             ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], map_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Count of active, unread notifications (the bell badge).
pub fn unread_count(db: &Db) -> AppResult<i64> {
    db.read(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM app_notifications
             WHERE dismissed_at IS NULL AND read_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(n)
    })
}

/// Mark every active, unread notification read (called when the dropdown opens).
pub fn mark_all_read(db: &Db) -> AppResult<()> {
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        c.execute(
            "UPDATE app_notifications SET read_at = ?1
             WHERE read_at IS NULL AND dismissed_at IS NULL",
            params![now],
        )?;
        Ok(())
    })
}

/// Soft-dismiss one notification (keeps the row + dedup_key).
pub fn dismiss(db: &Db, id: i64) -> AppResult<()> {
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        c.execute(
            "UPDATE app_notifications SET dismissed_at = ?1 WHERE id = ?2 AND dismissed_at IS NULL",
            params![now, id],
        )?;
        Ok(())
    })
}

/// Soft-dismiss all active notifications.
pub fn clear_all(db: &Db) -> AppResult<()> {
    db.with(|c| {
        let now = Utc::now().to_rfc3339();
        c.execute(
            "UPDATE app_notifications SET dismissed_at = ?1 WHERE dismissed_at IS NULL",
            params![now],
        )?;
        Ok(())
    })
}

/// Delete dismissed rows older than the retention window. NEVER touches active
/// rows — pruning a live source's row would let it re-notify.
pub fn prune_old(db: &Db) -> AppResult<usize> {
    db.with(|c| {
        let cutoff = (Utc::now() - Duration::days(PRUNE_AFTER_DAYS)).to_rfc3339();
        let rows = c.execute(
            "DELETE FROM app_notifications
             WHERE dismissed_at IS NOT NULL AND created_at < ?1",
            params![cutoff],
        )?;
        Ok(rows)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::testutil::test_db;

    fn sample(key: &str) -> NewNotification {
        NewNotification {
            kind: "riven".into(),
            dedup_key: Some(key.into()),
            title: "Match found".into(),
            body: "A riven matched".into(),
            nav_screen: Some("rivens".into()),
            nav_slug: None,
            payload: Some("{\"saved_search_id\":1}".into()),
        }
    }

    #[test]
    fn dedup_is_idempotent() {
        let db = test_db("notif-dedup");
        assert_eq!(insert_deduped(&db, &sample("riven:1:abc")).unwrap(), 1);
        // Same key again → ignored, no new row.
        assert_eq!(insert_deduped(&db, &sample("riven:1:abc")).unwrap(), 0);
        assert_eq!(list_active(&db).unwrap().len(), 1);
        assert_eq!(unread_count(&db).unwrap(), 1);
    }

    #[test]
    fn soft_dismiss_keeps_row_and_dedup() {
        let db = test_db("notif-dismiss");
        insert_deduped(&db, &sample("riven:1:abc")).unwrap();
        let id = list_active(&db).unwrap()[0].id;
        dismiss(&db, id).unwrap();
        // Gone from the active list…
        assert!(list_active(&db).unwrap().is_empty());
        assert_eq!(unread_count(&db).unwrap(), 0);
        // …but the row (and its key) persist: re-insert is still ignored, so a
        // still-live auction can't resurrect the cleared notification.
        assert_eq!(insert_deduped(&db, &sample("riven:1:abc")).unwrap(), 0);
        assert!(list_active(&db).unwrap().is_empty());
    }

    #[test]
    fn mark_read_and_clear_all() {
        let db = test_db("notif-readclear");
        insert_deduped(&db, &sample("k1")).unwrap();
        insert_deduped(&db, &sample("k2")).unwrap();
        assert_eq!(unread_count(&db).unwrap(), 2);
        mark_all_read(&db).unwrap();
        assert_eq!(unread_count(&db).unwrap(), 0);
        assert_eq!(list_active(&db).unwrap().len(), 2); // read, still shown
        clear_all(&db).unwrap();
        assert!(list_active(&db).unwrap().is_empty());
    }
}
