use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Catalog / inventory rows. All transforms (split name, classify) happen in
// Rust; the frontend receives these finished objects.
// ---------------------------------------------------------------------------

/// A catalog row joined with price + ownership. Powers Add Items + the Drawer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub set_slug: Option<String>,
    pub ducats: Option<i64>,
    pub is_vaulted: bool,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub delta_7d: Option<f64>,
    pub volume_7d: Option<i64>, // 7-day trade volume (liquidity sort / thin-market hint)
    pub thumbnail_url: Option<String>,
    pub owned_qty: i64,
    pub on_watchlist: bool,
    pub buy_qty: i64,
}

/// An owned inventory row joined with catalog + price. Powers the Inventory grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub set_slug: Option<String>,
    pub qty: i64,
    pub ducats: Option<i64>,
    pub is_vaulted: bool,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub delta_7d: Option<f64>,
    pub volume_7d: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub last_modified_at: String,
    /// Provenance: 'manual' | 'wfm_import' | 'de_scan'. Empty for collapsed set rows
    /// (a complete set is a derived aggregate with no single origin).
    pub source: String,
    /// When WFIT first recorded this holding (RFC3339). Empty for collapsed set rows.
    pub first_added_at: String,
    /// Rank-aware total value of this row (Σ qty_r × per-rank price). Some only for
    /// owned mods/arcanes with a rank breakdown; None means use median_plat × qty.
    pub value_plat: Option<i64>,
    /// Liquidation-adjusted value (market value haircut by how much the market can
    /// absorb). The honest per-row worth; always ≤ the market value.
    pub realizable_plat: Option<i64>,
    /// Avg units traded per day (volume_7d / 7) — the demand/liquidity signal.
    pub daily_volume: Option<f64>,
    /// Liquidity factor φ = realizable / market value, 0..1 (1 = fully liquid).
    pub liquidity: Option<f64>,
    /// Estimated days to sell the whole stack at current volume (None if no volume).
    pub days_to_sell: Option<i64>,
    /// Confidence in the value: 'high' (actively traded), 'medium', 'low' (thin /
    /// barely trades / riven). Drives how the UI presents the number.
    pub confidence: Option<String>,
    /// Recent median series (≤12 points) for the List-view sparkline. Display-only;
    /// read from price_history, never feeds pricing/valuation. Empty when no history.
    pub spark: Vec<i64>,
    /// Mod rarity (common|uncommon|rare|legendary), or None for non-mods / unmapped.
    pub mod_rarity: Option<String>,
    /// True when this row's value is excluded from the portfolio total (its rarity
    /// is on the user's exclusion list). It still shows in inventory, but value_plat
    /// and realizable_plat are zeroed so totals/summary/trends drop it.
    pub excluded: bool,
}

/// One vendor (Baro/Varzia) stock line enriched against the catalog: market value,
/// whether you already own it, and a buy-it signal. Powers the Rotation Vendors tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VendorIntelRow {
    pub item: String,                  // vendor's display name (as listed)
    pub slug: Option<String>,          // catalog slug if the name resolved (click-to-open)
    pub thumbnail_url: Option<String>, // catalog thumbnail when resolved
    pub median_plat: Option<i64>,      // market value, None if untracked on warframe.market
    pub owned_qty: i64,                // how many you already own (0 = don't have it)
    pub cost: Option<i64>,             // ducats (Baro) or aya (Varzia) — mirrors VendorItem.ducats
    pub credits: Option<i64>,
    /// cost / median_plat — currency spent per plat of resale value (lower = better deal).
    pub cost_per_plat: Option<f64>,
    /// Worth grabbing: a meaningfully valuable item you don't already own.
    pub good_deal: bool,
}

/// Enriched Baro + Varzia stock for the Rotation Vendors tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VendorIntel {
    pub baro: Vec<VendorIntelRow>,
    pub varzia: Vec<VendorIntelRow>,
}

