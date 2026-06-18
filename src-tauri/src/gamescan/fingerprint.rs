//! Shared parse for DE's `UpgradeFingerprint` — a JSON string embedded in ranked
//! inventory entries (mods, arcanes, and every arsenal item) carrying the instance's
//! rank (`lvl`) and affinity (`xp`). Used by both the item scan (`map.rs`) and the
//! account scan (`account.rs`).
use serde_json::Value;

/// `(lvl, xp)` from an entry's `UpgradeFingerprint`. Missing or malformed → `(0, 0)`.
pub fn parse_fingerprint(entry: &Value) -> (i64, i64) {
    let Some(fp) = entry
        .get("UpgradeFingerprint")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
    else {
        return (0, 0);
    };
    let lvl = fp.get("lvl").and_then(|v| v.as_i64()).unwrap_or(0);
    let xp = fp.get("xp").and_then(|v| v.as_i64()).unwrap_or(0);
    (lvl, xp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_lvl_and_xp() {
        let e = json!({ "UpgradeFingerprint": "{\"lvl\":5,\"xp\":12345}" });
        assert_eq!(parse_fingerprint(&e), (5, 12345));
    }

    #[test]
    fn missing_or_garbage_is_zero() {
        assert_eq!(parse_fingerprint(&json!({})), (0, 0));
        assert_eq!(
            parse_fingerprint(&json!({ "UpgradeFingerprint": "not json" })),
            (0, 0)
        );
        // lvl present, xp absent → xp defaults to 0.
        assert_eq!(
            parse_fingerprint(&json!({ "UpgradeFingerprint": "{\"lvl\":3}" })),
            (3, 0)
        );
    }
}
