//! Background riven-availability watcher. Every few minutes it runs each
//! notify-enabled saved search and files an in-app notification for any matching
//! auction (all wanted positives + the search's value thresholds). Idempotent via
//! the notification dedup key, so a given auction notifies at most once.
use crate::db::notifications::{self, NewNotification};
use crate::db::rivens as db_rivens;
use crate::rivens::{ResultAttr, RivenQuery, SavedSearch};
use crate::AppState;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// Delay before the first sweep, so the launch warm-up gets the throttle first.
const WARMUP_SECS: u64 = 90;
/// Gap between sweeps.
const TICK_SECS: u64 = 300;
/// Only auctions at this tier or better count (0 = exact, 1 = all positives).
const MATCH_TIER_MAX: i64 = 1;

/// True when `attrs` satisfy the saved search's per-stat value thresholds. Mirrors
/// the frontend `passesThresholds` (src/routes/RivenSearch.tsx) EXACTLY: a positive
/// must be present and `>=` its min; the negative, if present, must have magnitude
/// `<=` its max (an absent negative passes). An empty map always passes.
pub fn passes_thresholds(
    attrs: &[ResultAttr],
    min_values: &HashMap<String, f64>,
    negative_slug: Option<&str>,
) -> bool {
    for (slug, &threshold) in min_values {
        if Some(slug.as_str()) == negative_slug {
            if let Some(a) = attrs.iter().find(|a| a.slug == *slug && !a.positive) {
                if a.value.abs() > threshold {
                    return false;
                }
            }
        } else {
            match attrs.iter().find(|a| a.slug == *slug && a.positive) {
                None => return false,
                Some(a) => {
                    if a.value < threshold {
                        return false;
                    }
                }
            }
        }
    }
    true
}

fn query_of(s: &SavedSearch) -> RivenQuery {
    RivenQuery {
        weapon: s.weapon.clone(),
        positives: s.positives.clone(),
        negative: s.negative.clone(),
        polarity: s.polarity.clone(),
        re_rolls_max: s.re_rolls_max,
        mastery_rank_max: s.mastery_rank_max,
    }
}

/// One sweep over all notify-enabled searches. Returns how many notifications were
/// newly filed (duplicates of still-live auctions are ignored by the dedup key).
async fn sweep(state: &Arc<AppState>) -> crate::error::AppResult<usize> {
    notifications::prune_old(&state.db)?;
    let searches = db_rivens::list_notify_searches(&state.db)?;
    let mut filed = 0usize;
    for s in searches {
        let resp = match crate::rivens::search(state, query_of(&s), 100).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(search = s.id, error = %e, "riven watch search failed");
                continue;
            }
        };
        for r in resp.results.iter().filter(|r| {
            r.match_tier <= MATCH_TIER_MAX
                && passes_thresholds(&r.attributes, &s.min_values, s.negative.as_deref())
        }) {
            let price = r.buyout_price.or(r.starting_price);
            let stats = r
                .attributes
                .iter()
                .filter(|a| a.positive)
                .map(|a| a.name.as_str())
                .collect::<Vec<_>>()
                .join(" / ");
            let body = match price {
                Some(p) => format!("{stats} — {p}p ({})", r.owner_name),
                None => format!("{stats} ({})", r.owner_name),
            };
            let payload = serde_json::json!({
                "saved_search_id": s.id,
                "auction_id": r.id,
                "price": price,
                "weapon": r.weapon_name,
            })
            .to_string();
            filed += notifications::insert_deduped(
                &state.db,
                &NewNotification {
                    kind: "riven".into(),
                    dedup_key: Some(format!("riven:{}:{}", s.id, r.id)),
                    title: format!("{} riven available", r.weapon_name),
                    body,
                    nav_screen: Some("rivens".into()),
                    nav_slug: None,
                    payload: Some(payload),
                },
            )?;
        }
    }
    Ok(filed)
}

/// Spawn the perpetual watcher. Like `spawn_price_heartbeat`, it skips while a full
/// sync owns the throttle and emits `notifications-updated` only when it files
/// something new (so an unchanged sweep doesn't churn the UI).
pub fn spawn_riven_watch(state: Arc<AppState>, app: tauri::AppHandle) {
    use tauri::Emitter;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(WARMUP_SECS)).await;
        loop {
            if !state.pricing_active.load(Ordering::Relaxed) {
                match sweep(&state).await {
                    Ok(n) if n > 0 => {
                        tracing::debug!(filed = n, "riven watch: new notifications");
                        let _ = app.emit("notifications-updated", n);
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!(error = %e, "riven watch sweep failed"),
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(TICK_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attr(slug: &str, value: f64, positive: bool) -> ResultAttr {
        ResultAttr {
            slug: slug.into(),
            name: slug.into(),
            value,
            positive,
            unit: Some("percent".into()),
            grade: None,
            wanted: true,
        }
    }

    #[test]
    fn empty_thresholds_pass() {
        let attrs = vec![attr("damage", 50.0, true)];
        assert!(passes_thresholds(&attrs, &HashMap::new(), None));
    }

    #[test]
    fn positive_must_meet_min_and_be_present() {
        let attrs = vec![attr("damage", 120.0, true)];
        let ok = HashMap::from([("damage".to_string(), 100.0)]);
        assert!(passes_thresholds(&attrs, &ok, None));
        let too_low = HashMap::from([("damage".to_string(), 150.0)]);
        assert!(!passes_thresholds(&attrs, &too_low, None));
        // Wanted positive absent entirely → fail.
        let missing = HashMap::from([("critical_chance".to_string(), 10.0)]);
        assert!(!passes_thresholds(&attrs, &missing, None));
    }

    #[test]
    fn negative_magnitude_capped_absence_passes() {
        // Negative value stored signed; threshold is a magnitude cap.
        let attrs = vec![attr("damage", 120.0, true), attr("zoom", -55.0, false)];
        let within = HashMap::from([("zoom".to_string(), 60.0)]);
        assert!(passes_thresholds(&attrs, &within, Some("zoom")));
        let worse = HashMap::from([("zoom".to_string(), 50.0)]);
        assert!(!passes_thresholds(&attrs, &worse, Some("zoom")));
        // No negative on the riven at all → the cap passes (no downside is good).
        let no_neg = vec![attr("damage", 120.0, true)];
        assert!(passes_thresholds(&no_neg, &worse, Some("zoom")));
    }
}
