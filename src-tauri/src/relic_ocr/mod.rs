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

/// One detected card slot, left-to-right on screen: the raw column text and
/// the resolved reward (`None` = an unreadable card — seen, on the title row,
/// but nothing in the vocabulary cleared the confidence floor).
#[derive(Debug)]
pub struct CardSlot {
    pub text: String,
    pub matched: Option<matching::LineMatch>,
}

/// A squad shows at most 4 reward cards.
const MAX_CARDS: usize = 4;

/// Decide which columns are card slots. Reward-card titles share one text
/// row, so the topmost matched column anchors the title row; any column whose
/// top segment sits within ±1 glyph height of it is a card (matched or
/// unreadable). Everything else — the "SELECT A REWARD" header above, player
/// names below, a tooltip panel that formed its own column and matched the
/// hovered card's title again — is dropped. No matches at all → no slots
/// (the capture-level "no reward names recognized" error covers it).
fn card_slots(
    columns: &[layout::CardColumn],
    matches: Vec<Option<matching::LineMatch>>,
) -> Vec<CardSlot> {
    let anchor = columns
        .iter()
        .zip(&matches)
        .filter(|(_, m)| m.is_some())
        .map(|(c, _)| (c.top_center, c.top_height))
        .min_by_key(|&(center, _)| center);
    let Some((row, height)) = anchor else {
        return Vec::new();
    };
    let mut slots: Vec<CardSlot> = columns
        .iter()
        .zip(matches)
        // "Same row" allows up to a combined glyph-height of vertical slack
        // (anchor's height + the candidate's own) rather than just the
        // anchor's: real captures show title rows drifting ~1 line height
        // apart when one title wraps to two lines and others don't (the
        // wrapped title's box is taller, so its top edge sits higher) — a
        // tolerance keyed to the anchor alone clipped those genuine
        // same-row titles.
        .filter(|(c, _)| (c.top_center - row).abs() <= height + c.top_height)
        .map(|(c, m)| CardSlot {
            text: c.segments.join(" "),
            matched: m,
        })
        .collect();
    // More than 4 on-row columns means junk slipped in — shed unmatched
    // extras from the right before ever dropping a real match.
    while slots.len() > MAX_CARDS {
        match slots.iter().rposition(|s| s.matched.is_none()) {
            Some(i) => {
                slots.remove(i);
            }
            None => slots.truncate(MAX_CARDS),
        }
    }
    slots
}

/// Preprocessed band → OCR → card grouping → closed-vocabulary matching.
/// The file-based and live-capture paths both funnel through here. Returns the
/// raw column texts (`.0`, for sidecar diagnostics) alongside the resolved
/// card slots left→right (`.1`, ≤4) so a dropped card (seen but not matched)
/// is diagnosable from logs/debug artifacts.
#[cfg(feature = "relic-ocr")]
pub fn read_rewards(frame: &image::RgbaImage) -> Result<(Vec<String>, Vec<CardSlot>), String> {
    let band = preprocess::reward_band(frame);
    let words = ocr::words(&band)?;
    let columns = layout::group_into_card_columns(&words);
    let vocab = matching::build_vocab();
    let texts: Vec<Vec<String>> = columns.iter().map(|c| c.segments.clone()).collect();
    let matches = matching::resolve_columns(&vocab, &texts);
    let all_texts = texts.iter().map(|s| s.join(" ")).collect();
    Ok((all_texts, card_slots(&columns, matches)))
}

