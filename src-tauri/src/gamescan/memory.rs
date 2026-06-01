//! Memory scan (Linux). Reads the running client's heap for the session query
//! string `accountId=<24 hex>&nonce=<digits>` and extracts it. Pure `/proc/<pid>/mem`
//! reads (no external crate); the session is returned, never persisted or logged.
//!
//! Reimplemented from the public protocol (the byte signature is documented by
//! `wf-auth-finder` / `warframe-api-helper`); no code is copied from those (the
//! former is GPLv3).

use crate::error::{AppError, AppResult};
use std::fs::File;
use std::os::unix::fs::FileExt;

/// The ephemeral game session. Secret — used for one request, then dropped.
pub struct Session {
    pub account_id: String,
    pub nonce: String,
}

const NEEDLE: &[u8] = b"accountId=";
const CHUNK: usize = 1 << 20; // 1 MiB
const OVERLAP: usize = 64; // re-scan the tail so a split needle isn't missed
const MAX_TOTAL: u64 = 12 * 1024 * 1024 * 1024; // bound work on huge address spaces

/// Scan the process's writable anonymous regions for the session string.
/// Returns `Ok(None)` if not found (e.g. the account isn't logged in yet).
/// Returns a permission error if the kernel blocks the read (ptrace_scope).
pub fn read_session(pid: u32) -> AppResult<Option<Session>> {
    let maps = std::fs::read_to_string(format!("/proc/{pid}/maps"))?;
    let mem = File::open(format!("/proc/{pid}/mem"))?;
    let regions = readable_regions(&maps);

    let mut scanned: u64 = 0;
    let mut any_read_ok = false;
    let mut buf = vec![0u8; CHUNK];

    for (start, end) in regions {
        let mut addr = start;
        while addr < end {
            if scanned >= MAX_TOTAL {
                return Ok(None);
            }
            let want = std::cmp::min(CHUNK as u64, end - addr) as usize;
            match mem.read_at(&mut buf[..want], addr) {
                Ok(0) => break,
                Ok(n) => {
                    any_read_ok = true;
                    scanned += n as u64;
                    // Find every needle hit in this chunk; verify each.
                    let mut from = 0;
                    while let Some(rel) = find_sub(&buf[from..n], NEEDLE) {
                        let pos = from + rel;
                        if let Some(sess) = parse_at(&mem, addr + pos as u64)? {
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
                    // The very first read being denied is the ptrace_scope block —
                    // surface it. Once some reads have worked, a stray denial is
                    // just an unreadable region; skip it.
                    if !any_read_ok {
                        return Err(AppError::Other(
                            "permission denied reading game memory — kernel.yama.ptrace_scope \
                             blocks it. Set it to 0 (sysctl -w kernel.yama.ptrace_scope=0) or run \
                             WFIT with CAP_SYS_PTRACE (setcap cap_sys_ptrace+ep <binary>)."
                                .into(),
                        ));
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
fn parse_at(mem: &File, addr: u64) -> AppResult<Option<Session>> {
    let mut buf = [0u8; 160];
    let n = match mem.read_at(&mut buf, addr) {
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

/// Writable, anonymous (non file-backed) regions from `/proc/<pid>/maps` — where
/// runtime heap strings live. Excluding file-backed maps massively bounds the scan
/// (the game's mapped binaries/assets are huge and never hold the live session).
fn readable_regions(maps: &str) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    for line in maps.lines() {
        // Format: "start-end perms offset dev inode pathname"
        let mut it = line.split_whitespace();
        let Some(range) = it.next() else { continue };
        let Some(perms) = it.next() else { continue };
        if !perms.starts_with("rw") {
            continue; // need read+write (heap/anon); skip ro and no-read
        }
        let pathname = it.nth(3); // offset, dev, inode, then pathname
        match pathname {
            None => {}                                   // anonymous — keep
            Some(p) if p.starts_with('[') => {}          // [heap], [stack], [anon] — keep
            Some(_) => continue,                         // file-backed — skip
        }
        let Some((s, e)) = range.split_once('-') else { continue };
        let (Ok(start), Ok(end)) = (
            u64::from_str_radix(s, 16),
            u64::from_str_radix(e, 16),
        ) else {
            continue;
        };
        if end > start {
            out.push((start, end));
        }
    }
    out
}

fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_writable_anon_regions() {
        let maps = "\
55a0-55b0 rw-p 00000000 00:00 0 \n\
7f00-7f10 r--p 00000000 00:00 0 [heap]\n\
7f20-7f30 rw-p 00000000 08:01 123 /usr/lib/libc.so\n\
7f40-7f50 rw-p 00000000 00:00 0 [stack]\n";
        let r = readable_regions(maps);
        // keep: the rw anon (55a0-55b0) and rw [stack]; drop ro [heap] and the
        // file-backed libc mapping.
        assert_eq!(r, vec![(0x55a0, 0x55b0), (0x7f40, 0x7f50)]);
    }

    #[test]
    fn find_sub_locates_needle() {
        assert_eq!(find_sub(b"xxaccountId=yy", b"accountId="), Some(2));
        assert_eq!(find_sub(b"nope", b"accountId="), None);
    }
}
