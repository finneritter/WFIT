//! Portable memory-scan core, shared by the per-OS backends (`memory_linux`,
//! `memory_windows`). Each backend supplies a `MemReader` (how to enumerate
//! readable regions + read bytes at an address); this module owns the chunked
//! search for the session string `accountId=<24 hex>&nonce=<digits>` and its
//! strict parse. The session is returned, never persisted or logged.
//!
//! Reimplemented from the public protocol (the byte signature is documented by
//! `wf-auth-finder` / `warframe-api-helper`); no code is copied from those.

use crate::error::{AppError, AppResult};

/// The ephemeral game session. Secret — used for one request, then dropped.
pub struct Session {
    pub account_id: String,
    pub nonce: String,
}

/// A platform's window into a process's memory: which regions to scan and how to
/// read bytes from them. Implementations live in `memory_linux` / `memory_windows`.
pub trait MemReader {
    /// Writable, non-image regions (start, end) where runtime heap strings live.
    fn regions(&self) -> Vec<(u64, u64)>;
    /// Read into `buf` at absolute `addr`. `Ok(n)` bytes read (0 = end/unreadable);
    /// `Err(PermissionDenied)` is treated as a hard block on the very first read.
    fn read_at(&self, addr: u64, buf: &mut [u8]) -> std::io::Result<usize>;
}

const NEEDLE: &[u8] = b"accountId=";
const CHUNK: usize = 1 << 20; // 1 MiB
const OVERLAP: usize = 64; // re-scan the tail so a split needle isn't missed
const MAX_TOTAL: u64 = 12 * 1024 * 1024 * 1024; // bound work on huge address spaces

