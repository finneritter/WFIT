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
            #[serde(rename = "gameRef")]
            game_ref: Option<String>,
            #[serde(rename = "maxRank")]
            max_rank: Option<i64>,
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
                game_ref: it.game_ref,
                max_rank: it.max_rank,
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
            mod_rank: Option<i64>, // present for mods/arcanes; null otherwise
        }

        let url = format!("{API_V1}/items/{slug}/statistics");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(None);
        }
        let resp: Resp = r.json().await?;
        let all_days = resp.payload.statistics_closed.ninety;
        if all_days.is_empty() {
            return Ok(None);
        }

        // Mods/arcanes carry mod_rank: warframe.market serves a separate price series
        // per rank. Build a chronological (median, volume) series per rank.
        let is_ranked = all_days.iter().any(|d| d.mod_rank.is_some());
        let mut by_rank: std::collections::BTreeMap<i64, Vec<(f64, f64)>> =
            std::collections::BTreeMap::new();
        for d in &all_days {
            if let Some(m) = d.median {
                by_rank
                    .entry(d.mod_rank.unwrap_or(0))
                    .or_default()
                    .push((m, d.volume.unwrap_or(0.0)));
            }
        }

        // Per-rank ROBUST price: winsorized + volume-weighted median over the recent
        // window, so a single low-volume troll print (e.g. 50000p on volume 1) can't
        // set the price. Only emitted for ranked items.
        let ranks: Vec<(i64, i64)> = if is_ranked {
            by_rank
                .iter()
                .filter_map(|(rk, s)| robust_price(s).map(|p| (*rk, p)))
                .collect()
        } else {
            Vec::new()
        };

        // Headline series = rank 0 for ranked items (fallback: lowest available rank),
        // else all days. The headline median + trend derive from this.
        let headline: Vec<(f64, f64)> = if is_ranked {
            by_rank
                .get(&0)
                .or_else(|| by_rank.values().next())
                .cloned()
                .unwrap_or_default()
        } else {
            all_days
                .iter()
                .filter_map(|d| d.median.map(|m| (m, d.volume.unwrap_or(0.0))))
                .collect()
        };
        let Some(median_plat) = robust_price(&headline) else {
            return Ok(None);
        };

        // Stored OHLC history (for the drawer chart) = rank-0 days for ranked items.
        let days: Vec<&Day> = if is_ranked {
            let r0: Vec<&Day> = all_days.iter().filter(|d| d.mod_rank == Some(0)).collect();
            if r0.is_empty() {
                all_days.iter().collect()
            } else {
                r0
            }
        } else {
            all_days.iter().collect()
        };
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

        // Trend/delta from the headline medians, winsorized so a spike day doesn't
        // produce a fake ±1000% move.
        let raw_medians: Vec<f64> = headline.iter().map(|(m, _)| *m).collect();
        let (lo, hi) = winsorize_band(&raw_medians);
        let medians: Vec<f64> = raw_medians.iter().map(|m| m.clamp(lo, hi)).collect();
        let recent: Vec<f64> = medians.iter().rev().take(7).copied().collect();
        let prior: Vec<f64> = medians.iter().rev().skip(7).take(7).copied().collect();
        let recent_avg = avg(&recent);
        // No prior window (≤7 trade days of history) → the 7d move is UNKNOWN,
        // not 0% — emitting 0 made sparse items show "+0%" next to a spiking
        // sparkline. None renders as "—" in the UI.
        let delta_7d = if prior.is_empty() {
            None
        } else {
            let prior_avg = avg(&prior);
            (prior_avg > 0.0).then(|| (recent_avg - prior_avg) / prior_avg * 100.0)
        };
        let trend = match delta_7d {
            Some(d) if d > 5.0 => "up",
            Some(d) if d < -5.0 => "down",
            _ => "flat",
        };

        // 7d volume = sum of the last 7 days' volume (headline series).
        let volume_7d: i64 = headline
            .iter()
            .rev()
            .take(7)
            .map(|(_, v)| v.round() as i64)
            .sum();

        Ok(Some(PriceUpsert {
            slug: slug.to_string(),
            median_plat,
            trend: trend.to_string(),
            delta_7d,
            volume_7d: Some(volume_7d),
            ranks,
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

    /// The live order book for one item from `/v2/orders/item`:
    /// - `sells`: robust lowest ask per rank (median of cheapest 5; online preferred)
    ///   — the reference for buying / for items with no bids.
    /// - `bids`: the online BUY ladder (rank, price, qty) — the actual demand curve
    ///   we liquidate holdings into. rank -1 = a non-ranked item.
    pub async fn fetch_order_book(&self, slug: &str) -> AppResult<OrderBook> {
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
            quantity: Option<i64>,
            rank: Option<i64>,
            user: Option<OrderUser>,
        }
        #[derive(Deserialize)]
        struct OrderUser {
            status: Option<String>,
        }

        let url = format!("{API_V2}/orders/item/{slug}");
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() {
            return Ok(OrderBook::default());
        }
        let resp: Resp = r.json().await?;

        use std::collections::BTreeMap;
        let mut online_sells: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
        let mut all_sells: BTreeMap<i64, Vec<i64>> = BTreeMap::new();
        // online buy qty aggregated per (rank, price)
        let mut bids: BTreeMap<(i64, i64), i64> = BTreeMap::new();
        for o in &resp.data {
            let Some(p) = o.platinum else { continue };
            let rk = o.rank.unwrap_or(-1);
            let is_online = o
                .user
                .as_ref()
                .and_then(|u| u.status.as_deref())
                .is_some_and(|s| s == "ingame" || s == "online");
            match o.order_type.as_str() {
                "sell" => {
                    all_sells.entry(rk).or_default().push(p);
                    if is_online {
                        online_sells.entry(rk).or_default().push(p);
                    }
                }
                "buy" if is_online => {
                    *bids.entry((rk, p)).or_insert(0) += o.quantity.unwrap_or(1).max(1);
                }
                _ => {}
            }
        }

        let mut sells = Vec::new();
        for (rk, all_s) in &all_sells {
            let source = match online_sells.get(rk) {
                Some(v) if v.len() >= 5 => v,
                _ => all_s,
            };
            if let Some(price) = robust_low(source) {
                sells.push((*rk, price));
            }
        }
        let bids = bids.into_iter().map(|((rk, p), q)| (rk, p, q)).collect();
        Ok(OrderBook { sells, bids })
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

/// The live order book for one item: robust asks per rank + the online bid ladder.
#[derive(Debug, Clone, Default)]
pub struct OrderBook {
    pub sells: Vec<(i64, i64)>,     // (rank, robust lowest ask)
    pub bids: Vec<(i64, i64, i64)>, // (rank, price, qty) — online buy orders
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

/// The robust low of a set of sell asks: the median of the cheapest five, so one
/// troll-low ask can't tank the price and one troll-high can't inflate it.
fn robust_low(sells: &[i64]) -> Option<i64> {
    if sells.is_empty() {
        return None;
    }
    let mut s = sells.to_vec();
    s.sort_unstable();
    let low = &s[..s.len().min(5)];
    let mid = low.len() / 2;
    Some(if low.len() % 2 == 1 {
        low[mid]
    } else {
        (low[mid - 1] + low[mid]) / 2
    })
}

/// How many recent days the robust price considers.
const ROBUST_WINDOW: usize = 45;

fn median_f(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = s.len();
    if n % 2 == 1 {
        s[n / 2]
    } else {
        (s[n / 2 - 1] + s[n / 2]) / 2.0
    }
}

/// Robust clamp band for a series: median ± 3·MAD, with a fraction-of-center
/// fallback when MAD ≈ 0 (a mostly-flat series where a pure-MAD band would let a
/// lone spike through). Mirrors the Trends winsorize.
fn winsorize_band(meds: &[f64]) -> (f64, f64) {
    if meds.is_empty() {
        return (0.0, f64::INFINITY);
    }
    let center = median_f(meds);
    let devs: Vec<f64> = meds.iter().map(|m| (m - center).abs()).collect();
    let mad = median_f(&devs);
    let band = if mad > 0.0 {
        3.0 * mad
    } else {
        (center * 0.5).max(1.0)
    };
    ((center - band).max(0.0), center + band)
}

/// The volume-weighted median of (value, weight) points (weight = volume + 1 so
/// zero-volume days still count a little). Robust to a few extreme points.
fn weighted_median(points: &[(f64, f64)]) -> Option<f64> {
    if points.is_empty() {
        return None;
    }
    let mut pts = points.to_vec();
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let total: f64 = pts.iter().map(|(_, w)| w).sum();
    if total <= 0.0 {
        return Some(median_f(&pts.iter().map(|(v, _)| *v).collect::<Vec<_>>()));
    }
    let half = total / 2.0;
    let mut cum = 0.0;
    for (v, w) in &pts {
        cum += w;
        if cum >= half {
            return Some(*v);
        }
    }
    pts.last().map(|(v, _)| *v)
}

/// A robust "current price" from a chronological (median, volume) series: take the
/// recent window, winsorize the medians (clamp spikes), then volume-weight — a lone
/// low-volume troll print (50000p on volume 1) carries almost no weight and is
/// clamped anyway. Returns None for an empty series.
fn robust_price(series: &[(f64, f64)]) -> Option<i64> {
    if series.is_empty() {
        return None;
    }
    let start = series.len().saturating_sub(ROBUST_WINDOW);
    let window = &series[start..];
    let meds: Vec<f64> = window.iter().map(|(m, _)| *m).collect();
    let (lo, hi) = winsorize_band(&meds);
    let pts: Vec<(f64, f64)> = window
        .iter()
        .map(|(m, v)| (m.clamp(lo, hi), v.max(0.0) + 1.0))
        .collect();
    weighted_median(&pts).map(|x| x.round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn robust_price_ignores_low_volume_troll() {
        // Real trades cluster at 1–2p (good volume); two troll prints at 1000p and
        // 50000p on volume 1 must not move the price.
        let series = vec![
            (1.0, 20.0),
            (2.0, 18.0),
            (1.0, 15.0),
            (1000.0, 1.0),
            (2.0, 22.0),
            (50000.0, 1.0),
            (1.0, 19.0),
        ];
        let p = robust_price(&series).unwrap();
        assert!((1..=3).contains(&p), "expected ~1–2p, got {p}");
    }

    #[test]
    fn robust_price_tracks_stable_liquid_item() {
        let series: Vec<(f64, f64)> = (0..30).map(|_| (65.0, 60.0)).collect();
        assert_eq!(robust_price(&series), Some(65));
    }

    #[test]
    fn robust_low_is_the_median_of_the_cheapest_five() {
        // A troll-low (1) and troll-high (9999) ask both sit outside the cheapest
        // five [8,9,9,10,10] → median 9, unaffected.
        let asks = [9999, 10, 9, 8, 50, 10, 9, 1];
        assert_eq!(robust_low(&asks), Some(9));
    }

    #[test]
    fn robust_low_handles_few_and_empty() {
        assert_eq!(robust_low(&[]), None);
        assert_eq!(robust_low(&[5]), Some(5));
        assert_eq!(robust_low(&[1, 1, 1, 1]), Some(1)); // disruptor-style 1p floor
    }
}
