// React Query hooks over the api layer. Mutations invalidate the related read
// keys so the UI updates live across screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo } from "react";
import * as api from "../lib/api";
import { pushToast } from "../lib/toast";
import type { CatalogRow, NotificationPrefs, RepriceApply, ScanApply } from "../lib/types";

type QC = ReturnType<typeof useQueryClient>;

// Patch one slug's row across every cached catalog category in place. Lets the
// Add-items grid reflect ownership instantly without refetching all five columns;
// the eventual (refetchType: "none") staleness reconciles any edge cases on reopen.
function patchCatalogRow(qc: QC, slug: string, update: (r: CatalogRow) => CatalogRow) {
  qc.setQueriesData<CatalogRow[]>({ queryKey: ["catalog"] }, (rows) =>
    rows?.map((r) => (r.slug === slug ? update(r) : r)),
  );
}

export const keys = {
  inventory: ["inventory"] as const,
  summary: ["summary"] as const,
  sales: ["sales"] as const,
  watchlist: ["watchlist"] as const,
  buyList: ["buyList"] as const,
  budget: ["budget"] as const,
  excludedRarities: ["excludedRarities"] as const,
  excludedMinPlat: ["excludedMinPlat"] as const,
  excludedMinPlatByCat: ["excludedMinPlatByCat"] as const,
  notificationPrefs: ["notificationPrefs"] as const,
  sets: ["sets"] as const,
  ducats: ["ducats"] as const,
  arcanes: ["arcanes"] as const,
  catalog: (cat?: string) => ["catalog", cat ?? "all"] as const,
  trends: (tf: string, excludeOutliers: boolean) => ["trends", tf, excludeOutliers] as const,
  itemDetail: (slug: string) => ["itemDetail", slug] as const,
  searchCatalog: (q: string, limit: number) => ["searchCatalog", q, limit] as const,
  itemOrders: (slug: string) => ["itemOrders", slug] as const,
  itemSellers: (slug: string) => ["itemSellers", slug] as const,
  recommendedPrice: (slug: string, rank: number | null) =>
    ["recommendedPrice", slug, rank] as const,
  worldstate: ["worldstate"] as const,
  pricingProgress: ["pricingProgress"] as const,
  wfmAccount: ["wfmAccount"] as const,
  listings: ["listings"] as const,
  gameScan: ["gameScan"] as const,
  backups: ["backups"] as const,
};

// Anything that touches inventory ripples into these derived views.
function invalidateInventoryDerived(qc: QC) {
  for (const k of [
    keys.inventory,
    keys.summary,
    keys.sets,
    keys.ducats,
    keys.arcanes,
    keys.watchlist,
    keys.buyList,
  ]) {
    qc.invalidateQueries({ queryKey: k });
  }
  qc.invalidateQueries({ queryKey: ["trends"] });
  // Catalog rows carry owned_qty (joined from inventory). Mark stale but DON'T
  // force-refetch all five category queries on every edit — the open Add-items
  // grid is patched optimistically (patchCatalogRow); inactive catalog queries
  // refetch lazily on next mount.
  qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
}

// ---- reads ----
export const useAppVersion = () =>
  useQuery({
    queryKey: ["appVersion"],
    queryFn: api.appVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });
export const useInventory = () => useQuery({ queryKey: keys.inventory, queryFn: api.getInventory });
export const useSummary = () => useQuery({ queryKey: keys.summary, queryFn: api.getSummary });
export const useSales = () => useQuery({ queryKey: keys.sales, queryFn: () => api.getSales() });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: api.getWatchlist });
export const useBuyList = () => useQuery({ queryKey: keys.buyList, queryFn: api.getBuyList });
export const useBudget = () => useQuery({ queryKey: keys.budget, queryFn: api.getBudget });
export const useSets = () => useQuery({ queryKey: keys.sets, queryFn: api.getSets });
export const useDucats = () => useQuery({ queryKey: keys.ducats, queryFn: api.getDucats });
export const useArcaneDashboard = () =>
  useQuery({ queryKey: keys.arcanes, queryFn: api.getArcaneDashboard });
