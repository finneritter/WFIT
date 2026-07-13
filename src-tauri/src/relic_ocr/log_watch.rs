//! EE.log auto-detect (feature `relic-ocr`, pref `auto_detect`): tail the
//! game's engine log and fire the capture pipeline when the relic reward
//! screen appears — no hotkey press needed.
//!
//! Read-only file tail of a plain text log; the same mechanism WFInfo uses.
//! Trigger lines (verified against WFInfo's committed EE.log examples):
//! `Script [Info]: Pause countdown done` and `Script [Info]: Got rewards`
//! both mark the moment the reward choices display.
//!
//! The log is recreated per game session and only ever appended to within
//! one, so the tail keeps a byte offset and rewinds to the start whenever the
//! file shrinks. Watcher lifecycle is generation-counted (like the overlay
//! auto-hide): the prefs setter bumps `log_watch_gen`, every loop tick checks
//! its generation is still current, and a stale watcher exits on its next
//! tick — no join handles to track.

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::Ordering;

/// Substrings that mark "the reward screen is up" (see module docs).
const REWARD_MARKERS: [&str; 2] = ["Pause countdown done", "Got rewards"];

/// One trigger per reward screen: both markers land within milliseconds, and
/// consecutive relic openings are at least a mission-round apart.
const DEBOUNCE: std::time::Duration = std::time::Duration::from_secs(8);

const POLL: std::time::Duration = std::time::Duration::from_millis(500);

/// Does a chunk of appended log text contain a reward-screen marker?
fn has_marker(chunk: &str) -> bool {
    REWARD_MARKERS.iter().any(|m| chunk.contains(m))
}

/// Locate EE.log. Windows: the game writes under %LOCALAPPDATA%. Linux: the
/// game runs under Proton, so the log lives inside the Steam library's wine
/// prefix — scan the default Steam roots plus every library listed in
/// `libraryfolders.vdf` (paths appear as tab-separated `"path" "/mnt/games"` lines).
pub fn find_log() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var_os("LOCALAPPDATA")?;
        let p = PathBuf::from(local).join("Warframe").join("EE.log");
        return p.exists().then_some(p);
    }
    #[cfg(not(target_os = "windows"))]
    {
        const PFX_TAIL: &str =
            "steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log";
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        let mut roots = vec![
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"), // flatpak
        ];
        // Extra libraries (games on another drive).
        for root in roots.clone() {
            let vdf = root.join("steamapps/libraryfolders.vdf");
            if let Ok(text) = std::fs::read_to_string(vdf) {
                roots.extend(parse_library_paths(&text));
            }
        }
        roots
            .into_iter()
            .map(|r| r.join(PFX_TAIL))
            .find(|p| p.exists())
    }
}

/// Pull the quoted values of `"path"` keys out of a libraryfolders.vdf.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn parse_library_paths(vdf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let mut parts = line.trim().split('"').filter(|s| !s.trim().is_empty());
        if parts.next() == Some("path") {
            if let Some(p) = parts.next() {
                out.push(PathBuf::from(p));
            }
        }
    }
    out
}

/// Tail state: read whatever was appended since the last poll, rewinding when
/// the file was recreated (its length shrank).
struct Tail {
    path: PathBuf,
    offset: u64,
}

impl Tail {
    /// Start at the file's current end — everything before the watcher
    /// started is history, not a reward screen that's up right now.
    fn new(path: PathBuf) -> Tail {
        let offset = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Tail { path, offset }
    }

    /// Appended-since-last-poll text (lossy UTF-8 — the log is ASCII-ish but
    /// player names can be anything).
    fn read_new(&mut self) -> Option<String> {
        let len = std::fs::metadata(&self.path).ok()?.len();
        if len < self.offset {
            self.offset = 0; // recreated (new game session) — start over
        }
        if len == self.offset {
            return None;
        }
        let mut f = std::fs::File::open(&self.path).ok()?;
        f.seek(SeekFrom::Start(self.offset)).ok()?;
        let mut buf = Vec::with_capacity((len - self.offset) as usize);
        f.read_to_end(&mut buf).ok()?;
        self.offset = len;
        Some(String::from_utf8_lossy(&buf).into_owned())
    }
}

