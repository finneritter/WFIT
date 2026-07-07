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

/// vendor_checkoff key for manual act ticks — distinct from the cred-shop
/// vendor panel, which uses "nightwave".
pub const MANUAL_KEY: &str = "nightwave_acts";

/// Attach check-off state to the worldstate's nightwave challenges (the
/// worldstate module is DB-free, so the DB join happens here — the acts
/// sibling of `db::vendor::enrich`). Best-effort: a DB error leaves the
/// panel unchecked rather than failing the whole worldstate payload.
pub fn overlay(db: &Db, ws: &mut crate::worldstate::Worldstate) {
    let bridge: std::collections::HashMap<String, (String, String)> = ws
        .season_acts
        .iter()
        .map(|a| (a.ws_id.clone(), (a.oid.clone(), a.path.clone())))
        .collect();
    let Some(nw) = ws.nightwave.as_mut() else {
        return;
    };
    let manual = match crate::db::vendor_checkoff::set_for(db, MANUAL_KEY) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "nightwave manual check read failed");
            return;
        }
    };
    let (oids, pathless) = match completed(db) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "nightwave completion read failed");
            return;
        }
    };
    for c in nw.challenges.iter_mut() {
        let scan_done = bridge
            .get(c.id.as_str())
            .is_some_and(|(oid, path)| oids.contains(oid) || pathless.contains(path));
        if scan_done {
            c.checked = true;
            c.check_source = Some("scan".into());
        } else if manual.contains(&c.id) {
            c.checked = true;
            c.check_source = Some("manual".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{completed, overlay, replace, MANUAL_KEY};
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

    #[test]
    fn overlay_marks_scan_and_manual() {
        use crate::worldstate::{Nightwave, NightwaveChallenge, SeasonAct, Worldstate};
        let db = test_db("nightwave-overlay");

        fn ch(id: &str) -> NightwaveChallenge {
            NightwaveChallenge {
                id: id.into(),
                title: id.into(),
                desc: None,
                reputation: 1000,
                is_daily: true,
                is_elite: false,
                expiry: None,
                checked: false,
                check_source: None,
            }
        }
        // Build a minimal Worldstate: only nightwave + season_acts matter here.
        let mut ws: Worldstate = serde_json::from_value(serde_json::json!({
            "cycles": [], "fissures": [], "baro": null, "varzia": null,
            "sortie": null, "archon_hunt": null, "steel_path": null, "circuit": null,
            "nightwave": null, "invasions": [], "arbitration": null,
            "fetched_at": "now", "source_timestamp": null, "fissure_source": "de"
        }))
        .unwrap();
        ws.nightwave = Some(Nightwave {
            season: Some(1),
            expiry: None,
            challenges: vec![ch("100aimglide"), ch("200pit"), ch("300fresh")],
        });
        ws.season_acts = vec![
            SeasonAct {
                ws_id: "100aimglide".into(),
                oid: "oid-a".into(),
                path: "/Lotus/Daily/SeasonDailyAimGlide".into(),
            },
            SeasonAct {
                ws_id: "200pit".into(),
                oid: "oid-b".into(),
                path: "/Lotus/Weekly/SeasonWeeklyPit".into(),
            },
            SeasonAct {
                ws_id: "300fresh".into(),
                oid: "oid-c".into(),
                path: "/Lotus/Daily/SeasonDailyFresh".into(),
            },
        ];

        // scan says: instance oid-a done; AimGlide ALSO completed long ago under a
        // different instance (same path, other oid) — must not leak onto oid-c.
        replace(
            &db,
            &[
                CompletedAct {
                    path: "/Lotus/Daily/SeasonDailyAimGlide".into(),
                    oid: Some("oid-a".into()),
                },
                CompletedAct {
                    path: "/Lotus/Daily/SeasonDailyFresh".into(),
                    oid: Some("old-instance".into()),
                },
            ],
        )
        .unwrap();
        crate::db::vendor_checkoff::set(&db, MANUAL_KEY, "200pit").unwrap();

        overlay(&db, &mut ws);
        let cs = &ws.nightwave.as_ref().unwrap().challenges;
        assert_eq!(cs[0].check_source.as_deref(), Some("scan"));
        assert!(cs[0].checked);
        assert_eq!(cs[1].check_source.as_deref(), Some("manual"));
        assert!(!cs[2].checked); // other-instance completion did NOT match
    }
}
