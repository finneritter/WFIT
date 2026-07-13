//! Relic-crack price capture (issue #2): screenshot the reward-selection screen,
//! OCR the offered part names, price them from the local caches, and show a
//! Warframe-HUD-styled overlay. Isolated from the market path like `gamescan`/
//! `worldstate` — **zero warframe.market calls happen at capture time**; pricing
//! reads reuse the same preloaded maps as the Relics browser.
//!
//! ToS note: this is the WFInfo approach — a one-off screenshot read locally, no
//! injection, no memory reads, no game files touched beyond (optionally) tailing
//! the EE.log text file. DE has publicly tolerated this class of tool for years.

#[cfg(feature = "relic-ocr")]
pub mod capture;
pub mod layout;
pub mod matching;
#[cfg(feature = "relic-ocr")]
pub mod ocr;
pub mod preprocess;

use crate::db::{catalog, relics, wanted, Db};
use crate::error::AppResult;
use crate::types::{CrackCapture, CrackReward};

/// Overlay window label (the window itself lands with the overlay stage; the
/// emit is a no-op until then).
pub const RELIC_OVERLAY_LABEL: &str = "relic-overlay";

/// Preprocessed band → OCR → card grouping → closed-vocabulary matching.
/// The file-based and live-capture paths both funnel through here.
#[cfg(feature = "relic-ocr")]
pub fn read_rewards(frame: &image::RgbaImage) -> Result<Vec<matching::LineMatch>, String> {
    let band = preprocess::reward_band(frame);
    let words = ocr::words(&band)?;
    let cards = layout::group_into_cards(&words);
    let vocab = matching::build_vocab();
    Ok(matching::match_lines(&vocab, &cards, 4))
}

/// Price matched reward names through the same preload the Relics browser uses
/// (`relics::BrowserCtx`), so a captured part's plat always equals what the
/// Relics screen shows for that slug. Marks the highest-plat reward `best`.
pub fn price_matches(db: &Db, matches: &[matching::LineMatch]) -> AppResult<Vec<CrackReward>> {
    let signals = wanted::crack_signals(db)?;
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let ctx = relics::load_ctx(c, name_to_slug)?;
        let mut rewards: Vec<CrackReward> = matches
            .iter()
            .map(|m| {
                let slug = ctx
                    .name_to_slug
                    .get(&catalog::normalize_name(&m.display_name))
                    .cloned();
                let plat = slug
                    .as_deref()
                    .and_then(|s| crate::db::prices::effective_price_from(&ctx.prices, s, None));
                let ducats = slug.as_deref().and_then(|s| ctx.ducats.get(s).copied());
                let ducats_per_plat = match (ducats, plat) {
                    (Some(d), Some(p)) if p > 0 => {
                        Some((d as f64 / p as f64 * 10.0).round() / 10.0)
                    }
                    _ => None,
                };
                CrackReward {
                    reward_name: m.display_name.clone(),
                    owned_qty: slug
                        .as_deref()
                        .and_then(|s| ctx.owned_parts.get(s).copied())
                        .unwrap_or(0),
                    wanted: slug
                        .as_deref()
                        .is_some_and(|s| signals.watch_buy.contains(s)),
                    set_slug: slug
                        .as_deref()
                        .and_then(|s| signals.one_away.get(s))
                        .map(|(set_slug, _)| set_slug.clone()),
                    plat,
                    ducats,
                    ducats_per_plat,
                    slug,
                    confidence: m.confidence,
                    best: false,
                }
            })
            .collect();
        if let Some(best_idx) = rewards
            .iter()
            .enumerate()
            .filter_map(|(i, r)| r.plat.map(|p| (i, p)))
            .max_by_key(|&(_, p)| p)
            .map(|(i, _)| i)
        {
            rewards[best_idx].best = true;
        }
        Ok(rewards)
    })
}