/// Price card slots through the same preload the Relics browser uses. Returns
/// one entry PER SLOT (unread ones included, zeroed) in on-screen order, and
/// marks the recommended pick: wanted → completes-set → plat → ducats.
pub fn price_matches(db: &Db, slots: &[CardSlot]) -> AppResult<Vec<CrackReward>> {
    let signals = wanted::crack_signals(db)?;
    let name_to_slug = catalog::name_slug_map(db)?;
    db.read(|c| {
        let ctx = relics::load_ctx(c, name_to_slug)?;
        let mut rewards: Vec<CrackReward> = slots
            .iter()
            .enumerate()
            .map(|(i, slot)| {
                let Some(m) = &slot.matched else {
                    return CrackReward {
                        reward_name: String::new(),
                        slug: None,
                        plat: None,
                        ducats: None,
                        ducats_per_plat: None,
                        owned_qty: 0,
                        wanted: false,
                        set_slug: None,
                        confidence: 0.0,
                        best: false,
                        card_index: i as u32,
                        unread: true,
                        pick_reason: None,
                    };
                };
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
                    card_index: i as u32,
                    unread: false,
                    pick_reason: None,
                }
            })
            .collect();
        apply_best(&mut rewards);
        Ok(rewards)
    })
}

/// Mark the recommended pick. Personal need beats plat: a watchlist/buy-list
/// part outranks a set-completing part outranks raw price; ties fall through
/// to plat then ducats. Unread slots and flagless priceless rewards (Forma
/// with no data) are never picked.
fn apply_best(rewards: &mut [CrackReward]) {
    let best = rewards
        .iter()
        .enumerate()
        .filter(|(_, r)| !r.unread && (r.wanted || r.set_slug.is_some() || r.plat.is_some()))
        .max_by_key(|&(_, r)| {
            let tier = if r.wanted {
                3
            } else if r.set_slug.is_some() {
                2
            } else {
                1
            };
            (tier, r.plat.unwrap_or(-1), r.ducats.unwrap_or(-1))
        })
        .map(|(i, _)| i);
    if let Some(i) = best {
        rewards[i].best = true;
        rewards[i].pick_reason = Some(
            if rewards[i].wanted {
                "wanted"
            } else if rewards[i].set_slug.is_some() {
                "set"
            } else {
                "price"
            }
            .to_string(),
        );
    }
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
    let (cards, slots, read_err) = match read {
        Ok(Ok((cards, slots))) => (cards, slots, None),
        Ok(Err(e)) => (Vec::new(), Vec::new(), Some(e)),
        Err(e) => (Vec::new(), Vec::new(), Some(format!("ocr task: {e}"))),
    };
    // The step between "frame captured" and the box appearing — log it so a
    // slow or empty read is diagnosable from the console (this was invisible
    // when debug-build inference silently took ~20s). Cards too: a card that
    // was seen but matched nothing is the interesting failure.
    tracing::info!(
        ocr_ms,
        slots = slots.len(),
        matched = slots.iter().filter(|s| s.matched.is_some()).count(),
        names = ?slots
            .iter()
            .map(|s| s.matched.as_ref().map(|m| m.display_name.as_str()).unwrap_or("?"))
            .collect::<Vec<_>>(),
        cards = ?cards,
        "relic_ocr: rewards read"
    );

    let ocr_lines: Vec<String> = slots
        .iter()
        .map(|s| match &s.matched {
            Some(m) => format!("{} ({:.2})", m.display_name, m.confidence),
            None => format!("? {}", s.text),
        })
        .collect();
    let (rewards, error) = match &read_err {
        Some(e) => (Vec::new(), Some(e.clone())),
        None => match price_matches(&db, &slots) {
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
            &slots,
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
    slots: &[CardSlot],
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
    out.push_str(&format!("\ncard slots ({}):\n", slots.len()));
    for (i, s) in slots.iter().enumerate() {
        match &s.matched {
            Some(m) => out.push_str(&format!(
                "  [{i}] {} ({:.2})\n",
                m.display_name, m.confidence
            )),
            None => out.push_str(&format!("  [{i}] ? {}\n", s.text)),
        }
    }
    if let Some(e) = error {
        out.push_str(&format!("\nerror: {e}\n"));
    }
    out
}

/// How many captures survive in the debug dir (the newest in the unsuffixed
/// `last-*` slot, older ones shifted to `-2`/`-3`/`-4`).
const DEBUG_KEEP: u32 = 4;

/// Shift previous captures down one slot (`last-frame.png` → `last-frame-2.png`
/// → … dropped past [`DEBUG_KEEP`]) so the newest write lands in the unsuffixed
/// slot but recent history survives: the 2026-07-15 fused-titles frame was
/// overwritten by the very next crack before it could be pulled as a fixture.
pub fn rotate_debug_slots(dir: &std::path::Path) {
    for base in ["last-frame.png", "last-capture.txt"] {
        let (stem, ext) = base.split_once('.').expect("slot names have extensions");
        for i in (1..DEBUG_KEEP).rev() {
            let from = if i == 1 {
                dir.join(base)
            } else {
                dir.join(format!("{stem}-{i}.{ext}"))
            };
            let _ = std::fs::rename(from, dir.join(format!("{stem}-{}.{ext}", i + 1)));
        }
    }
}

/// Write the frame + sidecar to the debug dir on a blocking thread (PNG encode
/// is not free; the box is already on screen when this runs). The newest
/// capture always lands in `last-*`; [`rotate_debug_slots`] keeps a short
/// history behind it.
#[cfg(feature = "relic-ocr")]
fn write_debug_artifacts(dir: std::path::PathBuf, frame: image::RgbaImage, sidecar: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let write = || -> Result<(), String> {
            std::fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
            rotate_debug_slots(&dir);
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
/// Smart re-press: a re-trigger always re-runs the capture (a re-press
/// usually means the box is wrong or partial — live 2026-07-15 a 1-of-4 read
/// was re-pressed 18 times to no effect), but while the box is visible with a
/// *successful* capture the fresh result only replaces it when it succeeds
/// too — once the reward screen is gone a re-press must not wipe good results
/// with "no reward names recognized" (that failure keeps the old box and just
/// resets the auto-hide timer).
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

    let debug_dir = app
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("relic-ocr-debug"));
    let capture = run_capture(state.db.clone(), debug_dir).await;
    if shown_ok && capture.error.is_some() {
        tracing::info!("relic_ocr: re-capture failed while showing good results — keeping them");
        let gen = state.relic_overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_auto_hide(app, state, gen, duration);
        return state.last_crack.lock().clone().expect("checked above");
    }
    *state.last_crack.lock() = Some(capture.clone());
    if capture.rewards.iter().any(|r| r.unread) {
        refresh_vocab_if_stale(state);
    }

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

/// An unreadable card right after a Prime release usually means the relic
/// tables predate the new items. If the last WFCD sync is older than 6h,
/// refresh once per app run in the background — the overlay is not updated
/// retroactively, but the (documented) Alt+T re-press re-OCRs and matches.
const VOCAB_REFRESH_MAX_AGE_HOURS: i64 = 6;

#[cfg(feature = "relic-ocr")]
fn refresh_vocab_if_stale(state: &std::sync::Arc<crate::AppState>) {
    use std::sync::atomic::Ordering;

    let stale = crate::db::meta::get(&state.db, crate::db::meta::KEY_LAST_RELIC_SYNC)
        .ok()
        .flatten()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|t| {
            chrono::Utc::now().signed_duration_since(t).num_hours() >= VOCAB_REFRESH_MAX_AGE_HOURS
        })
        .unwrap_or(true);
    if !stale || state.relic_vocab_refresh.swap(true, Ordering::SeqCst) {
        return;
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        tracing::info!("relic_ocr: unread card + stale relic data — refreshing vocab from WFCD");
        let _ = crate::db::relic_data::refresh(&db).await;
    });
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
                plat: Some(4),
                ducats: Some(45),
                ducats_per_plat: Some(11.3),
                owned_qty: 3,
                wanted: false,
                set_slug: None,
                confidence: 1.0,
                best: false,
                card_index: 0,
                unread: false,
                pick_reason: None,
            },
            CrackReward {
                reward_name: "Test Prime Systems Blueprint".into(),
                slug: None,
                plat: Some(38),
                ducats: Some(65),
                ducats_per_plat: Some(1.7),
                owned_qty: 0,
                wanted: true,
                set_slug: Some("test_prime_set".into()),
                confidence: 1.0,
                best: true,
                card_index: 1,
                unread: false,
                pick_reason: Some("wanted".into()),
            },
            CrackReward {
                reward_name: "Test Prime Barrel".into(),
                slug: None,
                plat: Some(4),
                ducats: Some(45),
                ducats_per_plat: Some(11.3),
                owned_qty: 3,
                wanted: false,
                set_slug: None,
                confidence: 1.0,
                best: false,
                card_index: 2,
                unread: false,
                pick_reason: None,
            },
            CrackReward {
                reward_name: String::new(),
                slug: None,
                plat: None,
                ducats: None,
                ducats_per_plat: None,
                owned_qty: 0,
                wanted: false,
                set_slug: None,
                confidence: 0.0,
                best: false,
                card_index: 3,
                unread: true,
                pick_reason: None,
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
mod pick_tests {
    use super::*;
    use crate::types::CrackReward;

    fn reward(
        name: &str,
        plat: Option<i64>,
        ducats: Option<i64>,
        wanted: bool,
        set: bool,
    ) -> CrackReward {
        CrackReward {
            reward_name: name.to_string(),
            slug: None,
            plat,
            ducats,
            ducats_per_plat: None,
            owned_qty: 0,
            wanted,
            set_slug: set.then(|| "some_set".to_string()),
            confidence: 0.9,
            best: false,
            card_index: 0,
            unread: false,
            pick_reason: None,
        }
    }

    fn best_of(mut rs: Vec<CrackReward>) -> (usize, Option<String>) {
        apply_best(&mut rs);
        let i = rs.iter().position(|r| r.best).expect("a pick exists");
        (i, rs[i].pick_reason.clone())
    }

    #[test]
    fn wanted_beats_plat() {
        let (i, reason) = best_of(vec![
            reward("pricey", Some(80), Some(100), false, false),
            reward("wanted", Some(4), Some(45), true, false),
        ]);
        assert_eq!((i, reason.as_deref()), (1, Some("wanted")));
    }

    #[test]
    fn set_beats_plat_but_not_wanted() {
        let (i, reason) = best_of(vec![
            reward("set", Some(4), None, false, true),
            reward("pricey", Some(80), None, false, false),
            reward("wanted", Some(2), None, true, false),
        ]);
        assert_eq!((i, reason.as_deref()), (2, Some("wanted")));
        let (i, reason) = best_of(vec![
            reward("set", Some(4), None, false, true),
            reward("pricey", Some(80), None, false, false),
        ]);
        assert_eq!((i, reason.as_deref()), (0, Some("set")));
    }

    #[test]
    fn plat_wins_with_no_flags_ducats_break_ties() {
        let (i, reason) = best_of(vec![
            reward("a", Some(10), Some(45), false, false),
            reward("b", Some(10), Some(65), false, false),
            reward("c", Some(4), Some(100), false, false),
        ]);
        assert_eq!((i, reason.as_deref()), (1, Some("price")));
    }

    #[test]
    fn two_wanted_fall_through_to_plat() {
        let (i, reason) = best_of(vec![
            reward("wanted-cheap", Some(4), None, true, false),
            reward("wanted-pricey", Some(30), None, true, false),
        ]);
        assert_eq!((i, reason.as_deref()), (1, Some("wanted")));
    }

    #[test]
    fn unread_and_flagless_priceless_never_win() {
        let mut rs = vec![
            reward("forma", None, None, false, false),
            CrackReward {
                unread: true,
                ..reward("", None, None, false, false)
            },
        ];
        apply_best(&mut rs);
        assert!(rs.iter().all(|r| !r.best), "no eligible pick → no best");
    }
}

#[cfg(test)]
mod debug_slot_tests {
    use super::*;

    fn write(dir: &std::path::Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    fn read(dir: &std::path::Path, name: &str) -> Option<String> {
        std::fs::read_to_string(dir.join(name)).ok()
    }

    #[test]
    fn rotation_shifts_captures_and_drops_the_oldest() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        // Slots full: newest capture "A" plus history "B", "C", "D".
        write(dir, "last-frame.png", "A");
        write(dir, "last-frame-2.png", "B");
        write(dir, "last-frame-3.png", "C");
        write(dir, "last-frame-4.png", "D");
        write(dir, "last-capture.txt", "a");
        write(dir, "last-capture-2.txt", "b");

        rotate_debug_slots(dir);

        // Everything shifted one slot; "D" fell off; the unsuffixed slot is
        // free for the incoming capture.
        assert_eq!(read(dir, "last-frame.png"), None);
        assert_eq!(read(dir, "last-frame-2.png").as_deref(), Some("A"));
        assert_eq!(read(dir, "last-frame-3.png").as_deref(), Some("B"));
        assert_eq!(read(dir, "last-frame-4.png").as_deref(), Some("C"));
        assert_eq!(read(dir, "last-capture.txt"), None);
        assert_eq!(read(dir, "last-capture-2.txt").as_deref(), Some("a"));
        assert_eq!(read(dir, "last-capture-3.txt").as_deref(), Some("b"));
        assert_eq!(read(dir, "last-capture-4.txt"), None);
    }

    #[test]
    fn rotation_of_an_empty_or_missing_dir_is_fine() {
        let tmp = tempfile::tempdir().unwrap();
        rotate_debug_slots(tmp.path());
        rotate_debug_slots(&tmp.path().join("does-not-exist"));
    }
}

#[cfg(test)]
mod sidecar_tests {
    use super::*;

    #[test]
    fn sidecar_shows_seen_vs_slots_and_error() {
        let cards = vec![
            "AKSTILETTO PRIME BARREL".to_string(),
            "GARBLED TEXT NOISE".to_string(),
        ];
        let slots = vec![
            CardSlot {
                text: "AKSTILETTO PRIME BARREL".to_string(),
                matched: Some(matching::LineMatch {
                    display_name: "Akstiletto Prime Barrel".to_string(),
                    confidence: 0.93,
                }),
            },
            CardSlot {
                text: "GARBLED TEXT NOISE".to_string(),
                matched: None,
            },
        ];
        let s = debug_sidecar(
            "2026-07-15T00:00:00Z",
            "window",
            (2560, 1440),
            80,
            750,
            &cards,
            &slots,
            Some("boom"),
        );
        assert!(s.contains("cards seen (2):"));
        assert!(s.contains("card slots (2):"));
        assert!(s.contains("  [0] Akstiletto Prime Barrel (0.93)\n"));
        assert!(s.contains("  [1] ? GARBLED TEXT NOISE\n"));
        assert!(s.contains("error: boom"));
    }
}

#[cfg(test)]
mod card_slot_tests {
    use super::*;
    use crate::relic_ocr::layout::CardColumn;
    use crate::relic_ocr::matching::LineMatch;

    fn col(text: &str, top_center: i32) -> CardColumn {
        CardColumn {
            segments: vec![text.to_string()],
            top_center,
            top_height: 30,
        }
    }
    fn hit(name: &str) -> Option<LineMatch> {
        Some(LineMatch {
            display_name: name.to_string(),
            confidence: 0.9,
        })
    }

    #[test]
    fn unmatched_column_on_the_title_row_becomes_an_unread_slot() {
        let columns = vec![col("BRATON PRIME STOCK", 100), col("garbled £#!", 105)];
        let slots = card_slots(&columns, vec![hit("Braton Prime Stock"), None]);
        assert_eq!(slots.len(), 2);
        assert!(slots[0].matched.is_some());
        assert!(
            slots[1].matched.is_none(),
            "same-row unmatched column = unread card"
        );
    }

    #[test]
    fn off_row_junk_is_dropped_not_a_slot() {
        // The screen header floats far above; a squadmate row far below.
        let columns = vec![
            col("SELECT A REWARD", 10),
            col("BRATON PRIME STOCK", 100),
            col("Pakman_56", 300),
        ];
        let slots = card_slots(&columns, vec![None, hit("Braton Prime Stock"), None]);
        assert_eq!(slots.len(), 1);
        assert_eq!(
            slots[0].matched.as_ref().unwrap().display_name,
            "Braton Prime Stock"
        );
    }

    #[test]
    fn matched_tooltip_column_below_the_title_row_is_dropped() {
        // A tooltip panel that formed its own column CAN match the title text;
        // its top sits well below the real title row and must not become a
        // fifth/duplicate card.
        let columns = vec![
            col("BRATON PRIME STOCK", 100),
            col("BRATON PRIME STOCK", 260), // tooltip header, own column
        ];
        let slots = card_slots(
            &columns,
            vec![hit("Braton Prime Stock"), hit("Braton Prime Stock")],
        );
        assert_eq!(slots.len(), 1);
    }

    #[test]
    fn no_matches_means_no_slots() {
        let columns = vec![col("SELECT A REWARD", 10)];
        assert!(card_slots(&columns, vec![None]).is_empty());
    }

    #[test]
    fn more_than_four_slots_drop_unmatched_extras_first() {
        let columns = vec![
            col("A PRIME BARREL", 100),
            col("junk on row", 101),
            col("B PRIME STOCK", 102),
            col("C PRIME LINK", 103),
            col("D PRIME GRIP", 104),
        ];
        let slots = card_slots(
            &columns,
            vec![
                hit("Akstiletto Prime Barrel"),
                None,
                hit("Braton Prime Stock"),
                hit("Burston Prime Receiver"),
                hit("Dual Kamas Prime Blade"),
            ],
        );
        assert_eq!(slots.len(), 4);
        assert!(slots.iter().all(|s| s.matched.is_some()));
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
        let (cards, slots) = read_rewards(&frame).expect("pipeline runs");
        println!("cards seen ({}):", cards.len());
        for c in &cards {
            println!("  {c}");
        }
        println!("card slots ({}):", slots.len());
        for s in &slots {
            match &s.matched {
                Some(m) => println!("  {} ({:.2})", m.display_name, m.confidence),
                None => println!("  ? {}", s.text),
            }
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
        let columns = layout::group_into_card_columns(&words);
        let texts: Vec<Vec<String>> = columns.iter().map(|c| c.segments.clone()).collect();
        let matches = matching::resolve_columns(&matching::build_vocab(), &texts);
        let slots = card_slots(&columns, matches);
        let names: Vec<Option<&str>> = slots
            .iter()
            .map(|s| s.matched.as_ref().map(|m| m.display_name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                Some("Paris Prime String"),
                Some("Dual Zoren Prime Handle"),
                Some("Voruna Prime Neuroptics Blueprint"),
                Some("Bronco Prime Barrel")
            ],
            "expected all four card slots matched, left to right"
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
        let (_cards, slots) = read_rewards(&frame).expect("pipeline runs");
        let names: Vec<Option<&str>> = slots
            .iter()
            .map(|s| s.matched.as_ref().map(|m| m.display_name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                Some("Akstiletto Prime Barrel"),
                Some("Braton Prime Stock"),
                Some("Forma Blueprint"),
                Some("2X Forma Blueprint")
            ],
            "expected the four card slots, left to right"
        );
        for s in &slots {
            let m = s.matched.as_ref().unwrap();
            assert!(m.confidence >= matching::MIN_CONFIDENCE);
        }
    }
}
