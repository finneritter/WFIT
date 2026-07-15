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
/// The file-based and live-capture paths both funnel through here. Returns the
/// raw card texts alongside the matches so a dropped card (seen but not
/// matched) is diagnosable from logs/debug artifacts.
#[cfg(feature = "relic-ocr")]
pub fn read_rewards(
    frame: &image::RgbaImage,
) -> Result<(Vec<String>, Vec<matching::LineMatch>), String> {
    let band = preprocess::reward_band(frame);
    let words = ocr::words(&band)?;
    let card_segments = layout::group_into_card_segments(&words);
    let vocab = matching::build_vocab();
    let matches = matching::match_cards(&vocab, &card_segments, 4);
    let cards = card_segments.into_iter().map(|s| s.join(" ")).collect();
    Ok((cards, matches))
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
///
/// When `debug_dir` is set, the raw frame and a sidecar of what was seen vs
/// matched are written there (overwrite-in-place, off the hot path) — the live
/// 2-of-4-cards incident was undiagnosable without the frame.
#[cfg(feature = "relic-ocr")]
pub async fn run_capture(db: Db, debug_dir: Option<std::path::PathBuf>) -> CrackCapture {
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
    let ocr_frame = frame.clone();
    let read = tauri::async_runtime::spawn_blocking(move || read_rewards(&ocr_frame)).await;
    let ocr_ms = t1.elapsed().as_millis() as i64;
    let (cards, matches, read_err) = match read {
        Ok(Ok((cards, matches))) => (cards, matches, None),
        Ok(Err(e)) => (Vec::new(), Vec::new(), Some(e)),
        Err(e) => (Vec::new(), Vec::new(), Some(format!("ocr task: {e}"))),
    };
    // The step between "frame captured" and the box appearing — log it so a
    // slow or empty read is diagnosable from the console (this was invisible
    // when debug-build inference silently took ~20s). Cards too: a card that
    // was seen but matched nothing is the interesting failure.
    tracing::info!(
        ocr_ms,
        matched = matches.len(),
        names = ?matches.iter().map(|m| m.display_name.as_str()).collect::<Vec<_>>(),
        cards = ?cards,
        "relic_ocr: rewards read"
    );

    let ocr_lines: Vec<String> = matches
        .iter()
        .map(|m| format!("{} ({:.2})", m.display_name, m.confidence))
        .collect();
    let (rewards, error) = match &read_err {
        Some(e) => (Vec::new(), Some(e.clone())),
        None => match price_matches(&db, &matches) {
            Ok(r) if r.is_empty() => (
                Vec::new(),
                Some("no reward names recognized — is the reward screen up?".to_string()),
            ),
            Ok(r) => (r, None),
            Err(e) => (Vec::new(), Some(format!("pricing failed: {e}"))),
        },
    };
    if let Some(dir) = debug_dir {
        let sidecar = debug_sidecar(
            &captured_at,
            path,
            frame.dimensions(),
            capture_ms,
            ocr_ms,
            &cards,
            &matches,
            error.as_deref(),
        );
        write_debug_artifacts(dir, frame, sidecar);
    }
    CrackCapture {
        captured_at,
        rewards,
        ocr_lines,
        capture_ms,
        ocr_ms,
        error,
    }
}

/// Human-readable record of one capture: what the pipeline saw (raw card
/// texts) vs what it matched. Pure formatting so it's testable without a
/// frame; pairs with the saved PNG in the debug dir.
#[allow(clippy::too_many_arguments)]
pub fn debug_sidecar(
    captured_at: &str,
    source: &str,
    dims: (u32, u32),
    capture_ms: i64,
    ocr_ms: i64,
    cards: &[String],
    matches: &[matching::LineMatch],
    error: Option<&str>,
) -> String {
    let mut out = format!(
        "captured_at: {captured_at}\nsource: {source}\nframe: {}x{}\ncapture_ms: {capture_ms}\nocr_ms: {ocr_ms}\n",
        dims.0, dims.1
    );
    out.push_str(&format!("\ncards seen ({}):\n", cards.len()));
    for c in cards {
        out.push_str(&format!("  {c}\n"));
    }
    out.push_str(&format!("\nmatched ({}):\n", matches.len()));
    for m in matches {
        out.push_str(&format!("  {} ({:.2})\n", m.display_name, m.confidence));
    }
    if let Some(e) = error {
        out.push_str(&format!("\nerror: {e}\n"));
    }
    out
}

/// Write the frame + sidecar to the debug dir on a blocking thread (PNG encode
/// is not free; the box is already on screen when this runs). Overwrites in
/// place — only the latest capture is kept.
#[cfg(feature = "relic-ocr")]
fn write_debug_artifacts(dir: std::path::PathBuf, frame: image::RgbaImage, sidecar: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let write = || -> Result<(), String> {
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
            frame
                .save(dir.join("last-frame.png"))
                .map_err(|e| format!("save frame: {e}"))?;
            std::fs::write(dir.join("last-capture.txt"), sidecar)
                .map_err(|e| format!("write sidecar: {e}"))
        };
        match write() {
            Ok(()) => tracing::info!(?dir, "relic_ocr: debug artifacts written"),
            Err(e) => tracing::warn!(error = %e, "relic_ocr: debug artifacts failed"),
        }
    });
}

