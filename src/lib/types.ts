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
  volume_7d: number | null; // 7-day trade volume (liquidity sort / thin-market hint)
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
  source: string; // 'manual' | 'wfm_import' | 'de_scan'; "" for collapsed set rows
  first_added_at: string; // RFC3339 when WFIT first recorded it; "" for collapsed sets
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
  is_vaulted: boolean;
  thumbnail_url: string | null;
  added_at: string;
}

export interface BuyRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: Category;
  median_plat: number | null;
  trend: Trend | null;
  is_vaulted: boolean;
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
  is_vaulted: boolean;
  trend: Trend | null;
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
export interface ArcaneBreakdown {
  slug: string;
  display_name: string;
  rarity: string;
  plat: number | null;
  realizable: number;
  vosfor: number;
  prob: number;
  ev_contribution: number;
  thumbnail_url: string | null;
}
export interface OwnedArcane {
  slug: string;
  display_name: string;
  qty: number;
  rank0_copies: number;
  plat: number | null; // rank-0 (unranked) price — the sell reference
  maxed_plat: number | null; // muted info only
  vosfor: number; // per unranked copy
  sell_qty: number;
  sell_plat: number;
  dissolve_qty: number;
  vosfor_total: number; // dissolve_qty × vosfor
  dissolve_plat_equiv: number;
  collection: string | null;
  rarity: string | null;
  verdict: "sell" | "dissolve";
  trend: Trend | null;
  thumbnail_url: string | null;
}
export interface ArcaneSummary {
  total_vosfor: number; // recommended-dissolve Vosfor
  owned_count: number;
  sell_plat: number; // recommended-sell realizable plat
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

/** One price level of the online bid ladder (demand depth), qty summed across
 *  buyers at that price. `rank` mirrors the seller table for mods/arcanes. */
export interface BuyOrder {
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
  bids: BuyOrder[];
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

// Result of the developer "simulate fake inventory" tool (1:1 with Rust SimSummary).
export interface SimSummary {
  items: number;
  mods: number;
  arcanes: number;
  resources: number;
  platinum: number;
  credits: number;
  backup_path: string;
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
  is_vaulted: boolean;
  trend: Trend | null;
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

export interface RecommendationRow {
  slug: string;
  display_name: string;
  part_type: string;
  category: string;
  thumbnail_url: string | null;
  rank: number | null;
  owned_qty: number;
  avg_daily_volume: number;
  suggested_price: number;
  median_plat: number | null;
  est_value: number;
  ducats_per_plat: number | null;
  trend: Trend | null;
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

// Account section (Profile · Codex · Resources · Arsenal) — mirrors src-tauri/src/types.rs
export interface IntrinsicRow {
  skill_key: string;
  label: string;
  rank: number;
}
export interface SyndicateRow {
  tag: string;
  label: string;
  standing: number;
  title: string | null;
}
export interface AccountProfile {
  has_data: boolean;
  scanned_at: string | null;
  mastery_rank: number;
  mr_into_next: number;
  mr_needed: number;
  equipped_glyph: string | null;
  equipped_glyph_name: string | null;
  created: string | null;
  credits: number;
  platinum: number;
  regal_aya: number;
  endo: number;
  trades_remaining: number;
  gifts_remaining: number;
  nodes_completed: number;
  nodes_total: number;
  total_missions: number;
  daily_focus: number;
  focus_xp: number;
  login_streak: number;
  guild_id: string | null;
  alignment: string | null;
  training_date: string | null;
  total_mastery_points: number;
  intrinsics: IntrinsicRow[];
  syndicates: SyndicateRow[];
}
export interface GearRow {
  unique_name: string;
  display_name: string;
  category: string;
  icon_url: string | null;
  slug: string | null;
  rank: number;
  max_rank: number;
  mastered: boolean;
  mastery_req: number | null;
}
export interface ResourceRow {
  unique_name: string;
  display_name: string;
  kind: string;
  icon_url: string | null;
  slug: string | null;
  count: number;
}
export interface CodexCategory {
  category: string;
  owned: number;
  total: number;
  mastered: number;
}
export interface LoreScanRow {
  display_name: string;
  scans: number;
}
export interface CodexData {
  has_data: boolean;
  categories: CodexCategory[];
  total_owned: number;
  total_items: number;
  total_mastered: number;
  total_mastery_points: number;
  lore_scans: LoreScanRow[];
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
// Vendor stock enriched against the catalog (Rotation Vendors tab).
export interface VendorIntelRow {
  item: string;
  slug: string | null;
  thumbnail_url: string | null;
  median_plat: number | null;
  owned_qty: number;
  cost: number | null; // ducats (Baro) or aya (Varzia)
  credits: number | null;
  cost_per_plat: number | null; // cost / median_plat (lower = better)
  good_deal: boolean;
}
export interface VendorIntel {
  baro: VendorIntelRow[];
  varzia: VendorIntelRow[];
}
// A wanted item available from a live reward source now (Rotation Overview).
export interface WantedNowRow {
  slug: string;
  display_name: string;
  source_label: string;
  eta: string | null;
}
// Owned void relic, valued by expected drop plat (Relics screen).
export interface RelicRow {
  tier: string;
  relic_name: string;
  refinement: string;
  display_name: string;
  qty: number;
  ev_plat: number;
  best_reward: string | null;
  best_reward_plat: number | null;
  priced_drops: number;
  total_drops: number;
  relic_vaulted: boolean;
  source: string;
  first_added_at: string;
}
export interface RelicChoice {
  tier: string;
  relic_name: string;
  display_name: string;
}
// An owned relic that can drop a wanted item — a watch/buy-list item or the missing
// part of a near-complete set (Rotation "Crack" tab). crackable_now flags whether a
// live fissure of its tier is up right now.
export interface CrackNowRow {
  tier: string;
  relic_name: string;
  refinement: string;
  display_name: string;
  qty: number;
  ev_plat: number;
  wanted_drops: string[];
  crackable_now: boolean;
}
// Live progress tick for "Update game data" (game-data-progress event). total 0 =
// indeterminate (sweeping bar); otherwise current/total is a fraction.
export interface GameDataProgress {
  step: number;
  steps: number;
  label: string;
  current: number;
  total: number;
}
// Result summary of the "Update game data" action (Settings → Data & cache).
export interface GameDataUpdate {
  catalog_new: number;
  catalog_total: number;
  vault_refreshed: boolean;
  sets_synced: number;
  relics_new: number;
  relics_total: number;
  relics_refreshed: boolean;
  manifest_total: number;
  manifest_refreshed: boolean;
}
// One reward in a relic's drop table (for the To-crack expandable detail).
export interface CrackDrop {
  reward_name: string;
  chance: number;
  plat: number | null;
  wanted: boolean; // on the watch/buy list
  set: boolean; // a missing part of a one-away set
  reward_slug: string | null; // catalog slug → item Drawer
  set_slug: string | null; // the set this part completes → Sets page
}
// A set this relic helps finish (one part away) — a backlink target on the Sets screen.
export interface CrackSet {
  slug: string;
  name: string;
}
// A prioritized "what to crack next" row for the Relics "To crack" tab. A relic appears
// only if it completes a one-away set, drops a watch/buy item, or returns ≥15p/crack.
// `relic_vaulted` is an informational tag only. `sets` are the one-away set backlinks.
export interface CrackPlanRow {
  tier: string;
  relic_name: string;
  refinement: string;
  display_name: string;
  qty: number;
  ev_plat: number;
  relic_vaulted: boolean;
  crackable_now: boolean;
  drops: CrackDrop[];
  sets: CrackSet[];
  score: number;
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
// Startup health + DB backups
export interface StartupStatus {
  ok: boolean;
  error: string | null;
  db_path: string | null;
}
export interface BackupInfo {
  file_name: string;
  size_bytes: number;
  modified_at: string;
}

export interface PricingProgress {
  active: boolean;
  priced: number;
  total: number;
  // When prices last changed (launch drain / manual refresh / live heartbeat);
  // drives the topbar "live · Xs" indicator.
  last_price_sync: string | null;
}

// Desktop-notification + close-to-tray preferences (one JSON blob in app_settings).
export interface NotificationPrefs {
  master_enabled: boolean;
  close_to_tray: boolean;
  s_tier_arbitration: boolean;
  void_cascade: boolean;
  vendor_arrival: boolean;
  daily_reset: boolean;
  weekly_reset: boolean;
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
