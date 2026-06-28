// React Query hooks over the api layer. Mutations invalidate the related read
// keys so the UI updates live across screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo } from "react";
import * as api from "../lib/api";
import { errorMessage, pushToast } from "../lib/toast";
import type {
  CatalogRow,
  NotificationPrefs,
  OverlayPrefs,
  RepriceApply,
  RivenQuery,
  ScanApply,
} from "../lib/types";

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
  overlayPrefs: ["overlayPrefs"] as const,
  sets: ["sets"] as const,
  ducats: ["ducats"] as const,
  arcanes: ["arcanes"] as const,
  collectionBreakdown: (key: string) => ["collectionBreakdown", key] as const,
  catalog: (cat?: string) => ["catalog", cat ?? "all"] as const,
  trends: (tf: string, excludeOutliers: boolean) => ["trends", tf, excludeOutliers] as const,
  itemDetail: (slug: string) => ["itemDetail", slug] as const,
  searchCatalog: (q: string, limit: number) => ["searchCatalog", q, limit] as const,
  itemOrders: (slug: string) => ["itemOrders", slug] as const,
  itemSellers: (slug: string) => ["itemSellers", slug] as const,
  recommendedPrice: (slug: string, rank: number | null) =>
    ["recommendedPrice", slug, rank] as const,
  worldstate: ["worldstate"] as const,
  vendorIntel: ["vendorIntel"] as const,
  wantedNow: ["wantedNow"] as const,
  relics: ["relics"] as const,
  relicChoices: ["relicChoices"] as const,
  crackPlan: ["crackPlan"] as const,
  pricingProgress: ["pricingProgress"] as const,
  wfmAccount: ["wfmAccount"] as const,
  listings: ["listings"] as const,
  recommendations: ["recommendations"] as const,
  gameScan: ["gameScan"] as const,
  accountProfile: ["accountProfile"] as const,
  accountArsenal: ["accountArsenal"] as const,
  accountResources: ["accountResources"] as const,
  accountCodex: ["accountCodex"] as const,
  backups: ["backups"] as const,
  rivenWeapons: ["rivenWeapons"] as const,
  rivenAttributes: ["rivenAttributes"] as const,
  rivenSearches: ["rivenSearches"] as const,
  rivenSearch: (q: string) => ["rivenSearch", q] as const,
  notifications: ["notifications"] as const,
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
export const useCollectionBreakdown = (key: string | null) =>
  useQuery({
    queryKey: keys.collectionBreakdown(key ?? ""),
    queryFn: () => api.getCollectionBreakdown(key as string),
    enabled: !!key,
  });
export const useCatalog = (cat?: string) =>
  useQuery({ queryKey: keys.catalog(cat), queryFn: () => api.getCatalog(cat) });
export const useCatalogItem = (slug: string | null) =>
  useQuery({
    queryKey: ["catalogItem", slug ?? ""],
    queryFn: () => api.getCatalogItem(slug as string),
    enabled: !!slug,
  });
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
// Baro/Varzia stock enriched with market value + ownership. Cheap (reads cached
// worldstate); refetch on the same cadence as the worldstate so deals stay current.
export const useVendorIntel = () =>
  useQuery({
    queryKey: keys.vendorIntel,
    queryFn: api.getVendorIntel,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
// Wanted items farmable from a live reward source right now. Depends on the
// worldstate + watchlist/inventory; refetch on the worldstate cadence.
export const useWantedNow = () =>
  useQuery({
    queryKey: keys.wantedNow,
    queryFn: api.getWantedNow,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

// ---- relics ----
export const useRelics = () => useQuery({ queryKey: keys.relics, queryFn: api.getRelics });
// Static reference list (all known relics) — cached long for the add picker.
export const useRelicChoices = () =>
  useQuery({
    queryKey: keys.relicChoices,
    queryFn: api.listRelicChoices,
    staleTime: Number.POSITIVE_INFINITY,
  });
// The Relics "To crack" ranking — refreshes on the same cadence as crack-now (live
// fissures flip crackable_now), and on any relic mutation via invalidateRelics.
export const useCrackPlan = () =>
  useQuery({
    queryKey: keys.crackPlan,
    queryFn: api.getCrackPlan,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
function invalidateRelics(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: keys.relics });
  qc.invalidateQueries({ queryKey: keys.crackPlan });
}
export function useAddRelic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { tier: string; name: string; refinement?: string; qty?: number }) =>
      api.addRelic(a.tier, a.name, a.refinement, a.qty),
    onSuccess: () => invalidateRelics(qc),
  });
}
export function useSetRelicQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { tier: string; name: string; refinement: string | null; qty: number }) =>
      api.setRelicQty(a.tier, a.name, a.refinement, a.qty),
    onSuccess: () => invalidateRelics(qc),
  });
}
export function useRemoveRelic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { tier: string; name: string; refinement: string | null }) =>
      api.removeRelic(a.tier, a.name, a.refinement),
    onSuccess: () => invalidateRelics(qc),
  });
}
export function useImportScannedRelics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.importScannedRelics,
    onSuccess: () => invalidateRelics(qc),
  });
}
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
export const useListingRecommendations = (enabled = true) =>
  useQuery({
    queryKey: keys.recommendations,
    queryFn: api.getListingRecommendations,
    enabled,
  });
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

// ---- cascade overlay ----
export const useOverlayPrefs = () =>
  useQuery({ queryKey: keys.overlayPrefs, queryFn: api.getOverlayPrefs });
