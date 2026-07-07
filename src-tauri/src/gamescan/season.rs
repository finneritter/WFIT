//! `SeasonChallengeHistory` parse — the Nightwave acts this account has
//! completed this season, read from the SAME inventory.php blob the item scan
//! fetches (no extra request). Shape is community-documented, so the parse is
//! case-tolerant and drops anything it doesn't recognize.

use serde_json::Value;

/// One completed act: the challenge path, plus the act instance id when the
/// game reports one (the id is what lets a recurring daily start unchecked).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletedAct {
    pub path: String,
    pub oid: Option<String>,
}

fn field<'a>(v: &'a Value, a: &str, b: &str) -> Option<&'a Value> {
    v.get(a).or_else(|| v.get(b))
}

pub fn parse_season_history(json: &Value) -> Vec<CompletedAct> {
    let Some(arr) =
        field(json, "SeasonChallengeHistory", "seasonChallengeHistory").and_then(Value::as_array)
    else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|e| {
            let path = field(e, "challenge", "Challenge")?.as_str()?.to_string();
            let oid = field(e, "id", "Id").and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.get("$oid").and_then(Value::as_str).map(str::to_string))
            });
            Some(CompletedAct { path, oid })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_history_shapes() {
        // Field casing + oid shape are defensive: DE mixes conventions across blobs
        // and this section is community-documented, not spec'd — the first live
        // scan after this lands is the real shape check (see plan's final step).
        let j = json!({
            "SeasonChallengeHistory": [
                {"challenge": "/Lotus/Types/Challenges/Seasons/Daily/SeasonDailyAimGlide", "id": "0018001400000000000001aa"},
                {"Challenge": "/Lotus/Types/Challenges/Seasons/Weekly/SeasonWeeklyPit", "Id": {"$oid": "0018001400000000000001bb"}},
                {"challenge": "/Lotus/Types/Challenges/Seasons/Daily/SeasonDailyOldNoId"},
                {"id": "junk-without-challenge"}
            ]
        });
        let acts = parse_season_history(&j);
        assert_eq!(acts.len(), 3);
        assert_eq!(acts[0].oid.as_deref(), Some("0018001400000000000001aa"));
        assert_eq!(acts[1].oid.as_deref(), Some("0018001400000000000001bb"));
        assert_eq!(acts[2].oid, None);
        assert!(acts[2].path.ends_with("SeasonDailyOldNoId"));
    }

    #[test]
    fn missing_section_is_empty() {
        assert!(parse_season_history(&json!({"MiscItems": []})).is_empty());
    }
}