/// The full capture pipeline: grab the game frame, OCR it off the async
/// runtime (CPU-heavy), price the matches. Never errors — failures come back
/// as a `CrackCapture { error, .. }` the overlay renders as a failure state.
#[cfg(feature = "relic-ocr")]
pub async fn run_capture(db: Db) -> CrackCapture {
    let captured_at = chrono::Utc::now().to_rfc3339();
    let fail = |error: String, capture_ms: i64| CrackCapture {
        captured_at: captured_at.clone(),
        rewards: Vec::new(),
        ocr_lines: Vec::new(),
        capture_ms,
        ocr_ms: 0,
        error: Some(error),
    };

    let t0 = std::time::Instant::now();
    let frame = tauri::async_runtime::spawn_blocking(capture::game_frame).await;
    let capture_ms = t0.elapsed().as_millis() as i64;
    let (frame, path) = match frame {
        Ok(Ok(ok)) => ok,
        Ok(Err(e)) => return fail(e, capture_ms),
        Err(e) => return fail(format!("capture task: {e}"), capture_ms),
    };
    tracing::info!(capture_ms, path, "relic_ocr: frame captured");

    let t1 = std::time::Instant::now();
    let matches = tauri::async_runtime::spawn_blocking(move || read_rewards(&frame)).await;
    let ocr_ms = t1.elapsed().as_millis() as i64;
    let matches = match matches {
        Ok(Ok(m)) => m,
        Ok(Err(e)) => return fail(e, capture_ms),
        Err(e) => return fail(format!("ocr task: {e}"), capture_ms),
    };
    // The step between "frame captured" and the box appearing — log it so a
    // slow or empty read is diagnosable from the console (this was invisible
    // when debug-build inference silently took ~20s).
    tracing::info!(
        ocr_ms,
        matched = matches.len(),
        names = ?matches.iter().map(|m| m.display_name.as_str()).collect::<Vec<_>>(),
        "relic_ocr: rewards read"
    );

    let ocr_lines: Vec<String> = matches
        .iter()
        .map(|m| format!("{} ({:.2})", m.display_name, m.confidence))
        .collect();
    let (rewards, error) = match price_matches(&db, &matches) {
        Ok(r) if r.is_empty() => (
            Vec::new(),
            Some("no reward names recognized — is the reward screen up?".to_string()),
        ),
        Ok(r) => (r, None),
        Err(e) => (Vec::new(), Some(format!("pricing failed: {e}"))),
    };
    CrackCapture {
        captured_at,
        rewards,
        ocr_lines,
        capture_ms,
        ocr_ms,
        error,
    }
}

/// Run the pipeline, remember the result, show the HUD box top-left, push the
/// payload, and schedule the Rust-owned auto-hide (generation-counter pattern:
/// a newer trigger while visible restarts the on-screen duration). Shared by
/// the hotkey and the `trigger_relic_crack` command.
///
/// (An EE.log auto-detect watcher existed briefly and was removed: the game
/// buffers its log and flushed the reward-screen marker ~12s late in live
/// testing — after the choice window — so auto-detection can't be timely.
/// The hotkey is the trigger.)
#[cfg(feature = "relic-ocr")]
pub async fn capture_and_show(
    app: &tauri::AppHandle,
    state: &std::sync::Arc<crate::AppState>,
) -> CrackCapture {
    use std::sync::atomic::Ordering;
    use tauri::{Emitter, Manager};

    let duration = crate::db::settings::relic_ocr_prefs(&state.db)
        .map(|p| p.duration_secs.max(1) as u64)
        .unwrap_or(10);
    let capture = run_capture(state.db.clone()).await;
    *state.last_crack.lock() = Some(capture.clone());

    // This trigger now owns the overlay window.
    let gen = state.relic_overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
    crate::overlay::position_and_show(
        app,
        RELIC_OVERLAY_LABEL,
        crate::overlay::Anchor::TopRight,
        crate::overlay::MonitorPick::Primary,
    );
    let _ = app.emit_to(RELIC_OVERLAY_LABEL, "relic-overlay-show", &capture);
    let _ = app.emit("crack-capture", ());

    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(duration)).await;
        if state.relic_overlay_gen.load(Ordering::SeqCst) == gen {
            if let Some(w) = app.get_webview_window(RELIC_OVERLAY_LABEL) {
                let _ = w.hide();
            }
        }
    });
    capture
}

