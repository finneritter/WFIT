// TS mirrors of the Rust DTOs in src-tauri/src/types.rs. serde serializes with
// the field names as written (snake_case), so these match 1:1.

export type Category = "warframe" | "weapon" | "set" | "mod" | "arcane";
export type Trend = "up" | "flat" | "down";

export interface CatalogRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  set_slug: string | null;
  ducats: number | null;
  is_vaulted: boolean;
  median_plat: number | null;
  trend: Trend | null;
  delta_7d: number | null;
  thumbnail_url: string | null;
  owned_qty: number;
}

export interface InventoryRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  set_slug: string | null;
  qty: number;
  ducats: number | null;
  is_vaulted: boolean;
  median_plat: number | null;
  trend: Trend | null;
  delta_7d: number | null;
  volume_7d: number | null;
  thumbnail_url: string | null;
  last_modified_at: string;
}

export interface SaleRow {
  id: number;
  slug: string;
  display_name: string;
  category: Category;
  qty: number;
  plat_per_unit: number | null;
  market_median_at_sale_time: number | null;
  sold_at: string;
  notes: string | null;
}

export interface Summary {
  total_plat: number;
  total_ducats: number;
  part_count: number;
  distinct_count: number;
  full_set_count: number;
  portfolio_7d: number | null;
  hot_count: number;
  sold_7d: number;
  at_target_count: number;
  last_synced: string | null;
}

export interface WatchRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  median_plat: number | null;
  trend: Trend | null;
  delta_7d: number | null;
  target_plat: number | null;
  thumbnail_url: string | null;
  added_at: string;
}

export interface BuyRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  median_plat: number | null;
  buy_qty: number;
  thumbnail_url: string | null;
  added_at: string;
}

export interface SetPart {
  slug: string;
  part_name: string;
  owned: boolean;
  median_plat: number | null;
}

export interface SetRow {
  set_slug: string;
  set_name: string;
  category: Category;
  total_parts: number;
  owned_parts: number;
  complete: boolean;
  parts: SetPart[];
  set_value: number | null;
  missing_value: number | null;
}

export interface DucatRow {
  slug: string;
  display_name: string;
  part_type: string;
  qty: number;
  median_plat: number | null;
  ducats: number;
  ducats_per_plat: number | null;
  verdict: "ducat" | "plat";
}

export interface TrendRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  median_plat: number;
  delta: number; // % move over the selected timeframe
  z: number; // volatility-normalized move (std devs)
  range_pos: number; // 0..1 within lookback low..high
  range_low: number;
  range_high: number;
  volume: number; // avg daily volume
  owned_qty: number;
  on_watchlist: boolean;
  spark: number[];
}

export interface HeatRow {
  category: Category;
  avg_delta: number;
  count: number;
}

export interface TrendsData {
  index_change: number;
  advancing: number;
  declining: number;
  flat: number;
  index_spark: number[];
  liquid_count: number;
  total_priced: number;
  holdings_value: number;
  holdings_change: number;
  sell_signal_count: number;
  sell_signals: TrendRow[];
  buy_candidates: TrendRow[];
  unusual: TrendRow[];
  category_heat: HeatRow[];
}

export interface HistoryPoint {
  day: string;
  median: number | null;
  volume: number | null;
}

export interface ItemDetail {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  set_slug: string | null;
  ducats: number | null;
  median_plat: number | null;
  trend: Trend | null;
  delta_7d: number | null;
  volume_7d: number | null;
  thumbnail_url: string | null;
  owned_qty: number;
  on_watchlist: boolean;
  listed: boolean;
  history: HistoryPoint[];
}

export interface WfmAccount {
  username: string | null;
  status: string | null;
  last_import_at: string | null;
  connected: boolean;
  has_session: boolean;
}

export interface ListingRow {
  order_id: string;
  slug: string;
  display_name: string;
  part_type: string;
  order_type: string;
  your_price: number | null;
  qty: number;
  visible: boolean;
  market_low: number | null;
  updated_at: string | null;
}

export interface ImportRow {
  slug: string;
  display_name: string;
  part_type: string;
  listed_qty: number;
  your_price: number | null;
  current_qty: number;
}

// Worldstate (Rotation)
export interface Cycle {
  id: string;
  name: string;
  state: string;
  time_left: string | null;
}
export interface Fissure {
  tier: string;
  mission_type: string;
  node: string;
  enemy: string | null;
  expiry: string | null;
  eta: string | null;
  is_hard: boolean;
  is_storm: boolean;
}
export interface Baro {
  active: boolean;
  start: string | null;
  end: string | null;
  location: string | null;
  character: string | null;
}
export interface Worldstate {
  cycles: Cycle[];
  fissures: Fissure[];
  baro: Baro | null;
  fetched_at: string;
}
