//! warframe.market account session. The ONLY secret WFIT holds — a JWT — lives
//! in the OS keychain via `keyring`, never in SQLite, never logged. Tier 1
//! (public username) needs none of this; Tier 2 (pasted JWT) uses it to read
//! invisible orders. Read-only in v1: WFIT never creates/edits/deletes orders.

use crate::error::AppResult;
use keyring::Entry;

const SERVICE: &str = "dev.finn.wfit";
const ACCOUNT: &str = "wfm-jwt";

fn entry() -> keyring::Result<Entry> {
    Entry::new(SERVICE, ACCOUNT)
}

/// Store (or replace) the session JWT in the OS keychain.
pub fn store_jwt(jwt: &str) -> AppResult<()> {
    entry()?.set_password(jwt)?;
    Ok(())
}

/// Load the session JWT, if one is stored. Absent = Ok(None).
pub fn load_jwt() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(jwt) => Ok(Some(jwt)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Remove any stored session JWT (signout / disconnect).
pub fn delete_jwt() -> AppResult<()> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Whether a session JWT is present (best-effort; treats errors as "no session").
pub fn has_session() -> bool {
    matches!(load_jwt(), Ok(Some(_)))
}
