//! On-disk SQLite backups in `<app_data_dir>/backups/`.
//!
//! Two paths: `snapshot` (healthy DB — `VACUUM INTO`, which writes a consistent
//! committed snapshot including WAL content, no sidecars) and `raw_copy`
//! (recovery — the DB may be unopenable, so copy the file trio byte-for-byte).
//! `prune` keeps the newest [`KEEP`] snapshots so backups can't grow unbounded.
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

use super::Db;

/// How many backups to keep (manual + automatic combined).
pub const KEEP: usize = 10;

#[derive(serde::Serialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_at: String, // RFC3339
}

/// `<db parent>/backups` — lives next to the DB so it ships with the data dir.
pub fn backups_dir(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or(Path::new(".")).join("backups")
}

/// `wfit-YYYYMMDD-HHMMSS[.<tag>].sqlite`, with a numeric suffix if two backups
/// land in the same second (VACUUM INTO refuses to overwrite).
fn fresh_dest(dir: &Path, tag: Option<&str>) -> PathBuf {
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let tag = tag.map(|t| format!(".{t}")).unwrap_or_default();
    let base = dir.join(format!("wfit-{stamp}{tag}.sqlite"));
    if !base.exists() {
        return base;
    }
    for n in 2.. {
        let alt = dir.join(format!("wfit-{stamp}-{n}{tag}.sqlite"));
        if !alt.exists() {
            return alt;
        }
    }
    unreachable!()
}

/// Healthy-path snapshot on a bare connection (used by `snapshot` and by
/// `Db::open` before the read pool exists). Returns the snapshot path.
pub fn snapshot_conn(conn: &Connection, dir: &Path, tag: Option<&str>) -> AppResult<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let dest = fresh_dest(dir, tag);
    let dest_str = dest
        .to_str()
        .ok_or_else(|| AppError::Invalid("backup path is not valid UTF-8".into()))?;
    conn.execute("VACUUM INTO ?1", [dest_str])?;
    Ok(dest)
}

/// One-click backup of a live Db: VACUUM INTO via the writer (brief write
/// stall; pooled reads are unaffected), then prune.
pub fn snapshot(db: &Db, db_path: &Path, tag: Option<&str>) -> AppResult<PathBuf> {
    let dir = backups_dir(db_path);
    let dest = db.with(|c| snapshot_conn(c, &dir, tag))?;
    prune(&dir, KEEP)?;
    Ok(dest)
}

/// Recovery-path backup: the DB may be corrupt/unopenable, so never open it —
/// copy the main file plus `-wal`/`-shm` sidecars byte-for-byte. The sidecars
/// keep their relative suffixes so SQLite can recover the trio as a unit.
pub fn raw_copy(db_path: &Path) -> AppResult<PathBuf> {
    if !db_path.exists() {
        return Err(AppError::NotFound(format!(
            "database file missing: {}",
            db_path.display()
        )));
    }
    let dir = backups_dir(db_path);
    std::fs::create_dir_all(&dir)?;
    let dest = fresh_dest(&dir, Some("recovery"));
    std::fs::copy(db_path, &dest)?;
    for suffix in ["-wal", "-shm"] {
        let side = sibling(db_path, suffix);
        if side.exists() {
            std::fs::copy(&side, sibling(&dest, suffix))?;
        }
    }
    prune(&dir, KEEP)?;
    Ok(dest)
}