/// Run the pipeline, remember the result, show the HUD box top-left, push the
/// payload, and schedule the Rust-owned auto-hide (generation-counter pattern:
/// a newer trigger while visible restarts the on-screen duration). Shared by
/// the hotkey and the `trigger_relic_crack` command.
///
/// Smart re-press: while the box is visible with a *successful* capture, a
/// re-trigger only resets the auto-hide timer — re-running OCR there could
/// only replace good results with "no reward names recognized" once the
/// reward screen is gone. Visible-with-error (pressed too early) or hidden
/// runs the full capture.
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

    let shown_ok = app
        .get_webview_window(RELIC_OVERLAY_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false))
        && state
            .last_crack
            .lock()
            .as_ref()
            .is_some_and(|c| c.error.is_none());
    if shown_ok {
        let last = state.last_crack.lock().clone().expect("checked above");
        tracing::info!("relic_ocr: re-trigger while visible — resetting auto-hide only");
        let gen = state.relic_overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_auto_hide(app, state, gen, duration);
        return last;
    }

    let debug_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("relic-ocr-debug"));
    let capture = run_capture(state.db.clone(), debug_dir).await;
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

    spawn_auto_hide(app, state, gen, duration);
    capture
}

/// Hide the HUD box after `duration` seconds unless a newer trigger has taken
/// ownership (generation counter bumped) in the meantime.
fn spawn_auto_hide(
    app: &tauri::AppHandle,
    state: &std::sync::Arc<crate::AppState>,
    gen: u64,
    duration: u64,
) {
    use std::sync::atomic::Ordering;

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

    spawn_auto_hide(app, state, gen, duration);
}

#[cfg(test)]
mod sidecar_tests {
    use super::*;

    #[test]
    fn sidecar_shows_seen_vs_matched_and_error() {
        let cards = vec![
            "AKSTILETTO PRIME BARREL".to_string(),
            "GARBLED TEXT NOISE".to_string(),
        ];
        let matches = vec![matching::LineMatch {
            display_name: "Akstiletto Prime Barrel".to_string(),
            confidence: 0.93,
        }];
        let s = debug_sidecar(
            "2026-07-15T00:00:00Z",
            "window",
            (2560, 1440),
            80,
            750,
            &cards,
            &matches,
            Some("boom"),
        );
        assert!(s.contains("source: window"));
        assert!(s.contains("frame: 2560x1440"));
        assert!(s.contains("cards seen (2):"));
        assert!(s.contains("  GARBLED TEXT NOISE\n"));
        assert!(s.contains("matched (1):"));
        assert!(s.contains("  Akstiletto Prime Barrel (0.93)\n"));
        assert!(s.contains("error: boom"));
    }
}

#[cfg(all(test, feature = "relic-ocr"))]
mod tests {
    use super::*;

    /// Ad-hoc pipeline run over any frame on disk:
    /// `WFIT_OCR_FRAME=/path/to/frame.png cargo test --features relic-ocr \
    ///    pipeline_reads_env_frame -- --ignored --nocapture`
    /// Set `WFIT_OCR_BAND_OUT=/path/out.png` to also dump the preprocessed
    /// band — how new testdata fixtures are made from debug frames.
    #[test]
    #[ignore]
    fn pipeline_reads_env_frame() {
        let path = std::env::var("WFIT_OCR_FRAME").expect("set WFIT_OCR_FRAME");
        let frame = image::open(&path).expect("frame loads").into_rgba8();
        if let Ok(out) = std::env::var("WFIT_OCR_BAND_OUT") {
            preprocess::reward_band(&frame)
                .save(&out)
                .expect("band saves");
            println!("band written to {out}");
        }
        let (cards, matches) = read_rewards(&frame).expect("pipeline runs");
        println!("cards seen ({}):", cards.len());
        for c in &cards {
            println!("  {c}");
        }
        println!("matched ({}):", matches.len());
        for m in &matches {
            println!("  {} ({:.2})", m.display_name, m.confidence);
        }
    }

    /// Real 1440p 4-player capture (2026-07-15, preprocessed band): the third
    /// card's title wraps onto two lines AND is hovered, so the game's tooltip
    /// panel + a squadmate name row merge into its layout column. Regression
    /// for the live "only some rewards detected" bug — whole-column matching
    /// drowned the title; segment-run matching must find all four.
    #[test]
    fn real_1440p_hovered_wrapped_title_reads_all_four_cards() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/relic_ocr/testdata/real_reward_screen_1440p_hover_band.png"
        );
        let band = image::open(path).expect("fixture loads").into_luma8();
        let words = ocr::words(&band).expect("ocr runs");
        let cards = layout::group_into_card_segments(&words);
        let matches = matching::match_cards(&matching::build_vocab(), &cards, 4);
        let names: Vec<&str> = matches.iter().map(|m| m.display_name.as_str()).collect();
        assert_eq!(
            names,
            [
                "Paris Prime String",
                "Dual Zoren Prime Handle",
                "Voruna Prime Neuroptics Blueprint",
                "Bronco Prime Barrel"
            ],
            "expected all four card titles, left to right"
        );
    }

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
        let (_cards, matches) = read_rewards(&frame).expect("pipeline runs");
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
