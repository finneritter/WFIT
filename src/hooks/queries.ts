// React Query hooks over the api layer. Mutations invalidate the related read
// keys so the UI updates live across screens.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api";
import type { ScanApply } from "../lib/types";

export const keys = {
  inventory: ["inventory"] as const,
  summary: ["summary"] as const,
  sales: ["sales"] as const,
  watchlist: ["watchlist"] as const,
  buyList: ["buyList"] as const,
  budget: ["budget"] as const,
  sets: ["sets"] as const,
  ducats: ["ducats"] as const,
  catalog: (cat?: string) => ["catalog", cat ?? "all"] as const,
  trends: (tf: string, excludeOutliers: boolean) => ["trends", tf, excludeOutliers] as const,
  itemDetail: (slug: string) => ["itemDetail", slug] as const,
  worldstate: ["worldstate"] as const,
  wfmAccount: ["wfmAccount"] as const,
  listings: ["listings"] as const,
  gameScan: ["gameScan"] as const,
};

// Anything that touches inventory ripples into these derived views.
function invalidateInventoryDerived(qc: ReturnType<typeof useQueryClient>) {
  for (const k of [
    keys.inventory,
    keys.summary,
    keys.sets,
    keys.ducats,
    keys.watchlist,
    keys.buyList,
  ]) {
    qc.invalidateQueries({ queryKey: k });
  }
  qc.invalidateQueries({ queryKey: ["trends"] });
  // Catalog rows carry owned_qty (joined from inventory), so the Add-items grid
  // checkboxes/steppers track ownership — refresh it after any inventory change.
  qc.invalidateQueries({ queryKey: ["catalog"] });
}

// ---- reads ----
export const useInventory = () => useQuery({ queryKey: keys.inventory, queryFn: api.getInventory });
export const useSummary = () => useQuery({ queryKey: keys.summary, queryFn: api.getSummary });
export const useSales = () => useQuery({ queryKey: keys.sales, queryFn: () => api.getSales() });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: api.getWatchlist });
export const useBuyList = () => useQuery({ queryKey: keys.buyList, queryFn: api.getBuyList });
export const useBudget = () => useQuery({ queryKey: keys.budget, queryFn: api.getBudget });
export const useSets = () => useQuery({ queryKey: keys.sets, queryFn: api.getSets });
export const useDucats = () => useQuery({ queryKey: keys.ducats, queryFn: api.getDucats });
export const useCatalog = (cat?: string) =>
  useQuery({ queryKey: keys.catalog(cat), queryFn: () => api.getCatalog(cat) });
export const useSearchCatalog = (q: string) =>
  useQuery({
    queryKey: ["searchCatalog", q],
    queryFn: () => api.searchCatalog(q, 40),
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
    queryKey: ["itemOrders", slug ?? ""],
    queryFn: () => api.getItemOrders(slug as string),
    enabled: !!slug,
    staleTime: 60_000,
  });
export const useWorldstate = () =>
  useQuery({ queryKey: keys.worldstate, queryFn: api.getWorldstate, refetchInterval: 45_000 });
export const useWfmAccount = () =>
  useQuery({ queryKey: keys.wfmAccount, queryFn: api.getWfmAccount });
export const useListings = () => useQuery({ queryKey: keys.listings, queryFn: api.wfmGetListings });

// ---- inventory mutations ----
export function useAddToInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, qty }: { slug: string; qty?: number }) => api.addToInventory(slug, qty),
    onSuccess: () => invalidateInventoryDerived(qc),
  });
}

export function useSetQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, qty }: { slug: string; qty: number }) => api.setQty(slug, qty),
    onSuccess: () => invalidateInventoryDerived(qc),
  });
}

export function useRemoveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeItem(slug),
    onSuccess: () => invalidateInventoryDerived(qc),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}
export function useRemoveWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeWatch(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.watchlist });
      qc.invalidateQueries({ queryKey: keys.summary });
      qc.invalidateQueries({ queryKey: ["catalog"] });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}
export function useSetBuyQty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slug: string; qty: number }) => api.setBuyQty(a.slug, a.qty),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}
export function useRemoveBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.removeBuy(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.buyList });
      qc.invalidateQueries({ queryKey: ["catalog"] });
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

// ---- refresh / catalog ----
export function usePricesRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { slugs?: string[]; force?: boolean } = {}) =>
      api.pricesRefresh(a.slugs, a.force),
    onSuccess: () => {
      invalidateInventoryDerived(qc);
      qc.invalidateQueries({ queryKey: ["catalog"] });
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

// ---- game inventory import (memory-scan) ----
export const useGameScanStatus = () =>
  useQuery({ queryKey: keys.gameScan, queryFn: api.gameScanStatus });

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