/// Hotkey entry point, shaped like `overlay::trigger`.
#[cfg(feature = "relic-ocr")]
pub fn trigger(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(state) = app.try_state::<std::sync::Arc<crate::AppState>>() else {
        return; // recovery mode
    };
    let state = state.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        capture_and_show(&app, &state).await;
    });
}

/// Show the HUD box with sample data — Settings' "Test overlay" button, so the
/// user can verify the box actually composites over the game without needing a
/// reward screen. Same show/auto-hide path as a real capture.
pub fn show_test_overlay(app: &tauri::AppHandle, state: &std::sync::Arc<crate::AppState>) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    let sample = CrackCapture {
        captured_at: chrono::Utc::now().to_rfc3339(),
        rewards: vec![
            CrackReward {
                reward_name: "Test Prime Barrel".into(),
                slug: None,
                plat: Some(42),
                ducats: Some(45),
                ducats_per_plat: Some(1.1),
                owned_qty: 2,
                wanted: false,
                set_slug: None,
                confidence: 1.0,
                best: true,
            },
            CrackReward {
                reward_name: "Test Prime Systems Blueprint".into(),
                slug: None,
                plat: Some(12),
                ducats: Some(65),
                ducats_per_plat: Some(5.4),
                owned_qty: 0,
                wanted: true,
                set_slug: Some("test_prime_set".into()),
                confidence: 1.0,
                best: false,
            },
            CrackReward {
                reward_name: "Forma Blueprint".into(),
                slug: None,
                plat: None,
                ducats: None,
                ducats_per_plat: None,
                owned_qty: 0,
                wanted: false,
                set_slug: None,
                confidence: 1.0,
                best: false,
            },
        ],
        ocr_lines: vec!["(test overlay — not a real capture)".into()],
        capture_ms: 0,
        ocr_ms: 0,
        error: None,
    };

    let duration = crate::db::settings::relic_ocr_prefs(&state.db)
        .map(|p| p.duration_secs.max(1) as u64)
        .unwrap_or(10);
    let gen = state.relic_overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
    crate::overlay::position_and_show(
        app,
        RELIC_OVERLAY_LABEL,
        crate::overlay::Anchor::TopRight,
        crate::overlay::MonitorPick::Primary,
    );
    let _ = app.emit_to(RELIC_OVERLAY_LABEL, "relic-overlay-show", &sample);

    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(duration)).await;
        if state.relic_overlay_gen.load(Ordering::SeqCst) == gen {
            if let Some(w) = tauri::Manager::get_webview_window(&app, RELIC_OVERLAY_LABEL) {
                let _ = w.hide();
            }
        }
    });
}

#[cfg(all(test, feature = "relic-ocr"))]
mod tests {
    use super::*;

    /// Full pipeline over the committed synthetic reward screen: 1080p frame,
    /// four cards, two titles wrapped onto a second line, plus a "SELECT A
    /// REWARD" header the matcher must reject. Real-game fixtures (themes,
    /// scaling) join this as they're captured; see testdata/README.md.
    #[test]
    fn synthetic_reward_screen_reads_all_four_cards() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/relic_ocr/testdata/synthetic_reward_screen_1080p.png"
        );
        let frame = image::open(path).expect("fixture loads").into_rgba8();
        let matches = read_rewards(&frame).expect("pipeline runs");
        let names: Vec<&str> = matches.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Akstiletto Prime Barrel",
                "Braton Prime Stock",
                "Forma Blueprint",
                "2X Forma Blueprint"
            ],
            "expected the four card titles, left to right"
        );
        for m in &matches {
            assert!(
                m.confidence >= matching::MIN_CONFIDENCE,
                "{} matched below the confidence floor",
                m.display_name
            );
        }
    }
}