/// A wanted item (watchlist or missing set part) available from a live worldstate
/// reward source right now. Powers the Rotation Overview "Wanted now" panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WantedNowRow {
    pub slug: String,
    pub display_name: String,
    pub source_label: String, // e.g. "Invasion · Sechura (Pluto)" or "Steel Path · Teshin"
    pub eta: Option<String>,  // ISO expiry/eta of the source, when known
}

/// One owned void relic, valued by the expected plat of its drops (relics aren't
/// traded on warframe.market, so worth is inferred from the bundled drop tables).
/// Powers the Relics screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelicRow {
    pub tier: String,
    pub relic_name: String,   // "A1"
    pub refinement: String,   // Intact | Exceptional | Flawless | Radiant
    pub display_name: String, // "Lith A1"
    pub qty: i64,
    pub ev_plat: f64,                  // expected plat per relic at this refinement
    pub best_reward: Option<String>,   // highest-value drop's display name
    pub best_reward_plat: Option<i64>, // and its market price
    pub priced_drops: i64,             // how many of its drops have a market price
    pub total_drops: i64,              // total drops in the table
    pub relic_vaulted: bool,           // the relic itself is vaulted (no longer farmable)
    pub source: String,                // manual | de_scan
    pub first_added_at: String,
}

/// A known relic offered in the manual-add picker (no ownership yet).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelicChoice {
    pub tier: String,
    pub relic_name: String,
    pub display_name: String, // "Lith A1"
}

/// An owned relic whose drops include at least one wanted item (a watch/buy-list
/// item, or the missing part of a set you're 1–2 parts from completing), with those
/// drops called out and a flag for whether a live fissure can crack it right now.
/// Powers the Rotation "Crack" tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackNowRow {
    pub tier: String,
    pub relic_name: String,
    pub refinement: String,
    pub display_name: String,
    pub qty: i64,
    pub ev_plat: f64,
    pub wanted_drops: Vec<String>, // wanted-set drop display names this relic can yield
    pub crackable_now: bool,       // a live fissure of this relic's tier is up right now
}

/// Progress tick for the "Update game data" action, emitted on the
/// `game-data-progress` Tauri event so the UI can show a live bar. `total` 0 means
/// indeterminate (show a sweeping bar); otherwise `current`/`total` is a fraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDataProgress {
    pub step: u32,  // 1-based step index
    pub steps: u32, // total steps
    pub label: String,
    pub current: u32, // within-step progress (e.g. sets done)
    pub total: u32,   // within-step total (0 = indeterminate)
}

/// Result summary of the "Update game data" action (Settings → Data & cache).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDataUpdate {
    pub catalog_new: i64,       // tradeable items added this run
    pub catalog_total: i64,     // total catalog items after
    pub vault_refreshed: bool,  // vault status fetched from WFCD this run
    pub sets_synced: i64,       // set-membership rows written
    pub relics_new: i64,        // distinct relics added this run
    pub relics_total: i64,      // total distinct relics after
    pub relics_refreshed: bool, // relic data fetched from WFCD this run
}

/// One reward row inside a [`CrackPlanRow`]'s drop table (for the expandable detail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackDrop {
    pub reward_name: String,         // catalog display name
    pub chance: f64,                 // drop chance for this refinement, percent
    pub plat: Option<i64>,           // effective price, None if unpriceable (Forma/Kuva/etc.)
    pub wanted: bool,                // on the watch/buy list
    pub set: bool,                   // a missing part of a one-away set
    pub reward_slug: Option<String>, // catalog slug, for deep-linking to the item Drawer
    pub set_slug: Option<String>,    // the set this part completes (set-part drops only)
}

/// A set a relic helps finish (one part away) — a backlink target on the Sets screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackSet {
    pub slug: String,
    pub name: String,
}

