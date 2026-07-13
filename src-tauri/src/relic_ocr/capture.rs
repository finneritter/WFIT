//! One-shot screen capture of the running game (feature `relic-ocr`).
//!
//! Window-first on both OSes via `xcap`: on Linux, Warframe under Proton is an
//! X11/XWayland client, and xcap's window capture goes through the X server
//! even in a Wayland session — a direct, promptless grab (the same mechanism
//! OBS "Window Capture (Xcomposite)" uses). On Windows it's the GDI path,
//! which works in Borderless/Windowed Fullscreen — the same windowing mode the
//! Cascade overlay already requires. Exclusive fullscreen defeats both; the
//! Settings copy documents Borderless.
//!
//! Fallback: the primary monitor (a Wayland-session monitor grab may route
//! through the portal and prompt — better than returning nothing, and the
//! Settings note explains the one-time consent if it appears).

use image::RgbaImage;

/// The game window must be identified precisely: WFIT's own main window is
/// titled "WFIT — Warframe Item Tracker", a browser tab about a wiki page also
/// carries "Warframe" in its title, and Steam's library page does too. The
/// game itself is unambiguous: its window title is exactly "Warframe", Proton
/// exposes the X11 WM_CLASS `steam_app_230410`, and the Windows process is
/// `Warframe.x64.exe` (xcap surfaces those as `app_name`).
fn is_game(title: &str, app_name: &str) -> bool {
    let title = title.trim().to_lowercase();
    let app = app_name.to_lowercase();
    title == "warframe" || app.contains("steam_app_230410") || app.contains("warframe.x64")
}

fn is_game_window(w: &xcap::Window) -> bool {
    is_game(
        &w.title().unwrap_or_default(),
        &w.app_name().unwrap_or_default(),
    )
}

/// Capture the game window, falling back to the primary monitor. Returns the
/// frame plus a short note of which path produced it (for diagnostics).
pub fn game_frame() -> Result<(RgbaImage, &'static str), String> {
    match xcap::Window::all() {
        Ok(windows) => {
            if let Some(win) = windows
                .iter()
                .filter(|w| !w.is_minimized().unwrap_or(false))
                .find(|w| is_game_window(w))
            {
                match win.capture_image() {
                    Ok(img) => return Ok((img, "window")),
                    Err(e) => {
                        tracing::warn!(error = %e, "relic_ocr: window capture failed, trying monitor");
                    }
                }
            } else {
                tracing::info!("relic_ocr: no Warframe window found, capturing monitor");
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "relic_ocr: window enumeration failed, trying monitor");
        }
    }
    let monitors = xcap::Monitor::all().map_err(|e| format!("list monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitors found".to_string())?;
    monitor
        .capture_image()
        .map(|img| (img, "monitor"))
        .map_err(|e| format!("monitor capture failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_identification_is_precise() {
        // The game, across platforms/launchers.
        assert!(is_game("Warframe", ""));
        assert!(is_game("warframe ", ""));
        assert!(is_game("", "steam_app_230410"));
        assert!(is_game("", "Warframe.x64.exe"));
        // Things that carry "Warframe" but are NOT the game: WFIT itself, a
        // browser tab, Steam's library page.
        assert!(!is_game("WFIT — Warframe Item Tracker", "wfit"));
        assert!(!is_game("Void Fissure - WARFRAME Wiki — Brave", "brave"));
        assert!(!is_game("Steam — Warframe", "steam"));
    }

    /// Grabs the real screen — environment-dependent, so opt-in:
    /// `cargo test --features relic-ocr live_capture -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_capture_smoke() {
        let t0 = std::time::Instant::now();
        let (frame, path) = game_frame().expect("capture something");
        println!(
            "captured {}x{} via {path} in {}ms",
            frame.width(),
            frame.height(),
            t0.elapsed().as_millis()
        );
        assert!(frame.width() > 100 && frame.height() > 100);
    }
}
