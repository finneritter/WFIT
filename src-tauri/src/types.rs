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
    pub thumbnail_url: Option<String>,
    pub owned_qty: i64,
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
}

/// Inventory stat band + sidebar quick-read figures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub total_plat: i64,
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
    pub delta: f64,       // % move over the selected timeframe
    pub z: f64,           // move normalized by the item's own volatility (std devs)
    pub range_pos: f64,   // 0..1 position of current price within its lookback low..high
    pub range_low: i64,   // lookback low (plat)
    pub range_high: i64,  // lookback high (plat)
    pub volume: i64,      // avg daily traded volume over the lookback
    pub owned_qty: i64,
    pub on_watchlist: bool,
    pub spark: Vec<i64>,  // recent median series for the mini sparkline
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
    pub holdings_change: f64, // value-weighted % over the timeframe
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
