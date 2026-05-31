// Thin invoke() wrappers around the Rust command surface. All domain transforms
// live in Rust; these just type the boundary.
import { invoke } from "@tauri-apps/api/core";
import type {
  BuyRow,
  CatalogRow,
  DucatRow,
  ImportRow,
  InventoryRow,
  ItemDetail,
  ItemOrders,
  ListingRow,
  SaleRow,
  SetRow,
  Summary,
  TrendsData,
  WatchRow,
  WfmAccount,
  Worldstate,
} from "./types";

// catalog
export const catalogCount = () => invoke<number>("catalog_count");
export const catalogRefresh = () => invoke<number>("catalog_refresh");
export const rebuildCache = () => invoke<number>("rebuild_cache");
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

// computed
export const getSets = () => invoke<SetRow[]>("get_sets");
export const getDucats = () => invoke<DucatRow[]>("get_ducats");
export const getTrends = (timeframe?: string, excludeOutliers = true) =>
  invoke<TrendsData>("get_trends", { timeframe: timeframe ?? null, excludeOutliers });

// prices / detail
export const pricesRefresh = (slugs?: string[], force?: boolean) =>
  invoke<number>("prices_refresh", { slugs: slugs ?? null, force: force ?? null });
export const getItemDetail = (slug: string) => invoke<ItemDetail>("get_item_detail", { slug });
export const getItemOrders = (slug: string) => invoke<ItemOrders>("get_item_orders", { slug });

// worldstate
export const getWorldstate = () => invoke<Worldstate>("get_worldstate");

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
