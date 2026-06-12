//! Process detection for the running Warframe client (Windows). Enumerates the
//! process list via the ToolHelp snapshot API — listing only, never memory.

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Find the pid of a running Warframe client, if any. The native game client is
/// `Warframe.x64.exe`; `Warframe.exe` is the launcher (kept as a fallback — it just
/// won't hold a session, so a scan there reports "not logged in").
pub fn find_pid() -> Option<u32> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut found = None;
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                if is_warframe_exe(&wide_to_string(&entry.szExeFile)) {
                    found = Some(entry.th32ProcessID);
                    break;
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        found
    }
}

fn is_warframe_exe(name: &str) -> bool {
    name.eq_ignore_ascii_case("Warframe.x64.exe") || name.eq_ignore_ascii_case("Warframe.exe")
}

/// Decode a NUL-terminated UTF-16 fixed buffer (PROCESSENTRY32W.szExeFile).
fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(test)]
mod tests {
    use super::is_warframe_exe;

    #[test]
    fn matches_client_and_launcher_case_insensitively() {
        assert!(is_warframe_exe("Warframe.x64.exe"));
        assert!(is_warframe_exe("warframe.x64.EXE"));
        assert!(is_warframe_exe("Warframe.exe"));
        assert!(!is_warframe_exe("steam.exe"));
        assert!(!is_warframe_exe(""));
    }
}
