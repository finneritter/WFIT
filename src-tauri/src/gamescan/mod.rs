//! Game inventory import — memory-scan of the running Warframe client.
//!
//! ISOLATED, like `worldstate.rs`: own concern, never on the warframe.market data
//! path. Opt-in, consent-gated (typed phrase), Linux-only, off by default.
//! **ToS-prohibited and ban-risky** — see `docs/GAME_INVENTORY_IMPORT.md`.
//!
//! Build status: **Phase B2 verified live (2026-06-01).** `consent` + `map` are
//! unit-tested; `process`/`memory`/`api` implement the live read from the public
//! protocol (signature `accountId=<24 hex>&nonce=<digits>`; endpoint
//! `mobile.warframe.com/api/inventory.php`). No upstream code is copied. A real
//! scan imported correct counts across prime parts, mods and arcanes; the count
//! fix was reading `RawUpgrades` (stacked mods/arcanes) — see `map.rs`. Note
//! `ptrace_scope` can block the read on a locked-down kernel (see `memory.rs`).

pub mod consent;
pub mod map;

#[cfg(target_os = "linux")]
mod api;
#[cfg(target_os = "linux")]
mod memory;
#[cfg(target_os = "linux")]
mod process;

#[cfg(not(target_os = "linux"))]
use crate::error::AppError;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

/// A raw inventory line as read from the game (DE `uniqueName` + count), before
/// it is mapped onto the catalog. `rank` is the mod/arcane rank (0 for unranked
/// stacks, the fingerprint `lvl` for ranked instances) or None for prime parts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RawItem {
    pub unique_name: String,
    pub count: i64,
    pub rank: Option<i64>,
}

/// A normalized scan result: the owned lines plus the account id (kept only to
/// detect a different-account scan; the nonce is never carried here).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RawInventory {
    pub account_id: Option<String>,
    pub items: Vec<RawItem>,
}

/// A resolved owned line: a catalog slug + quantity at a given rank (post-mapping).
/// `rank` is None for non-ranked items (prime parts); Some(n) for mods/arcanes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanItem {
    pub slug: String,
    pub rank: Option<i64>,
    pub qty: i64,
}

/// Whether the platform can support memory-scanning at all. Linux only — macOS
/// (SIP/hardened runtime) and Windows are not supported in v1.
pub const fn is_supported() -> bool {
    cfg!(target_os = "linux")
}

/// Best-effort detection of a running Warframe client. Process listing only (NOT
/// memory). Returns false on unsupported platforms.
#[cfg(target_os = "linux")]
pub fn warframe_running() -> bool {
    process::find_pid().is_some()
}

#[cfg(not(target_os = "linux"))]
pub fn warframe_running() -> bool {
    false
}

/// Perform a live scan: process → memory (accountId + nonce) → DE inventory
/// endpoint → normalized `RawInventory`. Linux-only.
pub async fn scan() -> AppResult<RawInventory> {
    #[cfg(target_os = "linux")]
    {
        linux_scan().await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err(AppError::Invalid(
            "game inventory scan is Linux-only".into(),
        ))
    }
}

#[cfg(target_os = "linux")]
async fn linux_scan() -> AppResult<RawInventory> {
    use crate::error::AppError;

    let pid = process::find_pid()
        .ok_or_else(|| AppError::NotConnected("Warframe is not running".into()))?;

    // ptrace_scope 2/3 always blocks the read — fail early with guidance.
    if let Some(scope) = process::ptrace_scope() {
        if scope >= 2 {
            return Err(AppError::Invalid(format!(
                "kernel.yama.ptrace_scope={scope} blocks reading game memory. Set it to 0 \
                 (sysctl -w kernel.yama.ptrace_scope=0) or grant WFIT CAP_SYS_PTRACE."
            )));
        }
    }

    // The memory scan is blocking and can touch GBs — keep it off the async runtime.
    let session = tokio::task::spawn_blocking(move || memory::read_session(pid))
        .await
        .map_err(|e| AppError::Other(format!("memory scan task failed: {e}")))??
        .ok_or_else(|| {
            AppError::Other(
                "couldn't find the game session in memory — make sure you're fully logged in"
                    .into(),
            )
        })?;

    let json = api::fetch_inventory(&session.account_id, &session.nonce).await?;
    let mut inv = map::parse_inventory(&json);
    inv.account_id = Some(session.account_id); // trust the scanned id over the body
    tracing::info!(lines = inv.items.len(), "gamescan: parsed inventory");
    Ok(inv)
}
