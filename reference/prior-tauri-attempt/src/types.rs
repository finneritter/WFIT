use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryRow {
    pub slug: String,
    pub display_name: String,
    pub part_type: String,
    pub set_slug: Option<String>,
    pub qty: i64,
    pub ducats: Option<i64>,
    pub is_vaulted: bool,
    pub median_plat: Option<i64>,
    pub trend: Option<String>,
    pub thumbnail_url: Option<String>,
    pub last_modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleRow {
    pub id: i64,
    pub slug: String,
    pub display_name: String,
    pub qty: i64,
    pub plat_per_unit: Option<i64>,
    pub market_median_at_sale_time: Option<i64>,
    pub sold_at: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Summary {
    pub total_plat: i64,
    pub prime_part_count: i64,
    pub full_set_count: i64,
    pub total_ducats: i64,
    pub last_synced: Option<String>,
}