/// A prioritized "what to crack next" row for the Relics screen "To crack" tab. A relic
/// appears only if it completes a one-away set, drops a watch/buy-list item, or returns
/// at least `MIN_EV_PLAT` per crack; `score` ranks completes-a-set → wanted → crackable
/// now → EV. `relic_vaulted` is an informational tag only (never lists or ranks a relic).
/// `drops` is the full reward table; `sets` are the one-away sets for the why-backlinks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrackPlanRow {
    pub tier: String,
    pub relic_name: String,
    pub refinement: String,
    pub display_name: String,
    pub qty: i64,
    pub ev_plat: f64,
    pub relic_vaulted: bool, // the relic itself is vaulted (no longer farmable) — tag only
    pub crackable_now: bool, // a live fissure of this relic's tier is up right now
    pub drops: Vec<CrackDrop>, // full reward table (highest-value first)
    pub sets: Vec<CrackSet>, // one-away sets this relic helps finish (why-summary backlinks)
    pub score: f64,          // combined priority (higher = crack sooner)
}

/// Progress of the throttled owned-item price refresh — drives the "pricing…"
/// indicator so the climbing portfolio value reads as "still loading", not a change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricingProgress {
    pub active: bool, // a refresh is in flight
    pub priced: i64,  // owned slugs that now have a price
    pub total: i64,   // owned slugs total
    /// When prices last changed (ISO) — launch drain, manual refresh, or the
    /// live heartbeat. Drives the topbar "live · Xs ago" indicator.
    pub last_price_sync: Option<String>,
}

/// A realized sale (Sold History).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleRow {
    pub id: i64,
    pub slug: String,
    pub display_name: String,
    pub category: String,
    pub qty: i64,
    pub plat_per_unit: Option<i64>,
    pub market_median_at_sale_time: Option<i64>,
    pub sold_at: String,
    pub notes: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// Inventory stat band + sidebar quick-read figures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub total_plat: i64,      // full market value (the optimistic "ceiling")
    pub realizable_plat: i64, // liquidation-adjusted value (the honest headline)
    pub total_ducats: i64,
    pub part_count: i64,     // total units owned (excluding sets)
    pub distinct_count: i64, // distinct owned slugs
    pub full_set_count: i64,
    pub portfolio_7d: Option<f64>, // value-weighted avg 7d % change
    pub hot_count: i64,            // owned items trending up
    pub sold_7d: i64,              // plat earned in the last 7 days
    pub at_target_count: i64,      // watchlist items at/below target
    pub last_synced: Option<String>,
}

// ---------------------------------------------------------------------------
// Watchlist / Buy List.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub delta_7d: Option<f64>,
    pub target_plat: Option<i64>,
    pub is_vaulted: bool,
    pub thumbnail_url: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuyRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub is_vaulted: bool,
    pub buy_qty: i64,
    pub thumbnail_url: Option<String>,
    pub added_at: String,
}

// ---------------------------------------------------------------------------
// Sets / Ducats (computed screens).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPart {
    pub slug: String,
    pub part_name: String, // just the part, e.g. "Systems"
    pub owned: bool,
    pub median_plat: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetRow {
    pub set_slug: String,
    pub set_name: String,
    pub category: String,
    pub total_parts: i64,
    pub owned_parts: i64,
    pub complete: bool,
    pub parts: Vec<SetPart>,
    pub set_value: Option<i64>, // full-set median value (the set item's price)
    pub missing_value: Option<i64>, // plat to buy the missing parts
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DucatRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub qty: i64,
    pub median_plat: Option<i64>,
    pub ducats: i64,
    pub ducats_per_plat: Option<f64>,
    pub verdict: String, // 'ducat' | 'plat'
    pub is_vaulted: bool,
    pub trend: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// One owned item the user should consider listing for plat: liquid (moves
/// 10+/day), not better ducated, outlier-cleaned, and not already listed.
/// Powers the Listings screen's "Recommended" tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecommendationRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub thumbnail_url: Option<String>,
    /// The mod/arcane rank this row prices & lists at; `None` for non-ranked goods.
    /// Each owned rank of a ranked item is a separate row (different good, price).
    pub rank: Option<i64>,
    pub owned_qty: i64,
    pub avg_daily_volume: f64,
    pub suggested_price: i64,
    pub median_plat: Option<i64>,
    pub est_value: i64, // suggested_price * owned_qty
    pub ducats_per_plat: Option<f64>,
    pub trend: Option<String>,
}