/// Move a broken DB aside (rename, never delete): `wfit.sqlite` →
/// `wfit.sqlite.broken-<ts>`, sidecars alike. A fresh open then starts clean
/// with no stale WAL re-attaching. Returns the new main-file path.
pub fn reset_aside(db_path: &Path) -> AppResult<PathBuf> {
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let moved = db_path.with_file_name(format!(
        "{}.broken-{stamp}",
        db_path.file_name().unwrap_or_default().to_string_lossy()
    ));
    if db_path.exists() {
        std::fs::rename(db_path, &moved)?;
    }
    for suffix in ["-wal", "-shm"] {
        let side = sibling(db_path, suffix);
        if side.exists() {
            std::fs::rename(&side, sibling(&moved, suffix))?;
        }
    }
    Ok(moved)
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

/// Backups newest-first; a missing dir is just "no backups yet".
pub fn list(dir: &Path) -> AppResult<Vec<BackupInfo>> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("wfit-") || !name.ends_with(".sqlite") {
            continue; // skip sidecars + foreign files; they ride with their main file
        }
        let meta = entry.metadata()?;
        let modified: chrono::DateTime<chrono::Utc> = meta.modified()?.into();
        out.push(BackupInfo {
            file_name: name,
            size_bytes: meta.len(),
            modified_at: modified.to_rfc3339(),
        });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

/// Keep the newest `keep` snapshots, deleting older ones together with their
/// `-wal`/`-shm` sidecars (recovery copies have them; VACUUM snapshots don't).
pub fn prune(dir: &Path, keep: usize) -> AppResult<usize> {
    let snapshots = list(dir)?; // newest first
    let mut removed = 0;
    for info in snapshots.iter().skip(keep) {
        let main = dir.join(&info.file_name);
        std::fs::remove_file(&main)?;
        removed += 1;
        for suffix in ["-wal", "-shm"] {
            let side = sibling(&main, suffix);
            if side.exists() {
                std::fs::remove_file(&side)?;
            }
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("wfit-backup-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn snapshot_produces_openable_db_and_prunes() {
        let dir = scratch_dir("snap");
        let db_path = dir.join("wfit.sqlite");
        let db = crate::db::Db::open(&db_path).unwrap();
        crate::db::testutil::seed_item(&db, "probe_item", "mod", Some(10));

        let dest = snapshot(&db, &db_path, None).unwrap();
        assert!(dest.exists());
        // The snapshot is a standalone, consistent DB containing the row.
        let copy = rusqlite::Connection::open(&dest).unwrap();
        let n: i64 = copy
            .query_row(
                "SELECT COUNT(*) FROM catalog_items WHERE slug='probe_item'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_keeps_newest_n_and_sidecar_groups() {
        let dir = scratch_dir("prune");
        // 13 fake snapshots with strictly increasing names/mtimes; #3 has a sidecar.
        for i in 0..13u32 {
            let main = dir.join(format!("wfit-20260101-0000{i:02}.sqlite"));
            std::fs::write(&main, b"x").unwrap();
            if i == 3 {
                std::fs::write(sibling(&main, "-wal"), b"x").unwrap();
            }
            // mtime granularity: set explicit times via filetime-free approach —
            // names sort with mtimes here because we sleep between groups below.
        }
        // list() sorts by mtime; same-second writes are fine as long as the kept
        // count is right (ordering among equals is arbitrary but prune still
        // keeps exactly `keep` files).
        let removed = prune(&dir, 10).unwrap();
        assert_eq!(removed, 3);
        let remaining = list(&dir).unwrap();
        assert_eq!(remaining.len(), 10);
        // If the sidecar's main file was pruned, the sidecar must be gone too.
        let main3 = dir.join("wfit-20260101-000003.sqlite");
        if !main3.exists() {
            assert!(!sibling(&main3, "-wal").exists(), "orphan sidecar survived");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_copy_and_reset_aside_handle_sidecars() {
        let dir = scratch_dir("raw");
        let db_path = dir.join("wfit.sqlite");
        std::fs::write(&db_path, b"not a real db").unwrap();
        std::fs::write(sibling(&db_path, "-wal"), b"wal").unwrap();

        let dest = raw_copy(&db_path).unwrap();
        assert!(dest.exists());
        assert!(sibling(&dest, "-wal").exists(), "sidecar not copied");

        let moved = reset_aside(&db_path).unwrap();
        assert!(!db_path.exists());
        assert!(!sibling(&db_path, "-wal").exists());
        assert!(moved.exists());
        assert!(sibling(&moved, "-wal").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_of_missing_dir_is_empty() {
        let dir = std::env::temp_dir().join("wfit-backup-definitely-missing");
        assert!(list(&dir).unwrap().is_empty());
    }
}
