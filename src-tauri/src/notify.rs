//! Desktop-notification engine. A backend-driven loop (NOT frontend JS): a hidden
//! WebKitGTK window throttles timers and can't run the JS Notification API, so the
//! whole point of close-to-tray would be defeated if notifications lived in the UI.
//! Isolated like `worldstate` — it only reads the worldstate cache and the prefs.
//!
//! Fires OS toasts "when the event happens" (no lead time, per the user's choice):
//! - S/A-tier arbitration goes live,
//! - a Void Cascade fissure appears,
//! - Baro Ki'Teer / Varzia is active,
//! - the daily (00:00 UTC) / weekly (Monday 00:00 UTC) reset rolls over.
//!
//! Dedup is in-memory: instance events (arbitration / cascade / vendor) key off a
//! stable identifier so they fire once per occurrence; resets fire on the UTC
//! date/week *transition* observed during the session (so launching mid-day never
//! back-fires a reset that already happened).

use crate::worldstate::Worldstate;
use crate::AppState;
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_notification::NotificationExt;

/// Poll cadence. `worldstate.get()` is 45s-TTL cache-aware, so a 60s tick hits the
/// network at most ~once/min and usually serves cache.
const TICK: Duration = Duration::from_secs(60);
/// Let the launch worldstate fetch land before the first evaluation.
const WARMUP: Duration = Duration::from_secs(30);
/// Cap the dedup set so a long-running session can't grow it without bound.
const DEDUP_CAP: usize = 512;

/// In-memory firing state. `fired` dedupes instance events; the two reset slots
/// hold the last-observed period so resets fire only on a real rollover.
#[derive(Default)]
struct NotifyState {
    fired: Mutex<HashSet<String>>,
    last_daily: Mutex<Option<NaiveDate>>,
    last_weekly: Mutex<Option<NaiveDate>>,
}

impl NotifyState {
    /// True the first time `key` is seen this session, false thereafter.
    fn once(&self, key: String) -> bool {
        let mut set = self.fired.lock();
        if set.len() >= DEDUP_CAP {
            // Clearing risks at most a single duplicate for an event whose window
            // is still open — acceptable, and far better than unbounded growth.
            set.clear();
        }
        set.insert(key)
    }
}