export const useCatalog = (cat?: string) =>
  useQuery({ queryKey: keys.catalog(cat), queryFn: () => api.getCatalog(cat) });
export const useSearchCatalog = (q: string, limit = 40) =>
  useQuery({
    queryKey: keys.searchCatalog(q, limit),
    queryFn: () => api.searchCatalog(q, limit),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
export const useTrends = (tf: string, excludeOutliers = true) =>
  useQuery({
    queryKey: keys.trends(tf, excludeOutliers),
    queryFn: () => api.getTrends(tf, excludeOutliers),
  });
export const useItemDetail = (slug: string | null) =>
  useQuery({
    queryKey: keys.itemDetail(slug ?? ""),
    queryFn: () => api.getItemDetail(slug as string),
    enabled: !!slug,
  });
export const useItemOrders = (slug: string | null) =>
  useQuery({
    queryKey: keys.itemOrders(slug ?? ""),
    queryFn: () => api.getItemOrders(slug as string),
    enabled: !!slug,
    staleTime: 60_000,
  });

export const useItemSellers = (slug: string | null) =>
  useQuery({
    queryKey: keys.itemSellers(slug ?? ""),
    queryFn: () => api.getItemSellers(slug as string),
    enabled: !!slug,
    staleTime: 30_000,
  });
export const useWorldstate = () =>
  useQuery({
    queryKey: keys.worldstate,
    queryFn: api.getWorldstate,
    refetchInterval: 45_000,
    // Rotation is a companion screen — usually visible on a second monitor
    // while the game holds focus. Default React Query behavior pauses interval
    // refetching for unfocused windows, which froze this page mid-session.
    refetchIntervalInBackground: true,
  });
// Hard reset: the backend discards its worldstate + arbitration caches and
// re-fetches from the live sources; the fresh payload lands in the query cache
// immediately (no second round-trip). Errors only when every source is down.
export const useWorldstateHardReset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.forceWorldstateRefresh,
    onSuccess: (ws) => qc.setQueryData(keys.worldstate, ws),
  });
};
// Poll fast while a refresh is in flight, slow otherwise (to notice it starting).
export const usePricingProgress = () =>
  useQuery({
    queryKey: keys.pricingProgress,
    queryFn: api.getPricingProgress,
    refetchInterval: (q) => (q.state.data?.active ? 2000 : 7000),
  });
export const useWfmAccount = () =>
  useQuery({ queryKey: keys.wfmAccount, queryFn: api.getWfmAccount });
export const useListings = () => useQuery({ queryKey: keys.listings, queryFn: api.wfmGetListings });
// Slugs with an active warframe.market sell order → drives the "LISTED" tag on
// every item-bearing screen. Empty (and cheap) when no account is connected.
export const useListedSlugs = () => {
  const { data = [] } = useListings();
  return useMemo(() => new Set(data.map((l) => l.slug)), [data]);
};

// ---- inventory mutations ----
export function useAddToInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, qty }: { slug: string; qty?: number }) => api.addToInventory(slug, qty),
    onSuccess: (_data, { slug, qty }) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, owned_qty: r.owned_qty + (qty ?? 1) }));
      invalidateInventoryDerived(qc);
    },
  });
}

export function useSetQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, qty }: { slug: string; qty: number }) => api.setQty(slug, qty),
    onSuccess: (_data, { slug, qty }) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, owned_qty: qty }));
      invalidateInventoryDerived(qc);
    },
  });
}

export function useRemoveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeItem(slug),
    onSuccess: (_data, slug) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, owned_qty: 0 }));
      invalidateInventoryDerived(qc);
    },
  });
}