// ---------------------------------------------------------------------------
// Arcanes / Vosfor dissolution.
// ---------------------------------------------------------------------------

/// One Loid collection's expected-value summary (per 200-Vosfor pull = 3 arcanes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionEv {
    pub key: String,
    pub name: String,
    pub ev_plat_per_pull: f64, // expected plat from one 200-Vosfor / 3-arcane pull
    pub plat_per_vosfor: f64,
    pub legendary_pct: f64,
    pub coverage: f64, // share of the collection's arcanes that have a price
    pub pool_size: i64,
    pub top: Vec<ArcaneContribution>, // biggest expected-value contributors
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaneContribution {
    pub slug: String,
    pub display_name: String,
    pub prob: f64, // chance a single draw is this arcane
    pub plat: Option<i64>,
}

/// One arcane within a collection — the per-row breakdown behind a collection's EV.
/// Built by the same helper that feeds `CollectionEv`, so the list and the headline
/// can't disagree. Sorted by `ev_contribution` (the value driver).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaneBreakdown {
    pub slug: String,
    pub display_name: String,
    pub rarity: String,       // common | uncommon | rare | legendary
    pub plat: Option<i64>,    // rank-0 (unranked) market price
    pub realizable: i64,      // what one unranked copy actually fetches (drives EV)
    pub vosfor: i64,          // dissolution value per unranked copy
    pub prob: f64,            // chance a single draw is this arcane
    pub ev_contribution: f64, // ARCANES_PER_PULL * prob * realizable
    pub thumbnail_url: Option<String>,
}

/// One owned arcane with its sell-vs-dissolve recommendation, computed over the
/// UNRANKED spare copies (`rank0_copies`) — the actionable, tradeable unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnedArcane {
    pub slug: String,
    pub display_name: String,
    pub qty: i64,
    pub rank0_copies: i64,       // unranked copies (the sell/dissolve unit)
    pub plat: Option<i64>,       // rank-0 (unranked) market price — the sell reference
    pub maxed_plat: Option<i64>, // top-rank price (muted info only; ranking-to-sell loses)
    pub vosfor: i64,             // Vosfor per unranked copy
    // Liquidity-aware split of `rank0_copies`: how many are worth selling vs dissolving.
    pub sell_qty: i64,            // copies recommended to sell
    pub sell_plat: i64,           // realizable plat from selling sell_qty (bids + capped tail)
    pub dissolve_qty: i64,        // copies recommended to dissolve (rank0_copies − sell_qty)
    pub vosfor_total: i64,        // dissolve_qty × vosfor — the recommended-dissolve Vosfor
    pub dissolve_plat_equiv: i64, // vosfor_total × implied plat-per-Vosfor (best collection)
    pub collection: Option<String>,
    pub rarity: Option<String>,
    pub verdict: String, // 'sell' | 'dissolve' (dominant action; UI shows both quantities)
    pub trend: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaneSummary {
    pub total_vosfor: i64, // Vosfor from dissolving the recommended-dissolve copies
    pub owned_count: i64,
    pub sell_plat: i64, // total realizable plat from the recommended-sell copies
    pub best_collection: Option<String>,
    pub best_plat_per_200: f64,
    pub plat_per_vosfor: f64, // implied Vosfor value (best collection) — the conversion rate
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcaneDashboard {
    pub collections: Vec<CollectionEv>,
    pub owned: Vec<OwnedArcane>,
    pub summary: ArcaneSummary,
}

// ---------------------------------------------------------------------------
// Trends.
// ---------------------------------------------------------------------------

/// One catalog item, enriched with the signals the Trends screen ranks on.
/// Shared by the Sell-signals, Buy-candidates and Unusual-moves panels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub median_plat: i64,
    pub delta: f64,      // % move over the selected timeframe
    pub z: f64,          // move normalized by the item's own volatility (std devs)
    pub range_pos: f64,  // 0..1 position of current price within its lookback low..high
    pub range_low: i64,  // lookback low (plat)
    pub range_high: i64, // lookback high (plat)
    pub volume: i64,     // avg daily traded volume over the lookback
    pub owned_qty: i64,
    pub on_watchlist: bool,
    pub spark: Vec<i64>, // recent median series for the mini sparkline
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeatRow {
    pub category: String,
    pub avg_delta: f64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendsData {
    // Market read (row 1).
    pub index_change: f64,
    pub advancing: i64,
    pub declining: i64,
    pub flat: i64,
    pub index_spark: Vec<f64>,
    pub liquid_count: i64,
    pub total_priced: i64,
    // Your holdings (row 1).
    pub holdings_value: i64,
    pub holdings_change: f64, // value-weighted 7d % — same calc as Summary.portfolio_7d
    pub sell_signal_count: i64,
    // Decision panels (row 2) + context (row 3).
    pub sell_signals: Vec<TrendRow>,
    pub buy_candidates: Vec<TrendRow>,
    pub unusual: Vec<TrendRow>,
    pub category_heat: Vec<HeatRow>,
}

// ---------------------------------------------------------------------------
// Item detail (Drawer).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryPoint {
    pub day: String,
    pub median: Option<i64>,
    pub volume: Option<i64>,
    pub open: Option<i64>,
    pub high: Option<i64>,
    pub low: Option<i64>,
    pub close: Option<i64>,
}

/// Live best buy/sell from public warframe.market orders (online sellers/buyers
/// only — the actually-tradeable market). Fetched lazily for the item drawer.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ItemOrders {
    pub best_buy: Option<i64>, // highest buy order — what you'd get selling now
    pub best_sell: Option<i64>, // lowest sell order — what you'd pay buying now
    pub buyers: i64,
    pub sellers: i64,
}

