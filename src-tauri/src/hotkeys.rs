//! Shared global-hotkey registrar. Two features own global shortcuts (the
//! Cascade overlay and the relic-crack capture), and the plugin exposes ONE
//! handler plus a flat registration set — so registration must be centralized:
//! each feature's old `unregister_all()`-then-register approach would clobber
//! the other's grab, and the handler must route a fired shortcut to the right
//! trigger by comparing it against both persisted bindings.
//!
//! Same resilience contract as the original single-hotkey path: a failed grab
//! (combo already held, parse error, no Wayland grab) is logged, never fatal.

use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// (Re)register every enabled hotkey from the persisted prefs. Called at
/// startup and from both prefs setters, so rebinds take effect live.
pub fn apply_all(app: &tauri::AppHandle) {
    let Some(state) = tauri::Manager::try_state::<std::sync::Arc<crate::AppState>>(app) else {
        return; // recovery mode — no AppState, no hotkeys
    };
    let gs = app.global_shortcut();
    // Idempotent reset: drop whatever we registered last time before re-binding.
    if let Err(e) = gs.unregister_all() {
        tracing::warn!(error = %e, "hotkeys: failed to clear previous registrations");
    }

    let overlay = crate::db::settings::overlay_prefs(&state.db).unwrap_or_default();
    if overlay.enabled {
        register(app, &overlay.hotkey, "cascade overlay");
    }
    let relic = crate::db::settings::relic_ocr_prefs(&state.db).unwrap_or_default();
    if relic.enabled {
        register(app, &relic.hotkey, "relic capture");
    }
}

fn register(app: &tauri::AppHandle, hotkey: &str, what: &str) {
    let hotkey = hotkey.trim();
    if hotkey.is_empty() {
        return;
    }
    match app.global_shortcut().register(hotkey) {
        Ok(()) => tracing::info!(hotkey, what, "hotkey registered"),
        Err(e) => tracing::warn!(
            error = %e,
            hotkey,
            what,
            "hotkey registration failed (already grabbed / unparseable / no Wayland grab)"
        ),
    }
}

/// Route a fired shortcut to its feature by re-parsing the persisted bindings.
/// (The plugin hands us the `Shortcut`; comparing parsed values — not strings —
/// tolerates equivalent spellings like "alt+keyx" vs "Alt+KeyX".)
pub fn dispatch(app: &tauri::AppHandle, fired: &Shortcut) {
    let Some(state) = tauri::Manager::try_state::<std::sync::Arc<crate::AppState>>(app) else {
        return;
    };

    let overlay = crate::db::settings::overlay_prefs(&state.db).unwrap_or_default();
    if overlay.enabled && parses_to(&overlay.hotkey, fired) {
        crate::overlay::trigger(app);
        return;
    }

    #[cfg(feature = "relic-ocr")]
    {
        let relic = crate::db::settings::relic_ocr_prefs(&state.db).unwrap_or_default();
        if relic.enabled && parses_to(&relic.hotkey, fired) {
            crate::relic_ocr::trigger(app);
        }
    }
}

fn parses_to(binding: &str, fired: &Shortcut) -> bool {
    binding
        .trim()
        .parse::<Shortcut>()
        .is_ok_and(|b| &b == fired)
}
