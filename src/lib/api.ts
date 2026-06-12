// Thin invoke() wrappers around the Rust command surface. All domain transforms
// live in Rust; these just type the boundary.
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type {
  ArcaneDashboard,
  BackupInfo,
  BuyRow,
  CatalogRow,
  DucatRow,
  GameScanStatus,
  ImportRow,
  InventoryRow,
  ItemDetail,
  ItemOrders,
  ItemSellers,
  ListingRow,
  PricingProgress,
  RepriceApply,
  RepriceRow,
  SaleRow,
  ScanApply,
  ScanDiffRow,
  SetRow,
  StartupStatus,
  Summary,
  TrendsData,
  WatchRow,
  WfmAccount,
  Worldstate,
} from "./types";

// app
export const appVersion = () => getVersion();

// startup / recovery (work without AppState — usable on the recovery screen)
export const startupStatus = () => invoke<StartupStatus>("startup_status");
export const recoveryBackupDb = () => invoke<string>("recovery_backup_db");
export const recoveryResetDb = () => invoke<void>("recovery_reset_db");

// backups
export const backupNow = () => invoke<string>("backup_now");
export const listBackups = () => invoke<BackupInfo[]>("list_backups");
export const openBackupsDir = () => invoke<void>("open_backups_dir");

// catalog
export const catalogCount = () => invoke<number>("catalog_count");
export const catalogRefresh = () => invoke<number>("catalog_refresh");
export const rebuildCache = () => invoke<number>("rebuild_cache");
export const wipeApp = () => invoke<void>("wipe_app");
export const setsRefresh = () => invoke<number>("sets_refresh");
export const getCatalog = (category?: string) =>
  invoke<CatalogRow[]>("get_catalog", { category: category ?? null });
export const searchCatalog = (q: string, limit?: number) =>
  invoke<CatalogRow[]>("search_catalog", { q, limit: limit ?? null });

// inventory
export const getInventory = () => invoke<InventoryRow[]>("get_inventory");
export const addToInventory = (slug: string, qty?: number) =>
  invoke<number>("add_to_inventory", { slug, qty: qty ?? null });
export const setQty = (slug: string, qty: number) => invoke<number>("set_qty", { slug, qty });
export const removeItem = (slug: string) => invoke<void>("remove_item", { slug });
export const getSummary = () => invoke<Summary>("get_summary");

// sales
export const recordSale = (slug: string, qty?: number, platPerUnit?: number, notes?: string) =>
  invoke<number>("record_sale", {
    slug,
    qty: qty ?? null,
    platPerUnit: platPerUnit ?? null,
    notes: notes ?? null,
  });
export const undoSale = (id: number) => invoke<void>("undo_sale", { id });
export const getSales = (limit?: number) =>
  invoke<SaleRow[]>("get_sales", { limit: limit ?? null });

// watchlist
export const getWatchlist = () => invoke<WatchRow[]>("get_watchlist");
export const addWatch = (slug: string, target?: number) =>
  invoke<void>("add_watch", { slug, target: target ?? null });
export const removeWatch = (slug: string) => invoke<void>("remove_watch", { slug });
export const setTarget = (slug: string, target?: number) =>
  invoke<void>("set_target", { slug, target: target ?? null });

// buy list
export const getBuyList = () => invoke<BuyRow[]>("get_buy_list");
export const addToBuyList = (slug: string, qty?: number) =>
  invoke<void>("add_to_buy_list", { slug, qty: qty ?? null });
export const setBuyQty = (slug: string, qty: number) => invoke<void>("set_buy_qty", { slug, qty });
export const removeBuy = (slug: string) => invoke<void>("remove_buy", { slug });
export const purchaseBuy = (slug: string) => invoke<number>("purchase_buy", { slug });
export const getBudget = () => invoke<number | null>("get_budget");
export const setBudget = (value: number) => invoke<void>("set_budget", { value });

export const getExcludedRarities = () => invoke<string[]>("get_excluded_rarities");
export const setExcludedRarities = (rarities: string[]) =>
  invoke<void>("set_excluded_rarities", { rarities });
