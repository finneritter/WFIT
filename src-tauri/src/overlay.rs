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
//! shortcuts go through X11 `XGrabKey`, unreliable on native Wayland. On
//! Windows, no always-on-top window composites over EXCLUSIVE-fullscreen —
//! Borderless/Windowed Fullscreen works. On Linux/KWin, plain always-on-top
//! loses even to a *focused borderless-fullscreen* window (ActiveLayer beats
//! AboveLayer), so `claim_osd_layer` re-types the overlay windows as KDE
//! On-Screen-Displays — the layer Plasma's own volume OSD uses, which
//! composites over fullscreen games.

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

        position_and_show(
            &app,
            OVERLAY_LABEL,
            Anchor::UpperMiddle,
            MonitorPick::UnderCursor,
        );
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

/// Where an overlay window sits on its monitor. Both overlay windows (Cascade
/// pill, relic-crack HUD box) share the positioning helper.
#[derive(Clone, Copy)]
pub enum Anchor {
    /// Centered horizontally, ~12% down — the Cascade pill.
    UpperMiddle,
    /// Pinned to the top-right corner (small inset) — the relic-crack box,
    /// clear of Warframe's own top-left mission info.
    TopRight,
}

/// Which monitor an overlay targets.
#[derive(Clone, Copy)]
pub enum MonitorPick {
    /// The monitor under the cursor ("where the user is looking") — the
    /// Cascade pill's historical behavior.
    UnderCursor,
    /// The primary monitor — the relic box must land where the game is, and
    /// mid-mission the cursor is no signal at all (Finn: it showed on the
    /// wrong screen). Falls back to cursor/current/first when the platform
    /// reports no primary (Wayland has no such concept; GDK may return None).
    Primary,
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

/// Position an overlay on its target monitor, make it click-through, and
/// show it. All math is in physical pixels, so mixed-DPI multi-monitor
/// placement stays correct without manual scale-factor handling.
pub fn position_and_show(app: &tauri::AppHandle, label: &str, anchor: Anchor, pick: MonitorPick) {
    let Some(win) = overlay_window(app, label) else {
        return;
    };

    // The monitor whose physical rect contains the cursor.
    let under_cursor = || {
        app.cursor_position().ok().and_then(|cur| {
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
    };
    let monitor = match pick {
        MonitorPick::UnderCursor => under_cursor(),
        MonitorPick::Primary => win.primary_monitor().ok().flatten().or_else(under_cursor),
    }
    .or_else(|| win.current_monitor().ok().flatten())
    .or_else(|| win.primary_monitor().ok().flatten())
    .or_else(|| {
        win.available_monitors()
            .ok()
            .and_then(|m| m.into_iter().next())
    });

    let pos = monitor.map(|m| {
        let size = m.size();
        let origin = m.position();
        let outer = win.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 360,
            height: 120,
        });
        match anchor {
            Anchor::UpperMiddle => (
                origin.x + (size.width as i32 - outer.width as i32) / 2,
                origin.y + size.height as i32 / 8, // ~12% down
            ),
            Anchor::TopRight => (
                origin.x + size.width as i32 - outer.width as i32 - size.width as i32 / 64,
                origin.y + size.height as i32 / 36, // small inset, scales with res
            ),
        }
    });
    // Position before show so the window doesn't flash at a stale spot…
    if let Some((x, y)) = pos {
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
    #[cfg(target_os = "linux")]
    claim_osd_layer(&win);
    // …and re-assert the anchor AFTER mapping: once the window carries the KDE
    // OSD type (claim_osd_layer), KWin's OSD placement policy centers it at
    // every map, discarding the pre-show position. A post-map move request
    // wins. (Verified live: without this, re-shows land horizontally centered.)
    if let Some((x, y)) = pos {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
    let _ = win.set_ignore_cursor_events(true);
}

/// KWin stacks a FOCUSED FULLSCREEN window (ActiveLayer, 5) above every
/// keep-above window (AboveLayer, 3) — so `alwaysOnTop` alone leaves both
/// overlays rendering UNDER the game whenever it's fullscreen and focused,
/// i.e. always while playing. Plasma's own volume/brightness OSDs float over
/// fullscreen games by carrying the KDE-specific On-Screen-Display window
/// type (OnScreenDisplayLayer, 8), so the overlays claim the same type on
/// their X11 window (we force XWayland via GDK_BACKEND=x11 in main()).
/// Verified live on KWin 6: the property change re-layers a mapped window
/// immediately, no remap needed. Non-KDE WMs skip the unknown KDE atom and
/// fall back to NOTIFICATION (above normal windows in most WMs); keep-above
/// still applies regardless. Must run after show() — the GDK window only
/// exists once realized — and on the main thread (GTK is not thread-safe).
#[cfg(target_os = "linux")]
fn claim_osd_layer(win: &tauri::WebviewWindow) {
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        use gtk::prelude::*;
        let Ok(gtk_win) = w.gtk_window() else { return };
        let Some(gdk_win) = gtk_win.window() else {
            return;
        };
        // X11/XWayland only — on a native-Wayland GDK (user overrode
        // GDK_BACKEND) there is no X property to set and gdk would warn.
        if !gdk_win.display().type_().name().starts_with("GdkX11") {
            return;
        }
        // With type ATOM, gdk_property_change expects the data as GdkAtoms
        // (it translates them to X atoms per-entry); ULongs is the matching
        // ChangeData shape since GdkAtom is pointer-sized.
        let types = [
            gdk::Atom::intern("_KDE_NET_WM_WINDOW_TYPE_ON_SCREEN_DISPLAY").value()
                as std::os::raw::c_ulong,
            gdk::Atom::intern("_NET_WM_WINDOW_TYPE_NOTIFICATION").value() as std::os::raw::c_ulong,
        ];
        gdk::property_change(
            &gdk_win,
            &gdk::Atom::intern("_NET_WM_WINDOW_TYPE"),
            &gdk::Atom::intern("ATOM"),
            32,
            gdk::PropMode::Replace,
            gdk::ChangeData::ULongs(&types),
        );
    });
}
