use crate::error::{AppError, AppResult};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::Arc;

pub mod arcanes;
pub mod buylist;
pub mod catalog;
pub mod gamescan;
pub mod inventory;
pub mod meta;
pub mod prices;
pub mod sales;
pub mod sets;
pub mod settings;
pub mod trends;
pub mod vault;
pub mod watchlist;
pub mod wfm;

// Append future migrations here; never edit a shipped one.
static MIGRATIONS: Lazy<Migrations<'static>> = Lazy::new(|| {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init.sql")),
        M::up(include_str!("../../migrations/0002_ohlc.sql")),
        M::up(include_str!("../../migrations/0003_game_import.sql")),
        M::up(include_str!("../../migrations/0004_ranks.sql")),
        M::up(include_str!("../../migrations/0005_orders.sql")),
        M::up(include_str!("../../migrations/0006_buy_orders.sql")),
        M::up(include_str!("../../migrations/0007_mod_rarity.sql")),
        M::up(include_str!("../../migrations/0008_vault_status.sql")),
        M::up(include_str!("../../migrations/0009_perf_indexes.sql")),
        M::up(include_str!("../../migrations/0010_order_fetch_meta.sql")),
    ])
});

/// Read-only connection pool size. WAL lets these read concurrently with the
/// single writer, so a long market sync no longer blocks UI reads.
const READ_POOL_SIZE: u32 = 4;

/// Performance/correctness pragmas applied to every connection (writer + readers).
/// `journal_mode`/`synchronous` are set once on the writer (WAL is persisted DB
/// state); these are per-connection and must be re-applied to each pool member.
fn tune(conn: &Connection) -> rusqlite::Result<()> {
    // Wait (don't error with SQLITE_BUSY) when briefly contending the writer's commit.
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "cache_size", -65536)?; // 64 MB page cache
    conn.pragma_update(None, "mmap_size", 268_435_456_i64)?; // 256 MB memory-mapped I/O
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    Ok(())
}

#[derive(Clone)]
pub struct Db {
    /// The single writer. WAL allows only one writer; serializing through this
    /// mutex keeps writes (and the few read paths that still use `with`) correct.
    inner: Arc<Mutex<Connection>>,
    /// Read-only connections for hot UI read paths (`read`). Isolated from the
    /// writer so a sync holding `inner` doesn't freeze reads.
    readers: Pool<SqliteConnectionManager>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        tune(&conn)?;
        MIGRATIONS
            .to_latest(&mut conn)
            .map_err(AppError::Migration)?;

        // Build the read pool AFTER migrations so the schema is in place. Each
        // reader is `query_only` so an accidental write routed to `read` errors
        // loudly instead of corrupting state.
        let manager = SqliteConnectionManager::file(path).with_init(|c| {
            c.pragma_update(None, "synchronous", "NORMAL")?;
            tune(c)?;
            c.pragma_update(None, "query_only", "ON")?;
            Ok(())
        });
        let readers = Pool::builder()
            .max_size(READ_POOL_SIZE)
            .build(manager)
            .map_err(|e| AppError::Other(format!("read pool init: {e}")))?;

        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
            readers,
        })
    }

    /// Run a closure on the writer connection (shared read/write lock). Use for
    /// writes and the few legacy read paths that have not moved to `read`.
    pub fn with<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
        let conn = self.inner.lock();
        f(&conn)
    }

    pub fn with_mut<R>(&self, f: impl FnOnce(&mut Connection) -> AppResult<R>) -> AppResult<R> {
        let mut conn = self.inner.lock();
        f(&mut conn)
    }

    /// Run a read-only closure on a pooled connection — never blocks on the
    /// writer mutex, so UI reads stay responsive during a market sync. The
    /// connection is `query_only`; do not attempt writes here.
    pub fn read<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
        let conn = self
            .readers
            .get()
            .map_err(|e| AppError::Other(format!("read pool: {e}")))?;
        f(&conn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    // The headline Phase-1 guarantee: a read does NOT block while a write holds the
    // writer connection. A `with_mut` closure sits on the lock for 600ms; a `read`
    // on the pool must still return promptly (WAL = concurrent readers).
    #[test]
    fn read_does_not_block_on_a_held_write() {
        let dir = std::env::temp_dir().join(format!("wfit-readpool-{}", std::process::id()));
        let _ = std::fs::remove_file(&dir);
        let db = Db::open(&dir).unwrap();
        db.with_mut(|c| {
            c.execute("CREATE TABLE t (x INTEGER)", [])
                .map_err(Into::into)
        })
        .unwrap();

        let writer = db.clone();
        let handle = std::thread::spawn(move || {
            writer
                .with_mut(|c| {
                    c.execute("INSERT INTO t VALUES (1)", [])?;
                    std::thread::sleep(Duration::from_millis(600)); // hold the writer lock
                    Ok(())
                })
                .unwrap();
        });
        std::thread::sleep(Duration::from_millis(50)); // ensure the write lock is held

        let start = Instant::now();
        let n: i64 = db
            .read(|c| Ok(c.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))?))
            .unwrap();
        let elapsed = start.elapsed();
        handle.join().unwrap();

        assert!(
            elapsed < Duration::from_millis(300),
            "read blocked on the writer for {elapsed:?}"
        );
        assert!(n >= 0);
        let _ = std::fs::remove_file(&dir);
    }
}