/// One live public SELL order with the seller's identity, so the Market page can
/// build an in-game whisper. `rank` is None for non-ranked items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SellerOrder {
    pub ingame_name: String,
    pub reputation: i64,
    pub status: String, // "ingame" | "online" | "offline"
    pub platinum: i64,
    pub quantity: i64,
    pub rank: Option<i64>,
}

/// One price level of the online bid ladder (demand depth), quantity summed
/// across buyers at that price. Identity is irrelevant to the curve, so only
/// price/qty/rank are kept. `rank` mirrors the seller table for mods/arcanes
/// (rank-0 and max are distinct goods); None for non-ranked items.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuyOrder {
    pub platinum: i64,
    pub quantity: i64,
    pub rank: Option<i64>,
}

/// The Market page's per-item result: the (capped, sorted) seller list plus the
/// item's name/rank ceiling, the live buy-side aggregate, and the online bid
/// ladder (demand depth) — all from one fetch, so the stats strip and depth view
/// need no second (throttled) call to the same endpoint.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ItemSellers {
    pub display_name: String,
    pub max_rank: Option<i64>,
    pub best_buy: Option<i64>, // highest online buy order (for the spread stat)
    pub buyers: i64,           // online buyers
    pub sellers: i64,          // online sellers (pre-cap count)
    pub orders: Vec<SellerOrder>,
    pub bids: Vec<BuyOrder>, // online buy orders, price-desc (demand depth)
}

/// One rank you own of a mod/arcane, with that rank's market price (exact or
/// nearest). Powers the drawer's rank breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnedRank {
    pub rank: i64,
    pub qty: i64,
    pub median: Option<i64>, // per-rank market median (plat)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDetail {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub category: String,
    pub set_slug: Option<String>,
    pub ducats: Option<i64>,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub delta_7d: Option<f64>,
    pub volume_7d: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub owned_qty: i64,
    pub on_watchlist: bool,
    pub listed: bool,
    pub realized_plat: i64,      // total plat from past sales of this item
    pub sold_qty: i64,           // units sold historically
    pub max_rank: Option<i64>,   // rank ceiling (mods/arcanes)
    pub ranks: Vec<OwnedRank>,   // owned rank breakdown (empty for prime parts)
    pub value_plat: Option<i64>, // rank-aware total value of the owned stack (market)
    pub realizable_plat: Option<i64>, // liquidation-adjusted stack value
    pub daily_volume: Option<f64>, // avg units traded/day
    pub liquidity: Option<f64>,  // φ 0..1
    pub days_to_sell: Option<i64>, // est. days to clear the stack
    pub confidence: Option<String>, // 'high' | 'medium' | 'low'
    pub history: Vec<HistoryPoint>,
}

