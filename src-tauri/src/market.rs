//! warframe.market client. Public API, no auth for catalog/prices.
//!
//! Catalog:    GET https://api.warframe.market/v2/items           (plural; v1 is dead)
//! Detail:     GET https://api.warframe.market/v2/items/<slug>    (plural; singular 404s)
//! Statistics: GET https://api.warframe.market/v1/items/<slug>/statistics  (v2 404s)
//!
//! Headers on every request: User-Agent: wfit-desktop/<crate version> (lib.rs USER_AGENT), Language: en,
//! Platform: pc, Accept: application/json. ONE global throttle (400 ms min-gap,
//! serialized across concurrent callers) across every warframe.market call — the
//! single rate-limit chokepoint. Writes additionally retry on a 429.

use crate::db::catalog::CatalogUpsert;
use crate::db::prices::{DayStat, PriceUpsert};
use crate::domain::classify;
use crate::error::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const API_V1: &str = "https://api.warframe.market/v1";
const API_V2: &str = "https://api.warframe.market/v2";
const STATIC_BASE: &str = "https://warframe.market/static/assets/";
// ~2.5 req/sec — a hair under warframe.market's ~3/s ceiling, with headroom for
// timing jitter now that the throttle truly serializes concurrent callers.
const MIN_REQUEST_GAP_MS: u64 = 400;
// Writes (create/edit/delete order) retry on a 429 — they're rejected before
// processing, so a retry is safe even for the non-idempotent create POST.
const WRITE_MAX_ATTEMPTS: u32 = 3;
const RETRY_AFTER_CAP: Duration = Duration::from_secs(5);

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
            .user_agent(crate::USER_AGENT)
            .default_headers(headers)
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client");
        Self {
            http,
            last_call: Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60))),
        }
    }

    /// Block until at least MIN_REQUEST_GAP_MS has passed since the last call.
    ///
    /// The async lock is held across the sleep, so concurrent callers (the
    /// launch drain, the heartbeat, a user-initiated command) are *serialized*:
    /// each waits its full gap behind the last one rather than all reading the
    /// same timestamp and firing together. That burst was the source of the 429s.
    pub async fn throttled(&self) {
        let mut last = self.last_call.lock().await;
        let since = last.elapsed();
        let gap = Duration::from_millis(MIN_REQUEST_GAP_MS);
        if since < gap {
            tokio::time::sleep(gap - since).await;
        }
        *last = Instant::now();
    }

    /// Throttled GET with ONE retry on transient failures (timeout/connect
    /// errors, 429, 5xx). The retry re-enters the global throttle plus a 1s
    /// grace so a rate-limit response isn't immediately hammered again.
    /// Idempotent public reads only — auth'd/write requests don't use this.
    async fn get_throttled(&self, url: &str) -> AppResult<reqwest::Response> {
        self.throttled().await;
        // Dev fault injection (after the throttle, so serialization is preserved;
        // a no-op when the dev-dashboard feature is off). 1 = timeout, 2 = 429.
        match crate::devtools::fault_request().await {
            1 => {
                crate::devtools::rec_market(None, Duration::ZERO, true);
                return Err(AppError::Other("injected fault: timeout".into()));
            }
            2 => {
                crate::devtools::rec_market(Some(429), Duration::ZERO, true);
                tracing::warn!(url, "injected fault: 429 — retrying once");
                tokio::time::sleep(Duration::from_secs(1)).await;
                self.throttled().await;
                return Ok(self.timed_send(url).await?);
            }
            _ => {}
        }
        let first = self.timed_send(url).await;
        let transient = match &first {
            Ok(r) => r.status().as_u16() == 429 || r.status().is_server_error(),
            Err(e) => e.is_timeout() || e.is_connect(),
        };
        if !transient {
            return Ok(first?);
        }
        tracing::warn!(url, "transient warframe.market failure — retrying once");
        tokio::time::sleep(Duration::from_secs(1)).await;
        self.throttled().await;
        Ok(self.timed_send(url).await?)
    }

    /// A single GET, timing ONLY `send().await` (never the throttle wait) and
    /// recording latency/status to the dev metrics. The recorder is a no-op when
    /// the `dev-dashboard` feature is off, so this is just `get(url).send()` then.
    async fn timed_send(&self, url: &str) -> reqwest::Result<reqwest::Response> {
        let t = Instant::now();
        let res = self.http.get(url).send().await;
        let elapsed = t.elapsed();
        let (status, is_err) = match &res {
            Ok(r) => (Some(r.status().as_u16()), !r.status().is_success()),
            Err(_) => (None, true),
        };
        crate::devtools::rec_market(status, elapsed, is_err);
        res
    }

    /// Pass A: the full item list. Classifies into the 5 categories and skips
    /// anything WFIT doesn't track (sentinels, skins, ...).
    pub async fn fetch_catalog(&self) -> AppResult<Vec<CatalogUpsert>> {
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
            .get_throttled(&url)
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
        let r = self.get_throttled(&url).await?;
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
        let r = self.get_throttled(&url).await?;
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
        let r = self.get_throttled(&url).await?;
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
    ///
    /// `Ok(Some(book))` may be empty — that's a real market state ("no online
    /// orders") and callers should store it. `Ok(None)` = the server answered
    /// non-2xx (throttle, 5xx, bad slug); callers must keep whatever they have.
    pub async fn fetch_order_book(&self, slug: &str) -> AppResult<Option<OrderBook>> {
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
        let r = self.get_throttled(&url).await?;
        if !r.status().is_success() {
            tracing::warn!(slug, status = %r.status(), "order book fetch rejected");
            return Ok(None);
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
        // Dev fault injection: optional empty book / outlier ask (no-op when off).
        let (sells, bids) = crate::devtools::fault_order_book(sells, bids);
        Ok(Some(OrderBook { sells, bids }))
    }

    /// Public SELL orders for one item WITH seller identity (ingame name, rep,
    /// status), plus the online buy-side aggregate — for the Market page. One
    /// fetch powers both the seller list and the stats strip. `display_name` /
    /// `max_rank` are resolved by the caller from the catalog (the orders endpoint
    /// doesn't carry the item name). Sells are sorted cheapest-first (ingame >
    /// online > offline, then higher rep) and capped — only the cheapest handful
    /// is ever actionable, and items can have ~900 orders.
    pub async fn fetch_item_sellers(
        &self,
        slug: &str,
        display_name: String,
        max_rank: Option<i64>,
    ) -> AppResult<crate::types::ItemSellers> {
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
            #[serde(default = "default_true")]
            visible: bool,
            user: Option<OrderUser>,
        }
        #[derive(Deserialize)]
        struct OrderUser {
            #[serde(rename = "ingameName")]
            ingame_name: Option<String>,
            reputation: Option<i64>,
            status: Option<String>,
        }
        fn default_true() -> bool {
            true
        }

        let url = format!("{API_V2}/orders/item/{slug}");
        let r = self.get_throttled(&url).await?;
        if !r.status().is_success() {
            return Ok(crate::types::ItemSellers {
                display_name,
                max_rank,
                ..Default::default()
            });
        }
        let resp: Resp = r.json().await?;

        let is_online = |s: &str| s == "ingame" || s == "online";
        let mut orders: Vec<crate::types::SellerOrder> = Vec::new();
        let mut best_buy: Option<i64> = None;
        let mut buyers = 0i64;
        let mut sellers = 0i64;
        // (rank, price) -> summed qty, so the ladder collapses many buyers at the
        // same level into one bar. BTreeMap keeps it ordered for the price-desc pass.
        let mut bid_levels: std::collections::BTreeMap<(Option<i64>, i64), i64> =
            std::collections::BTreeMap::new();
        for o in resp.data {
            if !o.visible {
                continue;
            }
            let Some(p) = o.platinum else { continue };
            let user = o.user;
            let status: String = user
                .as_ref()
                .and_then(|u| u.status.clone())
                .unwrap_or_else(|| "offline".into());
            match o.order_type.as_str() {
                "buy" if is_online(&status) => {
                    buyers += 1;
                    best_buy = Some(best_buy.map_or(p, |b| b.max(p)));
                    *bid_levels.entry((o.rank, p)).or_insert(0) += o.quantity.unwrap_or(1).max(1);
                }
                "sell" => {
                    if is_online(&status) {
                        sellers += 1;
                    }
                    let Some(u) = user else { continue };
                    let Some(name) = u.ingame_name else { continue };
                    orders.push(crate::types::SellerOrder {
                        ingame_name: name,
                        reputation: u.reputation.unwrap_or(0),
                        status,
                        platinum: p,
                        quantity: o.quantity.unwrap_or(1).max(1),
                        rank: o.rank,
                    });
                }
                _ => {}
            }
        }

        // Cheapest first; at equal price prefer the most contactable seller, then
        // the higher reputation.
        let status_rank = |s: &str| match s {
            "ingame" => 0u8,
            "online" => 1,
            _ => 2,
        };
        orders.sort_by(|a, b| {
            a.platinum
                .cmp(&b.platinum)
                .then_with(|| status_rank(&a.status).cmp(&status_rank(&b.status)))
                .then_with(|| b.reputation.cmp(&a.reputation))
        });
        // Cap, but online/ingame-first: this page exists to whisper sellers in-game,
        // and offline sellers routinely hold the lowest prices — a flat cheapest-N
        // truncation would crowd every contactable seller out of the cap (the whole
        // online list would render empty). Keep the cheapest online sellers, then
        // backfill with the cheapest offline ones up to the overall cap. The frontend
        // re-sorts client-side, so this only decides which rows survive.
        let (mut kept, offline): (Vec<_>, Vec<_>) =
            orders.into_iter().partition(|o| is_online(&o.status));
        kept.truncate(60);
        let backfill = 80usize.saturating_sub(kept.len());
        kept.extend(offline.into_iter().take(backfill));
        let orders = kept;

        // Bid ladder, highest price first (the demand curve a buyer reads top-down).
        let mut bids: Vec<crate::types::BuyOrder> = bid_levels
            .into_iter()
            .map(|((rank, platinum), quantity)| crate::types::BuyOrder {
                platinum,
                quantity,
                rank,
            })
            .collect();
        bids.sort_by_key(|b| std::cmp::Reverse(b.platinum));

        Ok(crate::types::ItemSellers {
            display_name,
            max_rank,
            best_buy,
            buyers,
            sellers,
            orders,
            bids,
        })
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
            #[serde(default)]
            data: Vec<RawOrder>,
        }

        let url = format!("{API_V2}/orders/user/{username}");
        let mut req = self.http.get(url);
        if let Some(token) = jwt {
            req = req
                .header("Authorization", format!("JWT {token}"))
                .header("Cookie", format!("JWT={token}"));
        }
        let r = req.send().await?;
        if !r.status().is_success() {
            return Ok(Vec::new());
        }
        let resp: Resp = r.json().await?;
        Ok(resp.data)
    }

    /// Validate a session token against an authenticated endpoint (`GET /v2/me`).
    /// Returns the body text on failure so the caller can surface the real reason.
    pub async fn fetch_me(&self, jwt: &str) -> AppResult<()> {
        self.throttled().await;
        let req = self
            .http
            .get(format!("{API_V2}/me"))
            .header("Authorization", format!("JWT {jwt}"))
            .header("Cookie", format!("JWT={jwt}"));
        self.send_checked(req).await?;
        Ok(())
    }

    /// Create an order (Tier 2 — requires a session JWT). Returns the created order.
    /// `rank` is sent only for ranked goods (mods/arcanes).
    #[allow(clippy::too_many_arguments)]
    pub async fn create_order(
        &self,
        jwt: &str,
        item_id: &str,
        order_type: &str,
        platinum: i64,
        quantity: i64,
        per_trade: i64,
        rank: Option<i64>,
        visible: bool,
    ) -> AppResult<RawOrder> {
        self.throttled().await;

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            item_id: &'a str,
            #[serde(rename = "type")]
            order_type: &'a str,
            platinum: i64,
            quantity: i64,
            // Required by warframe.market v2 (≥ v0.25.0) — units exchanged per
            // in-game trade. Omitting it is a 400 `perTrade: app.field.required`.
            per_trade: i64,
            #[serde(skip_serializing_if = "Option::is_none")]
            rank: Option<i64>,
            visible: bool,
        }
        #[derive(Deserialize)]
        struct Resp {
            data: RawOrder,
        }

        let url = format!("{API_V2}/order");
        let req = self
            .http
            .post(url)
            .header("Authorization", format!("JWT {jwt}"))
            .header("Cookie", format!("JWT={jwt}"))
            .json(&Body {
                item_id,
                order_type,
                platinum,
                quantity,
                per_trade,
                rank,
                visible,
            });
        let resp: Resp = self.send_checked(req).await?.json().await?;
        Ok(resp.data)
    }

    /// Update an existing order's price/quantity/visibility (Tier 2). Returns the updated order.
    pub async fn update_order(
        &self,
        jwt: &str,
        order_id: &str,
        platinum: i64,
        quantity: i64,
        visible: bool,
    ) -> AppResult<RawOrder> {
        self.throttled().await;

        #[derive(Serialize)]
        struct Body {
            platinum: i64,
            quantity: i64,
            visible: bool,
        }
        #[derive(Deserialize)]
        struct Resp {
            data: RawOrder,
        }

        let url = format!("{API_V2}/order/{order_id}");
        let req = self
            .http
            .patch(url)
            .header("Authorization", format!("JWT {jwt}"))
            .header("Cookie", format!("JWT={jwt}"))
            .json(&Body {
                platinum,
                quantity,
                visible,
            });
        let resp: Resp = self.send_checked(req).await?.json().await?;
        Ok(resp.data)
    }

    /// Delete an order (Tier 2).
    pub async fn delete_order(&self, jwt: &str, order_id: &str) -> AppResult<()> {
        self.throttled().await;
        let url = format!("{API_V2}/order/{order_id}");
        let req = self
            .http
            .delete(url)
            .header("Authorization", format!("JWT {jwt}"))
            .header("Cookie", format!("JWT={jwt}"));
        self.send_checked(req).await?;
        Ok(())
    }

    /// Send an authed write, retrying on a 429 (rate-limited → rejected before
    /// processing, so safe to resend even for the create POST). Honors
    /// `Retry-After` when present, else backs off; each retry re-enters the
    /// global throttle. The caller throttles the first attempt. On a final
    /// non-2xx it surfaces the response **body** (where warframe.market puts the
    /// actual reason) instead of a bare status code.
    async fn send_checked(&self, req: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            // Clone so we can resend; JSON bodies always clone (only streams don't).
            let send = req
                .try_clone()
                .ok_or_else(|| AppError::Other("request body not cloneable for retry".into()))?;
            let t = Instant::now();
            let r = match send.send().await {
                Ok(r) => {
                    crate::devtools::rec_market(
                        Some(r.status().as_u16()),
                        t.elapsed(),
                        !r.status().is_success(),
                    );
                    r
                }
                Err(e) => {
                    crate::devtools::rec_market(None, t.elapsed(), true);
                    return Err(e.into());
                }
            };
            let status = r.status();
            if status.is_success() {
                return Ok(r);
            }
            // A rejected session (expired / revoked JWT) is the one write failure
            // the user can act on — surface a plain "reconnect" message instead of
            // the raw status + HTML body.
            if matches!(status.as_u16(), 401 | 403) {
                return Err(AppError::Other(
                    "warframe.market session expired — reconnect your account in Settings.".into(),
                ));
            }
            if status.as_u16() != 429 || attempt >= WRITE_MAX_ATTEMPTS {
                let body = r.text().await.unwrap_or_default();
                return Err(AppError::Other(format!("warframe.market {status}: {body}")));
            }
            let wait = retry_after(&r)
                .map(|d| d.min(RETRY_AFTER_CAP))
                .unwrap_or_else(|| Duration::from_millis(750 * attempt as u64));
            tracing::warn!(
                attempt,
                ?wait,
                "warframe.market write rate-limited — retrying"
            );
            tokio::time::sleep(wait).await;
            self.throttled().await;
        }
    }
}