/// Scan the reader's regions for the session string. `Ok(None)` if not found
/// (e.g. the account isn't logged in yet). A first-read permission denial is the
/// OS blocking the read (Linux ptrace_scope / Windows access) — surfaced as an error.
pub fn find_session<R: MemReader>(r: &R) -> AppResult<Option<Session>> {
    let mut scanned: u64 = 0;
    let mut any_read_ok = false;
    let mut buf = vec![0u8; CHUNK];

    for (start, end) in r.regions() {
        let mut addr = start;
        while addr < end {
            if scanned >= MAX_TOTAL {
                return Ok(None);
            }
            let want = std::cmp::min(CHUNK as u64, end - addr) as usize;
            match r.read_at(addr, &mut buf[..want]) {
                Ok(0) => break,
                Ok(n) => {
                    any_read_ok = true;
                    scanned += n as u64;
                    // Find every needle hit in this chunk; verify each.
                    let mut from = 0;
                    while let Some(rel) = find_sub(&buf[from..n], NEEDLE) {
                        let pos = from + rel;
                        if let Some(sess) = parse_at(r, addr + pos as u64)? {
                            return Ok(Some(sess));
                        }
                        from = pos + 1;
                    }
                    // Advance, overlapping so a needle split across chunks is caught.
                    if n < want || n <= OVERLAP {
                        addr += n as u64;
                    } else {
                        addr += (n - OVERLAP) as u64;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                    // First read denied = the OS blocking cross-process reads. Once
                    // some reads have worked, a stray denial is just an unreadable
                    // region; skip it.
                    if !any_read_ok {
                        // `mut` is used on linux/windows (push_str below); not on other OSes.
                        #[allow(unused_mut)]
                        let mut msg = String::from("permission denied reading game memory");
                        #[cfg(target_os = "linux")]
                        msg.push_str(
                            " — kernel.yama.ptrace_scope blocks it. Set it to 0 \
                             (sysctl -w kernel.yama.ptrace_scope=0) or run WFIT with \
                             CAP_SYS_PTRACE (setcap cap_sys_ptrace+ep <binary>).",
                        );
                        #[cfg(target_os = "windows")]
                        msg.push_str(
                            " — run WFIT as the same Windows user that launched Warframe \
                             (or as administrator).",
                        );
                        return Err(AppError::Other(msg));
                    }
                    break; // skip this region
                }
                Err(_) => break, // unreadable region (EIO etc.) — skip
            }
        }
    }
    Ok(None)
}

/// Parse the session string at an absolute address: `accountId=<24 hex>&nonce=<digits>`.
/// Returns None if the bytes there don't strictly match that layout.
fn parse_at<R: MemReader>(r: &R, addr: u64) -> AppResult<Option<Session>> {
    let mut buf = [0u8; 160];
    let n = match r.read_at(addr, &mut buf) {
        Ok(n) => n,
        Err(_) => return Ok(None),
    };
    let s = &buf[..n];
    if !s.starts_with(NEEDLE) {
        return Ok(None);
    }
    let rest = &s[NEEDLE.len()..];
    const NONCE_TAG: &[u8] = b"&nonce=";
    if rest.len() < 24 + NONCE_TAG.len() + 1 {
        return Ok(None);
    }
    let acct = &rest[..24];
    if !acct.iter().all(u8::is_ascii_hexdigit) {
        return Ok(None);
    }
    if &rest[24..24 + NONCE_TAG.len()] != NONCE_TAG {
        return Ok(None);
    }
    let nonce: Vec<u8> = rest[24 + NONCE_TAG.len()..]
        .iter()
        .copied()
        .take_while(u8::is_ascii_digit)
        .collect();
    if nonce.is_empty() {
        return Ok(None);
    }
    Ok(Some(Session {
        account_id: String::from_utf8_lossy(acct).into_owned(),
        nonce: String::from_utf8(nonce).unwrap_or_default(),
    }))
}

pub(crate) fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Windows region filter, pure over the raw `VirtualQueryEx` u32 flags — kept here
/// (not in `memory_windows`) so it's unit-tested on every host. Keep committed,
/// writable, non-image regions: the heap-ish memory that holds live session strings.
/// (Only *called* on Windows; harmless elsewhere.)
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn keep_win_region(state: u32, protect: u32, mtype: u32) -> bool {
    const MEM_COMMIT: u32 = 0x1000;
    const MEM_IMAGE: u32 = 0x0100_0000;
    const PAGE_NOACCESS: u32 = 0x01;
    const PAGE_GUARD: u32 = 0x100;
    // read-write variants (incl. exec) — where mutable heap strings live
    const WRITABLE: u32 = 0x04 | 0x08 | 0x40 | 0x80; // RW | WRITECOPY | EXEC_RW | EXEC_WRITECOPY
    state == MEM_COMMIT
        && mtype != MEM_IMAGE
        && protect & (PAGE_NOACCESS | PAGE_GUARD) == 0
        && protect & WRITABLE != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A single flat region at base 0 — exercises the loop + parse without an OS.
    struct MockMem(Vec<u8>);
    impl MemReader for MockMem {
        fn regions(&self) -> Vec<(u64, u64)> {
            vec![(0, self.0.len() as u64)]
        }
        fn read_at(&self, addr: u64, buf: &mut [u8]) -> std::io::Result<usize> {
            let a = addr as usize;
            if a >= self.0.len() {
                return Ok(0);
            }
            let n = std::cmp::min(buf.len(), self.0.len() - a);
            buf[..n].copy_from_slice(&self.0[a..a + n]);
            Ok(n)
        }
    }

    #[test]
    fn find_sub_locates_needle() {
        assert_eq!(find_sub(b"xxaccountId=yy", b"accountId="), Some(2));
        assert_eq!(find_sub(b"nope", b"accountId="), None);
    }

    #[test]
    fn finds_and_parses_session_in_heap() {
        let mut data = vec![0u8; 200];
        data.extend_from_slice(b"accountId=0123456789abcdef01234567&nonce=1700000000\x00junk");
        let sess = find_session(&MockMem(data)).unwrap().unwrap();
        assert_eq!(sess.account_id, "0123456789abcdef01234567");
        assert_eq!(sess.nonce, "1700000000");
    }

    #[test]
    fn rejects_malformed_session() {
        // accountId present but too-short / non-hex → no match.
        let data = b"accountId=xyz&nonce=1".to_vec();
        assert!(find_session(&MockMem(data)).unwrap().is_none());
    }

    #[test]
    fn keep_win_region_filters() {
        const COMMIT: u32 = 0x1000;
        const RESERVE: u32 = 0x2000;
        const IMAGE: u32 = 0x0100_0000;
        const PRIVATE: u32 = 0x2_0000;
        const RW: u32 = 0x04;
        const RO: u32 = 0x02;
        const GUARD: u32 = 0x100;
        assert!(keep_win_region(COMMIT, RW, PRIVATE)); // committed, writable, non-image → keep
        assert!(!keep_win_region(COMMIT, RO, PRIVATE)); // not writable
        assert!(!keep_win_region(COMMIT, RW, IMAGE)); // image-backed (binary/assets)
        assert!(!keep_win_region(RESERVE, RW, PRIVATE)); // not committed
        assert!(!keep_win_region(COMMIT, RW | GUARD, PRIVATE)); // guard page
    }
}
