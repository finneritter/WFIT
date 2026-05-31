//! warframe.market client. Public API, no auth for catalog/prices.
//!
//! Catalog:    GET https://api.warframe.market/v2/items           (plural; v1 is dead)
//! Detail:     GET https://api.warframe.market/v2/items/<slug>    (plural; singular 404s)
//! Statistics: GET https://api.warframe.market/v1/items/<slug>/statistics  (v2 404s)
//!
//! Headers on every request: User-Agent: wfit-desktop/0.1, Language: en,
//! Platform: pc, Accept: application/json. ONE global throttle (350 ms min-gap,
//! ~3 req/s) across every warframe.market call — the single rate-limit chokepoint.

use crate::db::catalog::CatalogUpsert;
use crate::db::prices::{DayStat, PriceUpsert};
use crate::domain::classify;
use crate::error::AppResult;
use parking_lot::Mutex;
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};

const API_V1: &str = "https://api.warframe.market/v1";
const API_V2: &str = "https://api.warframe.market/v2";
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
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Language", reqwest::header::HeaderValue::from_static("en"));
        headers.insert("Platform", reqwest::header::HeaderValue::from_static("pc"));
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json"),
        );
        let http = Client::builder()
            .user_agent("wfit-desktop/0.1")
            .default_headers(headers)
            .timeout(Duration::from_secs(25))
            .build()
            .expect("reqwest client");
        Self {
            http,
            last_call: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
        }
    }

    /// Block until at least MIN_REQUEST_GAP_MS has passed since the last call.
    pub async fn throttled(&self) {
        let wait = {
            let last = *self.last_call.lock();
            let since = last.elapsed();
            let gap = Duration::from_millis(MIN_REQUEST_GAP_MS);
            if since >= gap {
                Duration::ZERO
            } else {
                gap - since
            }
        };
        if wait > Duration::ZERO {
            tokio::time::sleep(wait).await;
        }
        *self.last_call.lock() = Instant::now();
    }

    /// Pass A: the full item list. Classifies into the 5 categories and skips
    /// anything WFIT doesn't track (sentinels, skins, ...).
    pub async fn fetch_catalog(&self) -> AppResult<Vec<CatalogUpsert>> {
        self.throttled().await;

        #[derive(Deserialize)]
        struct Resp {
            data: Vec<Item>,
        }
        #[derive(Deserialize)]
        struct Item {
            slug: String,
            id: Option<String>,
            #[serde(default)]
            tags: Vec<String>,
            ducats: Option<i64>,
            i18n: Option<I18n>,
        }
        #[derive(Deserialize)]
        struct I18n {
            en: Option<En>,
        }
        #[derive(Deserialize)]
        struct En {
            name: Option<String>,
            thumb: Option<String>,
        }

        let url = format!("{API_V2}/items");
        let resp: Resp = self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let mut out = Vec::with_capacity(resp.data.len());
        for it in resp.data {
            let Some(category) = classify::category_of(&it.tags) else {
                continue; // not tracked
            };
            let en = it.i18n.and_then(|x| x.en);
            let display_name = en
                .as_ref()
                .and_then(|e| e.name.clone())
                .unwrap_or_else(|| it.slug.clone());
            let thumbnail_url = en
                .and_then(|e| e.thumb)
                .map(|t| format!("{STATIC_BASE}{t}"));
            let set_slug = if category == "set" {
                None
            } else {
                classify::derive_set_slug(&it.slug)
            };
            out.push(CatalogUpsert {
                part_type: classify::part_type_of(&it.slug, &it.tags),
                category: category.to_string(),
                set_slug,
                ducats: it.ducats,
                is_vaulted: false,
                is_tradeable: true,
                thumbnail_url,
                wfm_id: it.id,
                display_name,
                slug: it.slug,
            });
        }
        Ok(out)
    }

    /// Per-item 90-day statistics → a fully-derived PriceUpsert (history + cache
    /// figures). Returns None when the item has no usable closed-market history.
    pub async fn fetch_statistics(&self, slug: &str) -> AppResult<Option<PriceUpsert>> {
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
            datetime: Option<String>,
            median: Option<f64>,
            volume: Option<f64>,
            open_price: Option<f64>,
            closed_price: Option<f64>,
            min_price: Option<f64>,
            max_price: Option<f64>,
        }

        let url = format!("{API_V1}/items/{slug}/statistics");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(None);
        }
        let resp: Resp = r.json().await?;
        let days = resp.payload.statistics_closed.ninety;
        if days.is_empty() {
            return Ok(None);
        }

        // Build the daily series (date-only key).
        let history: Vec<DayStat> = days
            .iter()
            .filter_map(|d| {
                let dt = d.datetime.as_ref()?;
                let day = dt.split('T').next().unwrap_or(dt).to_string();
                let r = |x: Option<f64>| x.map(|v| v.round() as i64);
                Some(DayStat {
                    day,
                    median: r(d.median),
                    volume: r(d.volume),
                    open: r(d.open_price),
                    high: r(d.max_price),
                    low: r(d.min_price),
                    close: r(d.closed_price),
                })
            })
            .collect();

        let medians: Vec<f64> = days.iter().filter_map(|d| d.median).collect();
        if medians.is_empty() {
            return Ok(None);
        }

        // Current median = the most recent day's median (fallback: last known).
        let median_plat = medians.last().copied().unwrap_or(0.0).round() as i64;

        // 7d delta: recent-7 avg vs the prior-7 avg.
        let recent: Vec<f64> = medians.iter().rev().take(7).copied().collect();
        let prior: Vec<f64> = medians.iter().rev().skip(7).take(7).copied().collect();
        let recent_avg = avg(&recent);
        let prior_avg = if prior.is_empty() {
            recent_avg
        } else {
            avg(&prior)
        };
        let delta_7d = if prior_avg > 0.0 {
            Some((recent_avg - prior_avg) / prior_avg * 100.0)
        } else {
            None
        };
        let trend = match delta_7d {
            Some(d) if d > 5.0 => "up",
            Some(d) if d < -5.0 => "down",
            _ => "flat",
        };

        // 7d volume = sum of the last 7 days' volume.
        let volume_7d: i64 = days
            .iter()
            .rev()
            .take(7)
            .filter_map(|d| d.volume)
            .map(|v| v.round() as i64)
            .sum();

        Ok(Some(PriceUpsert {
            slug: slug.to_string(),
            median_plat,
            trend: trend.to_string(),
            delta_7d,
            volume_7d: Some(volume_7d),
            history,
        }))
    }

    /// Pass B: per-item detail — the set composition (member ids + quantity).
    pub async fn fetch_detail(&self, slug: &str) -> AppResult<Option<ItemDetailRaw>> {
        self.throttled().await;

        #[derive(Deserialize)]
        struct Resp {
            data: Data,
        }
        #[derive(Deserialize)]
        struct Data {
            #[serde(default)]
            set_parts: Vec<String>,
            set_root: Option<bool>,
            quantity_in_set: Option<i64>,
        }

        let url = format!("{API_V2}/items/{slug}");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(None);
        }
        let resp: Resp = r.json().await?;
        Ok(Some(ItemDetailRaw {
            set_parts: resp.data.set_parts,
            set_root: resp.data.set_root.unwrap_or(false),
            quantity_in_set: resp.data.quantity_in_set.unwrap_or(1),
        }))
    }

    /// Public live orders for one item → best buy/sell among online users (the
    /// actionable market) + buyer/seller counts. Powers the drawer's spread row.
    pub async fn fetch_item_orders(&self, slug: &str) -> AppResult<crate::types::ItemOrders> {
        self.throttled().await;

        #[derive(Deserialize)]
        struct Resp {
            #[serde(default)]
            data: Vec<Order>,
        }
        #[derive(Deserialize)]
        struct Order {
            #[serde(rename = "type")]
            order_type: String,
            platinum: Option<i64>,
            user: Option<OrderUser>,
        }
        #[derive(Deserialize)]
        struct OrderUser {
            status: Option<String>,
        }

        let url = format!("{API_V2}/orders/item/{slug}");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(crate::types::ItemOrders::default());
        }
        let resp: Resp = r.json().await?;

        let mut out = crate::types::ItemOrders::default();
        for o in &resp.data {
            let online = o
                .user
                .as_ref()
                .and_then(|u| u.status.as_deref())
                .is_some_and(|s| s == "ingame" || s == "online");
            if !online {
                continue;
            }
            let Some(p) = o.platinum else { continue };
            match o.order_type.as_str() {
                "buy" => {
                    out.buyers += 1;
                    out.best_buy = Some(out.best_buy.map_or(p, |b| b.max(p)));
                }
                "sell" => {
                    out.sellers += 1;
                    out.best_sell = Some(out.best_sell.map_or(p, |b| b.min(p)));
                }
                _ => {}
            }
        }
        Ok(out)
    }

    /// Tier 1 (public): a user's visible orders. Auth header optional (Tier 2).
    pub async fn fetch_user_orders(
        &self,
        username: &str,
        jwt: Option<&str>,
    ) -> AppResult<Vec<RawOrder>> {
        self.throttled().await;

        #[derive(Deserialize)]
        struct Resp {
            payload: Payload,
        }
        #[derive(Deserialize)]
        struct Payload {
            #[serde(default)]
            sell_orders: Vec<RawOrder>,
        }

        let url = format!("{API_V1}/profile/{username}/orders");
        let mut req = self.http.get(url);
        if let Some(token) = jwt {
            req = req.header("Authorization", format!("JWT {token}"));
        }
        let r = req.send().await?;
        if !r.status().is_success() {
            return Ok(Vec::new());
        }
        let resp: Resp = r.json().await?;
        Ok(resp.payload.sell_orders)
    }
}

/// Raw set-composition fields from the detail endpoint (ids, not slugs).
#[derive(Debug, Clone)]
pub struct ItemDetailRaw {
    pub set_parts: Vec<String>,
    pub set_root: bool,
    pub quantity_in_set: i64,
}

/// A raw warframe.market sell order (v1 profile orders shape).
#[derive(Debug, Clone, Deserialize)]
pub struct RawOrder {
    pub id: String,
    pub platinum: Option<i64>,
    pub quantity: Option<i64>,
    #[serde(default)]
    pub visible: bool,
    pub item: RawOrderItem,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawOrderItem {
    pub url_name: String,
}

fn avg(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        0.0
    } else {
        xs.iter().sum::<f64>() / xs.len() as f64
    }
}