pub fn spawn(state: Arc<AppState>, app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let st = NotifyState::default();
        tokio::time::sleep(WARMUP).await;
        loop {
            if let Err(e) = tick(&state, &app, &st).await {
                tracing::warn!(error = %e, "notify tick failed");
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

async fn tick(
    state: &Arc<AppState>,
    app: &tauri::AppHandle,
    st: &NotifyState,
) -> crate::error::AppResult<()> {
    let prefs = crate::db::settings::notification_prefs(&state.db)?;
    if !prefs.master_enabled {
        return Ok(());
    }
    let ws = state.worldstate.get().await?;
    let now = Utc::now();

    if prefs.s_tier_arbitration {
        check_arbitration(&ws, st, app);
    }
    if prefs.void_cascade {
        check_void_cascade(&ws, st, app);
    }
    if prefs.vendor_arrival {
        check_vendors(&ws, st, app);
    }
    if prefs.daily_reset {
        check_daily_reset(now, st, app);
    }
    if prefs.weekly_reset {
        check_weekly_reset(now, st, app);
    }
    Ok(())
}

fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!(error = %e, "OS notification failed");
    }
}

/// S/A-tier (community rating) — the "ones of note" radar.
fn is_sa(tier: Option<&str>) -> bool {
    matches!(tier, Some("S") | Some("A"))
}

fn check_arbitration(ws: &Worldstate, st: &NotifyState, app: &tauri::AppHandle) {
    let Some(block) = &ws.arbitration else { return };
    let Some(arb) = &block.current else { return };
    if !is_sa(arb.tier.as_deref()) {
        return;
    }
    // activation is unique per hourly slot → fires once when this one goes live.
    if st.once(format!("arb-{}", arb.activation)) {
        let tier = arb.tier.as_deref().unwrap_or("?");
        notify(
            app,
            &format!("[{tier}] Arbitration"),
            &format!("{} — {}", arb.node, arb.mission_type),
        );
    }
}

fn check_void_cascade(ws: &Worldstate, st: &NotifyState, app: &tauri::AppHandle) {
    for f in ws
        .fissures
        .iter()
        .filter(|f| f.mission_type == "Void Cascade")
    {
        let key = format!(
            "vc-{}-{}-{}-{}",
            f.node,
            f.tier,
            f.is_hard,
            f.expiry.as_deref().unwrap_or("")
        );
        if st.once(key) {
            let sp = if f.is_hard { " (Steel Path)" } else { "" };
            notify(
                app,
                "Void Cascade fissure",
                &format!("{} {} — {}{}", f.tier, f.mission_type, f.node, sp),
            );
        }
    }
}

fn check_vendors(ws: &Worldstate, st: &NotifyState, app: &tauri::AppHandle) {
    for t in [ws.baro.as_ref(), ws.varzia.as_ref()].into_iter().flatten() {
        if !t.active {
            continue;
        }
        let character = t.character.as_deref().unwrap_or("A vendor");
        // activation changes per fortnightly rotation → once per arrival (correct
        // even for Varzia, whose `active` stays true continuously between rotations).
        let key = format!(
            "vendor-{}-{}",
            character,
            t.activation.as_deref().unwrap_or("")
        );
        if st.once(key) {
            let body = match t.location.as_deref() {
                Some(loc) => format!("{character} has arrived at {loc}"),
                None => format!("{character} has arrived"),
            };
            notify(app, "Vendor", &body);
        }
    }
}

/// Most recent UTC day boundary, as a date. Daily reset = 00:00 UTC.
fn current_day(now: DateTime<Utc>) -> NaiveDate {
    now.date_naive()
}

/// Most recent Monday 00:00 UTC, as a date. Weekly reset = Monday 00:00 UTC.
fn current_week(now: DateTime<Utc>) -> NaiveDate {
    let d = now.date_naive();
    let back = d.weekday().num_days_from_monday() as u64;
    d - chrono::Days::new(back)
}

fn check_daily_reset(now: DateTime<Utc>, st: &NotifyState, app: &tauri::AppHandle) {
    let cur = current_day(now);
    let mut last = st.last_daily.lock();
    if last.is_some_and(|prev| prev != cur) {
        notify(app, "Daily reset", "Warframe's daily reset has occurred.");
    }
    *last = Some(cur);
}

fn check_weekly_reset(now: DateTime<Utc>, st: &NotifyState, app: &tauri::AppHandle) {
    let cur = current_week(now);
    let mut last = st.last_weekly.lock();
    if last.is_some_and(|prev| prev != cur) {
        notify(app, "Weekly reset", "Warframe's weekly reset has occurred.");
    }
    *last = Some(cur);
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn sa_filter() {
        assert!(is_sa(Some("S")));
        assert!(is_sa(Some("A")));
        assert!(!is_sa(Some("B")));
        assert!(!is_sa(Some("F")));
        assert!(!is_sa(None));
    }

    #[test]
    fn once_is_true_then_false() {
        let st = NotifyState::default();
        assert!(st.once("k".into()));
        assert!(!st.once("k".into()));
        assert!(st.once("other".into()));
    }

    #[test]
    fn week_boundary_is_monday() {
        // 2026-06-13 is a Saturday; its week's Monday is 2026-06-08.
        let sat = Utc.with_ymd_and_hms(2026, 6, 13, 12, 0, 0).unwrap();
        assert_eq!(
            current_week(sat),
            NaiveDate::from_ymd_opt(2026, 6, 8).unwrap()
        );
        // On the Monday itself the boundary is that same day.
        let mon = Utc.with_ymd_and_hms(2026, 6, 8, 0, 30, 0).unwrap();
        assert_eq!(
            current_week(mon),
            NaiveDate::from_ymd_opt(2026, 6, 8).unwrap()
        );
    }

    #[test]
    fn day_boundary_is_utc_date() {
        let t = Utc.with_ymd_and_hms(2026, 6, 13, 23, 59, 0).unwrap();
        assert_eq!(
            current_day(t),
            NaiveDate::from_ymd_opt(2026, 6, 13).unwrap()
        );
    }
}