// ---- sales ----
export function useRecordSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; qty?: number; platPerUnit?: number }) =>
      api.recordSale(a.slug, a.qty, a.platPerUnit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.sales });
      invalidateInventoryDerived(qc);
    },
  });
}

export function useUndoSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.undoSale(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.sales });
      invalidateInventoryDerived(qc);
    },
  });
}

// ---- watchlist ----
export function useAddWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; target?: number }) => api.addWatch(a.slug, a.target),
    onSuccess: (_data, { slug }) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, on_watchlist: true }));
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
    },
  });
}
export function useRemoveWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeWatch(slug),
    onSuccess: (_data, slug) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, on_watchlist: false }));
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
    },
  });
}
export function useSetTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; target?: number }) => api.setTarget(a.slug, a.target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

// ---- buy list ----
export function useAddToBuyList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; qty?: number }) => api.addToBuyList(a.slug, a.qty),
    onSuccess: (_data, { slug, qty }) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, buy_qty: qty ?? 1 }));
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
    },
  });
}
export function useSetBuyQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; qty: number }) => api.setBuyQty(a.slug, a.qty),
    onSuccess: (_data, { slug, qty }) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, buy_qty: qty }));
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
    },
  });
}
export function useRemoveBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeBuy(slug),
    onSuccess: (_data, slug) => {
      patchCatalogRow(qc, slug, (r) => ({ ...r, buy_qty: 0 }));
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"], refetchType: "none" });
    },
  });
}
export function usePurchaseBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.purchaseBuy(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.buyList });
      invalidateInventoryDerived(qc);
    },
  });
}
export function useSetBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: number) => api.setBudget(value),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.budget }),
  });
}
export const useExcludedRarities = () =>
  useQuery({ queryKey: keys.excludedRarities, queryFn: api.getExcludedRarities });
export function useSetExcludedRarities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rarities: string[]) => api.setExcludedRarities(rarities),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.excludedRarities });
      // The exclusion changes every value-bearing view (totals, summary, trends).
      invalidateInventoryDerived(qc);
    },
  });
}
export const useExcludedMinPlat = () =>
  useQuery({ queryKey: keys.excludedMinPlat, queryFn: api.getExcludedMinPlat });
export function useSetExcludedMinPlat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: number) => api.setExcludedMinPlat(value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.excludedMinPlat });
      invalidateInventoryDerived(qc);
    },
  });
}
export const useExcludedMinPlatByCat = () =>
  useQuery({ queryKey: keys.excludedMinPlatByCat, queryFn: api.getExcludedMinPlatByCat });
export function useSetExcludedMinPlatByCat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (thresholds: Record<string, number>) => api.setExcludedMinPlatByCat(thresholds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.excludedMinPlatByCat });
      invalidateInventoryDerived(qc);
    },
  });
}

// ---- notifications + close-to-tray ----
export const useNotificationPrefs = () =>
  useQuery({ queryKey: keys.notificationPrefs, queryFn: api.getNotificationPrefs });
export function useSetNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) => api.setNotificationPrefs(prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notificationPrefs }),
  });
}

// ---- live heartbeat ----
// The backend's rolling repricer emits `prices-updated` after every tick that
// changed something (lib.rs::spawn_price_heartbeat). Refetch the value-bearing
// views right then, so new data appears moments after it lands — the "alive"
// feel — instead of waiting for a poll or a manual refresh.
export function useLivePriceEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const un = listen("prices-updated", () => {
      invalidateInventoryDerived(qc);
      qc.invalidateQueries({ queryKey: keys.listings });
      qc.invalidateQueries({ queryKey: keys.pricingProgress });
      // Market-screen order books and the drawer's recommended price come from
      // the same caches the heartbeat just refreshed. Only refetch what's on
      // screen — these are per-slug queries and most are unmounted.
      qc.invalidateQueries({ queryKey: ["itemOrders"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["itemSellers"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["recommendedPrice"], refetchType: "active" });
    });
    return () => {
      un.then((f) => f());
    };
  }, [qc]);
}

