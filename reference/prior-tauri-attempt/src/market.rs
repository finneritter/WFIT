//! warframe.market v1 client. Public API, no auth.
//!
//! Catalog: GET https://api.warframe.market/v1/items
//! Pricing: GET https://api.warframe.market/v1/items/{slug}/statistics
//!
//! Headers: Language: en, Platform: pc are advisory; the API tolerates their absence.

use crate::db::catalog::CatalogUpsert;
use crate::db::prices::PriceUpsert;
use crate::error::AppResult;
use parking_lot::Mutex;
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};

const API_BASE: &str = "https://api.warframe.market/v1";
const STATIC_BASE: &str = "https://warframe.market/static/assets/";
const MIN_REQUEST_GAP_MS: u64 = 350; // ~3 req/sec ceiling

#[derive(Clone)]
pub struct Market {
    http: Client,
    last_call: Arc<Mutex<Instant>>,
}

impl Default for Market {
    fn default() -> Self {
        Self::new()
    }
}

impl Market {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent(concat!("wfinv/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client");
        Self {
            http,
            last_call: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
        }
    }

    async fn throttled(&self) {
        let wait = {
            let last = *self.last_call.lock();
            let since = last.elapsed();
            let gap = Duration::from_millis(MIN_REQUEST_GAP_MS);
            if since >= gap { Duration::ZERO } else { gap - since }
        };
        if wait > Duration::ZERO {
            tokio::time::sleep(wait).await;
        }
        *self.last_call.lock() = Instant::now();
    }

    pub async fn fetch_catalog(&self) -> AppResult<Vec<CatalogUpsert>> {
        self.throttled().await;
        #[derive(Deserialize)]
        struct Resp {
            payload: Payload,
        }
        #[derive(Deserialize)]
        struct Payload {
            items: Vec<Item>,
        }
        #[derive(Deserialize)]
        struct Item {
            url_name: String,
            item_name: String,
            thumb: Option<String>,
        }

        let url = format!("{API_BASE}/items");
        let resp: Resp = self.http.get(url).send().await?.error_for_status()?.json().await?;
        let mut out = Vec::with_capacity(resp.payload.items.len());
        for it in resp.payload.items {
            // Heuristics from the slug — refined by WFCD enrichment in catalog_sync (later).
            let lower = it.url_name.to_lowercase();
            let is_prime = lower.contains("prime");
            let is_set = lower.ends_with("_set");
            let part_type = if is_set {
                "Set".to_string()
            } else if lower.ends_with("_blueprint") {
                "Blueprint".to_string()
            } else if lower.ends_with("_systems") {
                "Systems".to_string()
            } else if lower.ends_with("_chassis") {
                "Chassis".to_string()
            } else if lower.ends_with("_neuroptics") {
                "Neuroptics".to_string()
            } else if lower.ends_with("_blade") {
                "Blade".to_string()
            } else if lower.ends_with("_handle") || lower.ends_with("_grip") {
                "Handle".to_string()
            } else if lower.ends_with("_barrel") {
                "Barrel".to_string()
            } else if lower.ends_with("_receiver") {
                "Receiver".to_string()
            } else if lower.ends_with("_stock") {
                "Stock".to_string()
            } else {
                "Other".to_string()
            };
            // Skip non-prime items entirely (v1 scope is prime parts + sets).
            if !is_prime {
                continue;
            }
            let set_slug = if is_set {
                None
            } else {
                // Derive the set slug by replacing trailing part with "_set" if possible.
                derive_set_slug(&it.url_name)
            };
            let thumbnail_url = it.thumb.map(|t| format!("{STATIC_BASE}{t}"));
            out.push(CatalogUpsert {
                slug: it.url_name,
                display_name: it.item_name,
                part_type,
                set_slug,
                ducats: None,    // filled in by WFCD enrichment later
                is_vaulted: false, // ditto
                is_tradeable: true,
                thumbnail_url,
            });
        }
        Ok(out)
    }

    /// Fetch 48h statistics for a single slug; derive median + trend.
    pub async fn fetch_price(&self, slug: &str) -> AppResult<Option<PriceUpsert>> {
        self.throttled().await;
        #[derive(Deserialize)]
        struct Resp {
            payload: Payload,
        }
        #[derive(Deserialize)]
        struct Payload {
            statistics_closed: StatsBucket,
        }
        #[derive(Deserialize)]
        struct StatsBucket {
            #[serde(default, rename = "90days")]
            ninety: Vec<Day>,
        }
        #[derive(Deserialize)]
        struct Day {
            median: Option<f64>,
        }

        let url = format!("{API_BASE}/items/{slug}/statistics");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(None);
        }
        let resp: Resp = r.json().await?;
        let mut medians: Vec<f64> = resp
            .payload
            .statistics_closed
            .ninety
            .iter()
            .filter_map(|d| d.median)
            .collect();
        if medians.is_empty() {
            return Ok(None);
        }
        let recent = medians.iter().rev().take(7).copied().collect::<Vec<_>>();
        let older = medians.iter().rev().skip(7).take(7).copied().collect::<Vec<_>>();
        let recent_avg = recent.iter().sum::<f64>() / recent.len() as f64;
        let older_avg = if older.is_empty() {
            recent_avg
        } else {
            older.iter().sum::<f64>() / older.len() as f64
        };
        let trend = if recent_avg > older_avg * 1.05 {
            "up"
        } else if recent_avg < older_avg * 0.95 {
            "down"
        } else {
            "flat"
        };
        medians.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mid = medians.len() / 2;
        let median = medians[mid].round() as i64;
        Ok(Some(PriceUpsert {
            slug: slug.to_string(),
            median_plat: median,
            trend: trend.to_string(),
        }))
    }
}

fn derive_set_slug(slug: &str) -> Option<String> {
    // Examples:
    //   mesa_prime_blueprint -> mesa_prime_set
    //   mesa_prime_systems   -> mesa_prime_set
    //   dread_blade         -> dread_set (best effort)
    // The set slug for prime items always ends in _prime_set.
    if let Some(prime_idx) = slug.find("_prime") {
        let stem = &slug[..prime_idx + "_prime".len()];
        return Some(format!("{stem}_set"));
    }
    None
}
