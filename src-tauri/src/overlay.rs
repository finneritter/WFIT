//! The Void Cascade HUD overlay: a global-hotkey-triggered, always-on-top pill
//! that answers "is Cascade up?" without leaving the game. Isolated like the
//! tray code — it owns the global shortcut (re)registration and the overlay
//! window's show/position/auto-hide lifecycle.
//!
//! Timing is Rust-owned on purpose: WebKitGTK throttles webview timers while a
//! window is hidden/unfocused (the exact "overlay up over a fullscreen game"
//! case), so a frontend `setTimeout` for auto-hide could strand the pill. A
//! `tokio::time::sleep` guarded by a generation counter can't.
//!
//! Platform caveats (surfaced to the user in Settings, not hidden): global
//! shortcuts go through X11 `XGrabKey`, unreliable on native Wayland; and no
//! always-on-top window composites over EXCLUSIVE-fullscreen on any OS —
//! Borderless/Windowed Fullscreen works.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{Emitter, Manager, PhysicalPosition};

use crate::AppState;

const OVERLAY_LABEL: &str = "overlay";

// Hotkey (re)registration lives in `crate::hotkeys` — shared with the relic
// capture, since the global-shortcut plugin has one flat registration set and
// one handler for the whole app.

/// Hotkey pressed: compute the cascade status from the cached worldstate, show
/// the overlay upper-middle on the monitor under the cursor, push the payload,
/// and auto-hide after the configured duration. A re-press while visible bumps
/// the generation counter, so the older sleep no-ops and this press both
/// re-shows and restarts the timer — "refresh & restart" falls out for free.
pub fn trigger(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return; // recovery mode — no AppState, nothing to show
    };
    let state = state.inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let prefs = crate::db::settings::overlay_prefs(&state.db).unwrap_or_default();
        // Cached worldstate (≤3min fresh via the refresher); never blocks on the network.
        let status = state
            .worldstate
            .get()
            .await
            .map(|ws| crate::worldstate::cascade_status(&ws.fissures))
            .unwrap_or_default();

        // This press now owns the window.
        let gen = state.overlay_gen.fetch_add(1, Ordering::SeqCst) + 1;

        position_and_show(&app, OVERLAY_LABEL, Anchor::UpperMiddle);
        let _ = app.emit_to(OVERLAY_LABEL, "overlay-show", &status);

        let secs = prefs.duration_secs.max(1) as u64;
        tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
        // Only hide if no newer press superseded us.
        if state.overlay_gen.load(Ordering::SeqCst) == gen {
            if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
                let _ = w.hide();
            }
        }
    });
}

/// Where an overlay window sits on the monitor under the cursor. Both overlay
/// windows (Cascade pill, relic-crack HUD box) share the positioning helper.
#[derive(Clone, Copy)]
pub enum Anchor {
    /// Centered horizontally, ~12% down — the Cascade pill.
    UpperMiddle,
    /// Pinned to the top-left corner (small inset) — the relic-crack box sits
    /// where Warframe puts its own mission info, reading like game HUD.
    TopLeft,
}

/// An overlay window by label — recreated from its tauri.conf.json definition
/// when the WM destroyed it anyway (issue #3: a force-closed overlay must not
/// kill the hotkey for the rest of the session). CloseRequested is intercepted
/// in lib.rs (hide, not destroy), so this only fires on hard kills that bypass
/// the close protocol. Each overlay webview self-fetches its payload on mount,
/// so a rebuilt window renders correctly even if it misses this press's emit.
pub fn overlay_window(app: &tauri::AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(label) {
        return Some(w);
    }
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)?
        .clone();
    match tauri::WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build()) {
        Ok(w) => {
            tracing::info!(
                label,
                "overlay: window was destroyed — recreated from config"
            );
            Some(w)
        }
        Err(e) => {
            tracing::warn!(error = %e, label, "overlay: failed to recreate destroyed window");
            None
        }
    }
}

/// Position an overlay on the monitor under the cursor (falling back to the
/// window's current monitor, then the primary), make it click-through, and
/// show it. All math is in physical pixels, so mixed-DPI multi-monitor
/// placement stays correct without manual scale-factor handling.
pub fn position_and_show(app: &tauri::AppHandle, label: &str, anchor: Anchor) {
    let Some(win) = overlay_window(app, label) else {
        return;
    };

    // Pick the monitor whose physical rect contains the cursor — "where the user
    // is looking", i.e. usually the game's monitor.
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cur| {
            win.available_monitors().ok().and_then(|mons| {
                mons.into_iter().find(|m| {
                    let p = m.position();
                    let s = m.size();
                    let (cx, cy) = (cur.x as i32, cur.y as i32);
                    cx >= p.x
                        && cx < p.x + s.width as i32
                        && cy >= p.y
                        && cy < p.y + s.height as i32
                })
            })
        })
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());

    if let Some(m) = monitor {
        let size = m.size();
        let origin = m.position();
        let outer = win.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 360,
            height: 120,
        });
        let (x, y) = match anchor {
            Anchor::UpperMiddle => (
                origin.x + (size.width as i32 - outer.width as i32) / 2,
                origin.y + size.height as i32 / 8, // ~12% down
            ),
            Anchor::TopLeft => (
                origin.x + size.width as i32 / 64, // small inset, scales with res
                origin.y + size.height as i32 / 36,
            ),
        };
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }

    // Show BEFORE enabling click-through. On Linux, set_ignore_cursor_events(true)
    // calls `gdk_window().unwrap()` inside tao's event loop (tao
    // platform_impl/linux/event_loop.rs ~457); the GDK window only exists once the
    // widget is realized. Our overlay is created `visible:false` (never realized),
    // so toggling click-through first would unwrap a None and abort the whole
    // process (the panic is inside a C callback that can't unwind). show() posts
    // Visible(true) → show_all() (synchronous realize) ahead of the click-through
    // request on the same FIFO event-loop channel, so the GDK window is live by
    // the time click-through is applied.
    let _ = win.show();
    let _ = win.set_ignore_cursor_events(true);
}
