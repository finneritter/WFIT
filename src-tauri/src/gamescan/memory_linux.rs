//! Memory scan (Linux). A `MemReader` over `/proc/<pid>/{maps,mem}` — region list
//! from `maps`, reads via `pread`-backed `File::read_at` on `mem`. The portable
//! search/parse lives in `scan.rs`; this file is just the OS primitive.

use crate::error::AppResult;
use crate::gamescan::scan::{self, MemReader, Session};
use std::fs::File;
use std::os::unix::fs::FileExt;

/// Linux memory window: the parsed `maps` regions + an open handle to `mem`.
struct ProcMem {
    regions: Vec<(u64, u64)>,
    mem: File,
}

impl MemReader for ProcMem {
    fn regions(&self) -> Vec<(u64, u64)> {
        self.regions.clone()
    }
    fn read_at(&self, addr: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        self.mem.read_at(buf, addr)
    }
}

/// Scan the process's writable anonymous regions for the session string.
pub fn read_session(pid: u32) -> AppResult<Option<Session>> {
    let maps = std::fs::read_to_string(format!("/proc/{pid}/maps"))?;
    let mem = File::open(format!("/proc/{pid}/mem"))?;
    let reader = ProcMem {
        regions: readable_regions(&maps),
        mem,
    };
    scan::find_session(&reader)
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
            None => {}                          // anonymous — keep
            Some(p) if p.starts_with('[') => {} // [heap], [stack], [anon] — keep
            Some(_) => continue,                // file-backed — skip
        }
        let Some((s, e)) = range.split_once('-') else {
            continue;
        };
        let (Ok(start), Ok(end)) = (u64::from_str_radix(s, 16), u64::from_str_radix(e, 16)) else {
            continue;
        };
        if end > start {
            out.push((start, end));
        }
    }
    out
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
}