// ---------------------------------------------------------------------------
// warframe.market account / listings (Listings screen).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WfmAccount {
    pub username: Option<String>,
    pub status: Option<String>,
    pub last_import_at: Option<String>,
    pub connected: bool,
    pub has_session: bool, // a JWT is stored in the keychain
    /// Session JWT expiry (rfc3339) and whether it's already past — from the
    /// token's `exp` claim, filled by the command layer. None if no/odd token.
    pub session_expires_at: Option<String>,
    pub session_expired: bool,
}

/// A row in the read-only mirror of your warframe.market sell orders.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingRow {
    pub order_id: String,
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub order_type: String,
    pub your_price: Option<i64>,
    pub qty: i64,
    pub visible: bool,
    pub market_low: Option<i64>, // current market median for context
    pub updated_at: Option<String>,
    pub is_vaulted: bool,
    pub trend: Option<String>,
    pub thumbnail_url: Option<String>,
}

/// A reviewable bulk-reprice row (preview): one current sell order with the
/// recommended new price. `new_price == current_price` means no change.
#[derive(Debug, Clone, Serialize)]
pub struct RepriceRow {
    pub order_id: String,
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub thumbnail_url: Option<String>,
    pub qty: i64,
    pub visible: bool,
    pub current_price: Option<i64>,
    pub new_price: i64,
}

/// A user-confirmed reprice to apply to one order.
#[derive(Debug, Clone, Deserialize)]
pub struct RepriceApply {
    pub order_id: String,
    pub platinum: i64,
    pub quantity: i64,
    pub visible: bool,
}

/// A reviewable import row (preview), before the user confirms it into inventory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub listed_qty: i64,
    pub your_price: Option<i64>,
    pub current_qty: i64, // what inventory already has (conflict surface)
}

// ---------------------------------------------------------------------------
// Game inventory import (memory-scan). Opt-in, consent-gated, Linux-only.
// See docs/GAME_INVENTORY_IMPORT.md / .claude/plans/game-inventory-import.md.
// ---------------------------------------------------------------------------

/// Drives the Settings "Game inventory" section. No scan happens to compute this.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameScanStatus {
    pub supported: bool,        // false on non-Linux (macOS/Windows)
    pub consented: bool,        // typed-phrase risk acceptance recorded
    pub warframe_running: bool, // the game process was detected
    pub auto_sync: bool,        // reserved; not built in v1
    pub last_scan_at: Option<String>,
}

/// A (rank, qty) pair within an owned mod/arcane rank breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankQty {
    pub rank: i64,
    pub qty: i64,
}

/// One row of the reviewable scan diff (added / changed / removed vs current
/// inventory). Nothing is written until the user confirms these into `game_scan_apply`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDiffRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub status: String,      // 'added' | 'changed' | 'removed'
    pub scan_qty: i64,       // total quantity the scan reports (0 for 'removed')
    pub current_qty: i64,    // quantity inventory currently holds
    pub source: String,      // current row provenance: 'manual' | 'wfm_import' | 'de_scan' | ''
    pub ranks: Vec<RankQty>, // per-rank breakdown (mods/arcanes); empty for prime parts
}

/// A confirmed scan row to merge (the user-approved subset of the diff). Carries
/// the rank breakdown back so apply can persist it to inventory_ranks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanApply {
    pub slug: String,
    pub scan_qty: i64,
    #[serde(default)]
    pub ranks: Vec<RankQty>,
}