/// warframe.market's `Retry-After` (seconds) when it includes one on a 429.
fn retry_after(r: &reqwest::Response) -> Option<Duration> {
    let secs: u64 = r
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(secs))
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

/// A raw warframe.market order (v2 user-orders shape). `item_id` is the
/// warframe.market item id, resolved to a catalog slug via `catalog::id_slug_map`.
#[derive(Debug, Clone, Deserialize)]
pub struct RawOrder {
    pub id: String,
    #[serde(rename = "type")]
    pub order_type: String,
    pub platinum: Option<i64>,
    pub quantity: Option<i64>,
    #[serde(default)]
    pub visible: bool,
    #[serde(rename = "itemId")]
    pub item_id: String,
    /// Present for ranked goods (mods/arcanes); absent → non-ranked.
    #[serde(default)]
    pub rank: Option<i64>,
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

    // The 429 fix: concurrent callers must be serialized, not all read the same
    // timestamp and fire together. Four callers ⇒ at least three full gaps of
    // (sequential) waiting after the first, so total ≥ 3 × gap.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn throttle_serializes_concurrent_callers() {
        let m = Market::new();
        let start = Instant::now();
        let tasks: Vec<_> = (0..4)
            .map(|_| {
                let m = m.clone();
                tokio::spawn(async move { m.throttled().await })
            })
            .collect();
        for t in tasks {
            t.await.unwrap();
        }
        let elapsed = start.elapsed();
        let floor = Duration::from_millis(MIN_REQUEST_GAP_MS * 3);
        assert!(
            elapsed >= floor,
            "throttle let callers burst: {elapsed:?} < {floor:?}"
        );
    }

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