/// Start/stop the watcher to match the persisted prefs. Called at startup and
/// from the prefs setter. Always bumps the generation (stopping any previous
/// watcher); spawns a new one only when `enabled && auto_detect`.
pub fn apply(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(state) = app.try_state::<std::sync::Arc<crate::AppState>>() else {
        return;
    };
    let state = state.inner().clone();
    let gen = state.log_watch_gen.fetch_add(1, Ordering::SeqCst) + 1;

    let prefs = crate::db::settings::relic_ocr_prefs(&state.db).unwrap_or_default();
    if !(prefs.enabled && prefs.auto_detect) {
        return; // the bump above already retires any running watcher
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tail: Option<Tail> = None;
        let mut last_trigger: Option<std::time::Instant> = None;
        tracing::info!("relic_ocr: EE.log watcher started");
        loop {
            tokio::time::sleep(POLL).await;
            if state.log_watch_gen.load(Ordering::SeqCst) != gen {
                tracing::info!("relic_ocr: EE.log watcher retired");
                return;
            }
            // (Re)locate the log lazily — the game may start after the app.
            if !tail.as_ref().is_some_and(|t| t.path.exists()) {
                tail = find_log().map(Tail::new);
                if tail.is_none() {
                    // Nothing to tail; ease off while the game isn't running.
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }
            }
            let Some(chunk) = tail.as_mut().and_then(Tail::read_new) else {
                continue;
            };
            if !has_marker(&chunk) {
                continue;
            }
            if last_trigger.is_some_and(|t| t.elapsed() < DEBOUNCE) {
                continue;
            }
            last_trigger = Some(std::time::Instant::now());
            tracing::info!("relic_ocr: reward screen detected in EE.log");
            super::trigger(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn markers_match_the_wfinfo_documented_lines() {
        assert!(has_marker("860.258 Script [Info]: Got rewards"));
        assert!(has_marker("525.250 Script [Info]: Pause countdown done"));
        assert!(!has_marker(
            "859.832 Script [Info]: Relic rewards initialized"
        ));
        assert!(!has_marker(
            "520.251 Sys [Info]: Created /Lotus/Interface/ProjectionRewardChoice.swf"
        ));
    }

    #[test]
    fn tail_reads_only_appended_text_and_survives_truncation() {
        let dir = std::env::temp_dir().join(format!("wfit-logwatch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("EE.log");
        std::fs::write(&path, "old session line\n").unwrap();

        let mut tail = Tail::new(path.clone());
        // Nothing new yet — and the pre-existing content is never surfaced.
        assert!(tail.read_new().is_none());

        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(f, "1.0 Script [Info]: Got rewards").unwrap();
        drop(f);
        assert!(has_marker(&tail.read_new().unwrap()));
        assert!(tail.read_new().is_none());

        // Game restart: the log is recreated smaller → tail rewinds to start.
        std::fs::write(&path, "fresh\n").unwrap();
        assert_eq!(tail.read_new().unwrap(), "fresh\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Environment-dependent (needs Steam + Warframe installed) — opt-in:
    /// `cargo test --features relic-ocr find_real_log -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn find_real_log() {
        println!("found: {:?}", find_log());
        assert!(
            find_log().is_some(),
            "expected a real EE.log on this system"
        );
    }

    #[test]
    fn library_vdf_paths_parse() {
        let vdf = r#"
"libraryfolders"
{
    "0"
    {
        "path"		"/home/user/.local/share/Steam"
    }
    "1"
    {
        "path"		"/mnt/games/SteamLibrary"
        "label"		""
    }
}
"#;
        let paths = parse_library_paths(vdf);
        assert_eq!(
            paths,
            [
                PathBuf::from("/home/user/.local/share/Steam"),
                PathBuf::from("/mnt/games/SteamLibrary")
            ]
        );
    }
}
