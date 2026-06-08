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
  on_watchlist: boolean;
  buy_qty: number;
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
  value_plat: number | null; // rank-aware total value (mods/arcanes); else use median×qty
  realizable_plat: number | null; // liquidation-adjusted value (≤ market value)
  daily_volume: number | null;
  liquidity: number | null; // φ 0..1
  days_to_sell: number | null;
  confidence: "high" | "medium" | "low" | null;
  spark: number[]; // recent median series for the List-view sparkline (display-only)
  mod_rarity: string | null; // common|uncommon|rare|legendary (mods only)
  excluded: boolean; // value excluded from portfolio total (rarity on exclusion list)
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
  thumbnail_url: string | null;
}

export interface Summary {
  total_plat: number;
  realizable_plat: number;
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
  thumbnail_url: string | null;
}

// ---- Arcanes / Vosfor ----
export interface ArcaneContribution {
  slug: string;
  display_name: string;
  prob: number;
  plat: number | null;
}
export interface CollectionEv {
  key: string;
  name: string;
  ev_plat_per_pull: number;
  plat_per_vosfor: number;
  legendary_pct: number;
  coverage: number;
  pool_size: number;
  top: ArcaneContribution[];
}
export interface OwnedArcane {
  slug: string;
  display_name: string;
  qty: number;
  rank0_copies: number;
  plat: number | null;
  maxed_plat: number | null;
  vosfor: number;
  vosfor_total: number;
  collection: string | null;
  rarity: string | null;
  verdict: "keep" | "dissolve";
  thumbnail_url: string | null;
}
export interface ArcaneSummary {
  total_vosfor: number;
  owned_count: number;
  sell_plat: number;
  best_collection: string | null;
  best_plat_per_200: number;
  plat_per_vosfor: number;
}
export interface ArcaneDashboard {
  collections: CollectionEv[];
  owned: OwnedArcane[];
  summary: ArcaneSummary;
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
  thumbnail_url: string | null;
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
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
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
  realized_plat: number;
  sold_qty: number;
  max_rank: number | null;
  ranks: OwnedRank[];
  value_plat: number | null;
  realizable_plat: number | null;
  daily_volume: number | null;
  liquidity: number | null;
  days_to_sell: number | null;
  confidence: "high" | "medium" | "low" | null;
  history: HistoryPoint[];
}

export interface OwnedRank {
  rank: number;
  qty: number;
  median: number | null;
}

export interface ItemOrders {
  best_buy: number | null;
  best_sell: number | null;
  buyers: number;
  sellers: number;
}

export interface SellerOrder {
  ingame_name: string;
  reputation: number;
  status: "ingame" | "online" | "offline";
  platinum: number;
  quantity: number;
  rank: number | null;
}

export interface ItemSellers {
  display_name: string;
  max_rank: number | null;
  best_buy: number | null;
  buyers: number;
  sellers: number;
  orders: SellerOrder[];
}

export interface WfmAccount {
  username: string | null;
  status: string | null;
  last_import_at: string | null;
  connected: boolean;
  has_session: boolean;
  session_expires_at: string | null;
  session_expired: boolean;
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
  thumbnail_url: string | null;
}

export interface ImportRow {
  slug: string;
  display_name: string;
  part_type: string;
  listed_qty: number;
  your_price: number | null;
  current_qty: number;
}

export interface RepriceRow {
  order_id: string;
  slug: string;
  display_name: string;
  part_type: string;
  thumbnail_url: string | null;
  qty: number;
  visible: boolean;
  current_price: number | null;
  new_price: number;
}

export interface RepriceApply {
  order_id: string;
  platinum: number;
  quantity: number;
  visible: boolean;
}

// Game inventory import (memory-scan) — opt-in, consent-gated, Linux-only.
export interface GameScanStatus {
  supported: boolean;
  consented: boolean;
  warframe_running: boolean;
  auto_sync: boolean;
  last_scan_at: string | null;
}
export interface RankQty {
  rank: number;
  qty: number;
}
export interface ScanDiffRow {
  slug: string;
  display_name: string;
  part_type: string;
  status: "added" | "changed" | "removed";
  scan_qty: number;
  current_qty: number;
  source: string;
  ranks: RankQty[];
}
export interface ScanApply {
  slug: string;
  scan_qty: number;
  ranks: RankQty[];
}

// Worldstate (Rotation)
export interface Cycle {
  id: string;
  name: string;
  state: string;
  time_left: string | null;
  expiry: string | null;
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
export interface VendorItem {
  item: string;
  // Baro: ducats. Varzia: the wrapper reuses this key for the AYA cost.
  ducats: number | null;
  credits: number | null;
}
export interface Trader {
  active: boolean;
  activation: string | null;
  expiry: string | null;
  location: string | null;
  character: string | null;
  inventory: VendorItem[];
}
export interface SortieMission {
  node: string;
  mission_type: string;
  modifier: string | null;
  modifier_desc: string | null;
}
// One shape for the daily sortie AND the weekly archon hunt (no modifiers).
export interface Sortie {
  boss: string;
  faction: string;
  activation: string | null;
  expiry: string | null;
  missions: SortieMission[];
}
export interface SpReward {
  name: string;
  cost: number | null; // Steel Essence
}
export interface SteelPath {
  current_reward: SpReward | null;
  activation: string | null;
  expiry: string | null;
  rotation: SpReward[];
}
export interface Arbitration {
  node: string;
  mission_type: string;
  enemy: string | null;
  tier: string | null; // community S–D rating (browse.wf), null = unrated
  activation: string;
  expiry: string;
}
export interface ArbitrationBlock {
  current: Arbitration | null;
  upcoming: Arbitration[];
  /** Next few S/A-tier arbitrations from the whole schedule (can be days out). */
  notable: Arbitration[];
}
export interface NightwaveChallenge {
  title: string;
  desc: string | null;
  reputation: number;
  is_daily: boolean;
  is_elite: boolean;
  expiry: string | null;
}
export interface Nightwave {
  season: number | null;
  expiry: string | null; // season end
  challenges: NightwaveChallenge[]; // biggest standing first
}
export interface Invasion {
  node: string;
  attacker: string;
  defender: string;
  attacker_reward: string | null;
  defender_reward: string | null;
  completion: number; // attacker-side progress, 0–100
  eta: string | null;
}
export interface PricingProgress {
  active: boolean;
  priced: number;
  total: number;
  // When prices last changed (launch drain / manual refresh / live heartbeat);
  // drives the topbar "live · Xs" indicator.
  last_price_sync: string | null;
}

export interface Worldstate {
  cycles: Cycle[];
  fissures: Fissure[];
  baro: Trader | null;
  varzia: Trader | null;
  sortie: Sortie | null;
  archon_hunt: Sortie | null;
  steel_path: SteelPath | null;
  nightwave: Nightwave | null;
  invasions: Invasion[];
  arbitration: ArbitrationBlock | null;
  fetched_at: string;
  source_timestamp: string | null; // warframestat.us snapshot time; null if absent
  // "de" = fissures cross-checked against DE's raw worldstate (the normal,
  // authoritative case); "warframestat" = wrapper-only fallback (DE unreachable).
  fissure_source: "de" | "warframestat";
}
