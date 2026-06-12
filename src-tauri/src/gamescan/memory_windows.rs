//! Memory scan (Windows). A `MemReader` over a process handle — regions via
//! `VirtualQueryEx`, reads via `ReadProcessMemory`. The portable search/parse lives
//! in `scan.rs` (incl. the pure `keep_win_region` filter); this is the OS primitive.

use crate::error::{AppError, AppResult};
use crate::gamescan::scan::{self, MemReader, Session};
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, FALSE, HANDLE};
use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows::Win32::System::Memory::{VirtualQueryEx, MEMORY_BASIC_INFORMATION};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

/// A Windows memory window: an owned process handle (closed on drop).
struct WinMem {
    handle: HANDLE,
}

impl Drop for WinMem {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

impl MemReader for WinMem {
    fn regions(&self) -> Vec<(u64, u64)> {
        let mut out = Vec::new();
        let mut addr: usize = 0;
        loop {
            let mut mbi = MEMORY_BASIC_INFORMATION::default();
            let written = unsafe {
                VirtualQueryEx(
                    self.handle,
                    Some(addr as *const c_void),
                    &mut mbi,
                    std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
                )
            };
            if written == 0 {
                break; // walked off the end of the address space
            }
            let base = mbi.BaseAddress as usize;
            let size = mbi.RegionSize;
            if size == 0 {
                break;
            }
            if scan::keep_win_region(mbi.State.0, mbi.Protect.0, mbi.Type.0) {
                out.push((base as u64, (base + size) as u64));
            }
            match base.checked_add(size) {
                Some(next) if next > addr => addr = next,
                _ => break, // overflow / no progress — stop
            }
        }
        out
    }

    fn read_at(&self, addr: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut read: usize = 0;
        let res = unsafe {
            ReadProcessMemory(
                self.handle,
                addr as usize as *const c_void,
                buf.as_mut_ptr() as *mut c_void,
                buf.len(),
                Some(&mut read),
            )
        };
        match res {
            Ok(()) => Ok(read),
            // A partial copy (region spilling into unmapped pages) still yields bytes;
            // otherwise the region is unreadable. NOT PermissionDenied — OpenProcess
            // already gated access, so scan::find_session should just skip it.
            Err(_) if read > 0 => Ok(read),
            Err(_) => Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "unreadable region",
            )),
        }
    }
}

/// Open the process and scan its committed writable regions for the session string.
pub fn read_session(pid: u32) -> AppResult<Option<Session>> {
    let handle = unsafe { OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, FALSE, pid) }
        .map_err(|_| {
            AppError::Other(
                "couldn't open the game process — run WFIT as the same Windows user that \
                 launched Warframe (or as administrator)."
                    .into(),
            )
        })?;
    let reader = WinMem { handle };
    scan::find_session(&reader)
}
