//! Process detection for the running Warframe client (Linux). Reads `/proc` only
//! — process listing, not memory. No external crates.

/// Find the pid of a running Warframe client, if any.
///
/// NOTE: `/proc/<pid>/comm` is truncated to 15 chars, so the real process name
/// `Warframe.x64.exe` (16 chars, run under Proton/Wine) shows up as
/// `Warframe.x64.ex`. Match both, plus a bare `Warframe`.
pub fn find_pid() -> Option<u32> {
    let dir = std::fs::read_dir("/proc").ok()?;
    for entry in dir.flatten() {
        let name = entry.file_name();
        let Some(pid_s) = name.to_str() else { continue };
        let Ok(pid) = pid_s.parse::<u32>() else { continue };
        if let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) {
            if is_warframe_comm(comm.trim()) {
                return Some(pid);
            }
        }
    }
    None
}

fn is_warframe_comm(comm: &str) -> bool {
    comm == "Warframe.x64.ex"   // 15-char truncation of Warframe.x64.exe
        || comm == "Warframe.x64.exe"
        || comm.eq_ignore_ascii_case("warframe")
}

/// The kernel's yama ptrace_scope (governs cross-process memory reads). `None`
/// when the file is absent (non-yama kernels — reads are unrestricted there).
/// 0 = any same-uid read; 1 = ancestor-only (a sibling read of the game is
/// blocked); 2 = admin-only; 3 = disabled.
pub fn ptrace_scope() -> Option<i32> {
    std::fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope")
        .ok()?
        .trim()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::is_warframe_comm;

    #[test]
    fn matches_truncated_and_full_names() {
        assert!(is_warframe_comm("Warframe.x64.ex")); // truncated comm
        assert!(is_warframe_comm("Warframe.x64.exe"));
        assert!(is_warframe_comm("Warframe"));
        assert!(!is_warframe_comm("steam"));
        assert!(!is_warframe_comm(""));
    }
}
