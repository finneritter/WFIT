use crate::error::{AppError, AppResult};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::path::Path;
use std::sync::Arc;

pub mod buylist;
pub mod catalog;
pub mod inventory;
pub mod meta;
pub mod prices;
pub mod sales;
pub mod sets;
pub mod settings;
pub mod trends;
pub mod watchlist;
pub mod wfm;

// Append future migrations here; never edit a shipped one.
static MIGRATIONS: Lazy<Migrations<'static>> = Lazy::new(|| {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/0001_init.sql")),
        M::up(include_str!("../../migrations/0002_ohlc.sql")),
    ])
});

#[derive(Clone)]
pub struct Db {
    inner: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        MIGRATIONS
            .to_latest(&mut conn)
            .map_err(AppError::Migration)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn with<R>(&self, f: impl FnOnce(&Connection) -> AppResult<R>) -> AppResult<R> {
        let conn = self.inner.lock();
        f(&conn)
    }

    pub fn with_mut<R>(&self, f: impl FnOnce(&mut Connection) -> AppResult<R>) -> AppResult<R> {
        let mut conn = self.inner.lock();
        f(&mut conn)
    }
}
