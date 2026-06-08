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

/// The stored session's expiry, read from the JWT's `exp` claim:
/// `(rfc3339 expiry, is_expired)`. Best-effort — `(None, false)` if there's no
/// token or the claim can't be read (so a quirky token never blocks the UI).
pub fn session_expiry() -> (Option<String>, bool) {
    match load_jwt() {
        Ok(Some(jwt)) => decode_exp(&jwt),
        _ => (None, false),
    }
}

/// Decode a JWT's `exp` (epoch seconds) without verifying the signature — we only
/// need the expiry for a UI warning, not to trust the token.
fn decode_exp(jwt: &str) -> (Option<String>, bool) {
    use base64::Engine;
    let Some(payload) = jwt.split('.').nth(1) else {
        return (None, false);
    };
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload) else {
        return (None, false);
    };
    let Ok(claims) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return (None, false);
    };
    let Some(exp) = claims.get("exp").and_then(|e| e.as_i64()) else {
        return (None, false);
    };
    match chrono::DateTime::<chrono::Utc>::from_timestamp(exp, 0) {
        Some(dt) => (Some(dt.to_rfc3339()), dt < chrono::Utc::now()),
        None => (None, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn jwt_with_exp(exp: i64) -> String {
        let b64 = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        format!(
            "{}.{}.sig",
            b64(r#"{"alg":"HS256"}"#),
            b64(&format!("{{\"exp\":{exp}}}"))
        )
    }

    #[test]
    fn reads_future_expiry_as_valid() {
        let (at, expired) = decode_exp(&jwt_with_exp(4_102_444_800)); // year 2100
        assert!(at.is_some());
        assert!(!expired);
    }

    #[test]
    fn flags_past_expiry() {
        let (at, expired) = decode_exp(&jwt_with_exp(1_000_000_000)); // year 2001
        assert!(at.is_some());
        assert!(expired);
    }

    #[test]
    fn garbage_token_is_not_expired() {
        assert_eq!(decode_exp("not-a-jwt"), (None, false));
        assert_eq!(decode_exp(""), (None, false));
    }
}
