//! Completed Nightwave acts from the game scan — a rebuildable cache of the
//! inventory blob's `SeasonChallengeHistory`, replaced wholesale on every scan.
//! Read-side joins against the live season's acts (`worldstate::SeasonAct`), so
//! stale rows are inert rather than wrong.

use crate::db::Db;
use crate::error::AppResult;
use crate::gamescan::season::CompletedAct;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashSet;

/// Replace the whole completion set (one scan = the full season history).
#[allow(dead_code)] // Consumed by the scan commands in a follow-up commit
pub fn replace(db: &Db, acts: &[CompletedAct]) -> AppResult<()> {
    db.with_mut(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM nightwave_completions", [])?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO nightwave_completions (challenge_path, instance_oid, recorded_at)
                 VALUES (?1, ?2, ?3)",
            )?;
            let now = Utc::now().to_rfc3339();
            for a in acts {
                ins.execute(params![a.path, a.oid, now])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// What the game says is done: (instance oids, paths of entries with NO oid).
/// Path matching is only a fallback for oid-less entries — matching every path
/// would false-positive a daily that recurs later in the season.
#[allow(dead_code)] // Consumed by the scan commands in a follow-up commit
pub fn completed(db: &Db) -> AppResult<(HashSet<String>, HashSet<String>)> {
    db.read(|c| {
        let mut stmt =
            c.prepare("SELECT challenge_path, instance_oid FROM nightwave_completions")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        let (mut oids, mut pathless) = (HashSet::new(), HashSet::new());
        for r in rows {
            let (path, oid) = r?;
            match oid {
                Some(o) => {
                    oids.insert(o);
                }
                None => {
                    pathless.insert(path);
                }
            }
        }
        Ok((oids, pathless))
    })
}

#[cfg(test)]
mod tests {
    use super::{completed, replace};
    use crate::db::testutil::test_db;
    use crate::gamescan::season::CompletedAct;

    fn act(path: &str, oid: Option<&str>) -> CompletedAct {
        CompletedAct {
            path: path.into(),
            oid: oid.map(Into::into),
        }
    }

    #[test]
    fn replace_and_completed_roundtrip() {
        let db = test_db("nightwave-acts");
        replace(
            &db,
            &[
                act(
                    "/Lotus/Types/Challenges/Seasons/Daily/SeasonDailyAimGlide",
                    Some("aaa"),
                ),
                act(
                    "/Lotus/Types/Challenges/Seasons/Weekly/SeasonWeeklyPit",
                    None,
                ),
            ],
        )
        .unwrap();
        let (oids, pathless) = completed(&db).unwrap();
        assert!(oids.contains("aaa"));
        // oid-less entries fall back to path matching; oid-carrying ones must NOT
        // (a recurring daily shares the path but not the instance).
        assert!(pathless.contains("/Lotus/Types/Challenges/Seasons/Weekly/SeasonWeeklyPit"));
        assert!(!pathless.contains("/Lotus/Types/Challenges/Seasons/Daily/SeasonDailyAimGlide"));

        // wholesale replace: old rows gone
        replace(&db, &[act("/Lotus/x", Some("bbb"))]).unwrap();
        let (oids, pathless) = completed(&db).unwrap();
        assert_eq!(oids.len(), 1);
        assert!(oids.contains("bbb"));
        assert!(pathless.is_empty());
    }
}