export const getExcludedMinPlat = () => invoke<number>("get_excluded_min_plat");
export const setExcludedMinPlat = (value: number) =>
  invoke<void>("set_excluded_min_plat", { value });
export const getExcludedMinPlatByCat = () =>
  invoke<Record<string, number>>("get_excluded_min_plat_by_cat");
export const setExcludedMinPlatByCat = (thresholds: Record<string, number>) =>
  invoke<void>("set_excluded_min_plat_by_cat", { thresholds });
export const getPricingProgress = () => invoke<PricingProgress>("get_pricing_progress");

// computed
export const getSets = () => invoke<SetRow[]>("get_sets");
export const getDucats = () => invoke<DucatRow[]>("get_ducats");
export const getArcaneDashboard = () => invoke<ArcaneDashboard>("get_arcane_dashboard");
export const getTrends = (timeframe?: string, excludeOutliers = true) =>
  invoke<TrendsData>("get_trends", { timeframe: timeframe ?? null, excludeOutliers });

// prices / detail
export const pricesRefresh = (slugs?: string[], force?: boolean) =>
  invoke<number>("prices_refresh", { slugs: slugs ?? null, force: force ?? null });
export const getItemDetail = (slug: string) => invoke<ItemDetail>("get_item_detail", { slug });
export const getItemOrders = (slug: string) => invoke<ItemOrders>("get_item_orders", { slug });
export const getItemSellers = (slug: string) => invoke<ItemSellers>("get_item_sellers", { slug });

// worldstate
export const getWorldstate = () => invoke<Worldstate>("get_worldstate");
// Hard reset: discard the backend's worldstate + arbitration caches and re-fetch.
export const forceWorldstateRefresh = () => invoke<Worldstate>("force_worldstate_refresh");

// wfm account
export const getWfmAccount = () => invoke<WfmAccount>("get_wfm_account");
export const wfmConnect = (username: string) => invoke<WfmAccount>("wfm_connect", { username });
export const wfmSetSession = (jwt: string) => invoke<WfmAccount>("wfm_set_session", { jwt });
export const wfmSignout = () => invoke<void>("wfm_signout");
export const wfmSyncListings = () => invoke<number>("wfm_sync_listings");
export const wfmGetListings = () => invoke<ListingRow[]>("wfm_get_listings");
export const wfmFetchListings = () => invoke<ImportRow[]>("wfm_fetch_listings");
export const wfmApplyImport = (rows: { slug: string; qty: number }[]) =>
  invoke<number>("wfm_apply_import", { rows });
export const wfmCreateOrder = (args: {
  slug: string;
  platinum: number;
  quantity: number;
  rank: number | null;
  visible: boolean;
}) => invoke<number>("wfm_create_order", args);
export const wfmUpdateOrder = (args: {
  orderId: string;
  platinum: number;
  quantity: number;
  visible: boolean;
}) => invoke<number>("wfm_update_order", args);
export const wfmDeleteOrder = (orderId: string) => invoke<number>("wfm_delete_order", { orderId });
export const wfmMarkSold = (orderId: string) => invoke<number>("wfm_mark_sold", { orderId });
export const wfmSetStatus = (status: string) => invoke<WfmAccount>("wfm_set_status", { status });
export const getRecommendedPrice = (slug: string, rank: number | null) =>
  invoke<number | null>("get_recommended_price", { slug, rank });
export const wfmRepricePreview = () => invoke<RepriceRow[]>("wfm_reprice_preview");
export const wfmRepriceApply = (orders: RepriceApply[]) =>
  invoke<number>("wfm_reprice_apply", { orders });

// game inventory import (memory-scan) — opt-in, consent-gated, Linux-only
export const gameScanStatus = () => invoke<GameScanStatus>("game_scan_status");
export const gameScanConsent = (phrase: string) => invoke<void>("game_scan_consent", { phrase });
export const gameScanRevoke = () => invoke<void>("game_scan_revoke");
export const gameScanPreview = () => invoke<ScanDiffRow[]>("game_scan_preview");
export const gameScanApply = (rows: ScanApply[]) => invoke<number>("game_scan_apply", { rows });