export function useSetOverlayPrefs() {
  const qc = useQueryClient();
  return useMutation({
    // The setter re-registers the global hotkey backend-side as a side effect.
    mutationFn: (prefs: OverlayPrefs) => api.setOverlayPrefs(prefs),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.overlayPrefs }),
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
      qc.invalidateQueries({ queryKey: keys.recommendations });
      qc.invalidateQueries({ queryKey: keys.pricingProgress });
      // Market-screen order books and the drawer's recommended price come from
      // the same caches the heartbeat just refreshed. Only refetch what's on
      // screen — these are per-slug queries and most are unmounted.
      qc.invalidateQueries({ queryKey: ["itemOrders"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["itemSellers"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["recommendedPrice"], refetchType: "active" });
      qc.invalidateQueries({ queryKey: ["collectionBreakdown"], refetchType: "active" });
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

// One-click post-patch update (catalog + vault + sets + relics). Touches everything
// value/relic-bearing, so refetch broadly.
export function useUpdateGameData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.updateGameData(),
    onSuccess: () => qc.invalidateQueries(),
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

// ---- developer: web dashboard ----
// URL is non-null only when the app was built with `--features dev-dashboard`
// and the server bound. Settings shows the "Open dashboard" button accordingly.
export const useDevDashboardUrl = () =>
  useQuery({
    queryKey: ["devDashboardUrl"],
    queryFn: api.devDashboardUrl,
    staleTime: Number.POSITIVE_INFINITY,
  });
export function useOpenDevDashboard() {
  return useMutation({
    mutationFn: () => api.openDevDashboard(),
    onError: (e) => pushToast(errorMessage(e), "error"),
  });
}

// ---- developer: simulate fake inventory ----
export function useSimulateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fill: number) => api.simulateInventory(fill),
    onSuccess: (s) => {
      pushToast(
        `Simulated ${s.total_items.toLocaleString()} items total — ${s.items} sets/parts, ${s.mods} mods, ${s.arcanes} arcanes, ${s.resources} resources · ${s.platinum}p`,
        "info",
      );
      qc.invalidateQueries(); // inventory + account replaced — refetch everything
    },
  });
}
export function useClearSimulatedInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearSimulatedInventory(),
    onSuccess: () => {
      pushToast("Simulated data cleared", "info");
      qc.invalidateQueries();
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
      // The item is now listed → it should drop out of the recommendations.
      qc.invalidateQueries({ queryKey: keys.recommendations });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.listings });
      // No longer listed → it may become recommendable again.
      qc.invalidateQueries({ queryKey: keys.recommendations });
    },
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

// ---- account section ----
export const useAccountProfile = () =>
  useQuery({ queryKey: keys.accountProfile, queryFn: api.getAccountProfile });
export const useAccountArsenal = () =>
  useQuery({ queryKey: keys.accountArsenal, queryFn: api.getAccountArsenal });
export const useAccountResources = () =>
  useQuery({ queryKey: keys.accountResources, queryFn: api.getAccountResources });
export const useAccountCodex = () =>
  useQuery({ queryKey: keys.accountCodex, queryFn: api.getAccountCodex });

function invalidateAccount(qc: QC) {
  for (const k of [
    keys.accountProfile,
    keys.accountArsenal,
    keys.accountResources,
    keys.accountCodex,
  ]) {
    qc.invalidateQueries({ queryKey: k });
  }
}

export function useAccountScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.accountScan(),
    onSuccess: (profile) => {
      qc.setQueryData(keys.accountProfile, profile);
      invalidateAccount(qc);
      qc.invalidateQueries({ queryKey: keys.gameScan });
    },
  });
}

// ---- rivens ----
// Reference data is effectively static within a session (refreshed backend-side on
// a long TTL) — cache it indefinitely.
export const useRivenWeapons = () =>
  useQuery({
    queryKey: keys.rivenWeapons,
    queryFn: api.listRivenWeapons,
    staleTime: Number.POSITIVE_INFINITY,
  });
export const useRivenAttributes = () =>
  useQuery({
    queryKey: keys.rivenAttributes,
    queryFn: api.listRivenAttributes,
    staleTime: Number.POSITIVE_INFINITY,
  });
// Live auction search — only runs once a weapon is chosen. Keyed on the full query
// so changing any field refetches; short staleTime keeps live prices reasonably fresh.
export const useRivenSearch = (query: RivenQuery | null) =>
  useQuery({
    queryKey: keys.rivenSearch(query ? JSON.stringify(query) : ""),
    queryFn: () => api.searchRivens(query as RivenQuery),
    enabled: !!query?.weapon,
    staleTime: 30_000,
  });
export const useRivenSearches = () =>
  useQuery({ queryKey: keys.rivenSearches, queryFn: api.listRivenSearches });
export function useCreateRivenSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { label: string; query: RivenQuery; minValues: Record<string, number> }) =>
      api.createRivenSearch(a.label, a.query, a.minValues),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rivenSearches }),
  });
}
export function useDeleteRivenSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteRivenSearch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rivenSearches }),
  });
}
export function useSetRivenNotify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id: number; enabled: boolean }) => api.setRivenSearchNotify(a.id, a.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.rivenSearches }),
  });
}

// ---- notification center ----
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: api.listNotifications });

/** Refetch the notification list whenever the backend files new ones. */
export function useNotificationEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const un = listen("notifications-updated", () => {
      qc.invalidateQueries({ queryKey: keys.notifications });
    });
    return () => {
      un.then((f) => f());
    };
  }, [qc]);
}
