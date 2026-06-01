//! DE mobile inventory endpoint client. Its OWN HTTP client — NOT `market.rs`'s
//! warframe.market throttle (different host, different concern). Called at most
//! once per manual scan.
//!
//! Endpoint (public protocol, verified live 2026): `GET
//! https://mobile.warframe.com/api/inventory.php?accountId=<id>&nonce=<nonce>` →
//! the full account inventory JSON. `api.warframe.com` is a known alternate host.

use crate::error::AppResult;
use serde_json::Value;
use std::time::Duration;

const HOST: &str = "https://mobile.warframe.com";

pub async fn fetch_inventory(account_id: &str, nonce: &str) -> AppResult<Value> {
    let url = format!("{HOST}/api/inventory.php?accountId={account_id}&nonce={nonce}");
    let client = reqwest::Client::builder()
        .user_agent("wfit-desktop/0.1")
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    Ok(resp.json::<Value>().await?)
}