// ---- refresh / catalog ----
export function usePricesRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slugs?: string[]; force?: boolean } = {}) =>
      api.pricesRefresh(a.slugs, a.force),
    onSuccess: () => {
      invalidateInventoryDerived(qc); // already marks catalog stale (refetchType: none)
    },
  });
}

export function useCatalogRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.catalogRefresh(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog"] }),
  });
}

export function useSetsRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.setsRefresh(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sets }),
  });
}

export function useRebuildCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rebuildCache(),
    onSuccess: () => qc.invalidateQueries(), // caches wiped — refetch everything
  });
}

// ---- backups ----
export const useBackups = () => useQuery({ queryKey: keys.backups, queryFn: api.listBackups });
export function useBackupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.backupNow(),
    onSuccess: (path) => {
      pushToast(`Backup saved: ${path}`, "info");
      qc.invalidateQueries({ queryKey: keys.backups });
    },
  });
}

// ---- wfm account ----
export function useWfmConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.wfmConnect(username),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.wfmAccount }),
  });
}
export function useWfmSetSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jwt: string) => api.wfmSetSession(jwt),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.wfmAccount }),
  });
}
export function useWfmSignout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.wfmSignout(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.wfmAccount });
      qc.invalidateQueries({ queryKey: keys.listings });
    },
  });
}
export function useWfmSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.wfmSyncListings(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.listings }),
  });
}
export function useWfmApplyImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: { slug: string; qty: number }[]) => api.wfmApplyImport(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.wfmAccount });
      invalidateInventoryDerived(qc);
    },
  });
}

export function useWfmCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.wfmCreateOrder,
    onSuccess: (_n, vars) => {
      qc.invalidateQueries({ queryKey: keys.listings });
      qc.invalidateQueries({ queryKey: keys.itemDetail(vars.slug) });
      qc.invalidateQueries({ queryKey: keys.itemOrders(vars.slug) });
    },
  });
}

export function useWfmUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.wfmUpdateOrder,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.listings }),
  });
}

export function useWfmDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.wfmDeleteOrder(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.listings }),
  });
}

export function useWfmMarkSold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => api.wfmMarkSold(orderId),
    onSuccess: () => {
      // Sale touches the order mirror, sales ledger, owned inventory, and totals.
      qc.invalidateQueries({ queryKey: keys.listings });
      qc.invalidateQueries({ queryKey: keys.sales });
      qc.invalidateQueries({ queryKey: keys.inventory });
      qc.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useWfmSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: string) => api.wfmSetStatus(status),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.wfmAccount }),
  });
}

// Lowball-resistant recommended sell price for an item at a rank (null = non-ranked).
export const useRecommendedPrice = (slug: string, rank: number | null) =>
  useQuery({
    queryKey: keys.recommendedPrice(slug, rank),
    queryFn: () => api.getRecommendedPrice(slug, rank),
    staleTime: 60_000,
  });

export function useWfmRepriceApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orders: RepriceApply[]) => api.wfmRepriceApply(orders),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.listings }),
  });
}

// ---- game inventory import (memory-scan) ----
// Polled: it's a cheap local check (consent flag + process detect), and the
// always-mounted topbar SyncNow button needs `warframe_running` to stay live.
export const useGameScanStatus = () =>
  useQuery({ queryKey: keys.gameScan, queryFn: api.gameScanStatus, refetchInterval: 15_000 });

export function useGameScanConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phrase: string) => api.gameScanConsent(phrase),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.gameScan }),
  });
}
export function useGameScanRevoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.gameScanRevoke(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.gameScan }),
  });
}
export function useGameScanPreview() {
  return useMutation({ mutationFn: () => api.gameScanPreview() });
}
export function useGameScanApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: ScanApply[]) => api.gameScanApply(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.gameScan });
      invalidateInventoryDerived(qc);
    },
  });
}
