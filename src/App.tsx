import { useCallback, useDeferredValue, useState } from "react";
import { AddItems } from "./components/AddItems";
import { Drawer } from "./components/Drawer";
import { Icon } from "./components/Icon";
import { SearchResults } from "./components/SearchResults";
import { type ScreenId, Sidebar } from "./components/Sidebar";
import { SyncNow } from "./components/SyncNow";
import { TitleBar } from "./components/TitleBar";
import { usePricesRefresh, usePricingProgress, useSummary } from "./hooks/queries";
import { clsx } from "./lib/format";
import { Arcanes } from "./routes/Arcanes";
// Routes are imported eagerly. This is a local desktop app — the bundle loads
// from disk, so code-splitting saves nothing at startup and only adds a chunk-
// fetch delay (and a Suspense flash) when navigating to a screen.
import { BuyList } from "./routes/BuyList";
import { Ducats } from "./routes/Ducats";
import { Inventory } from "./routes/Inventory";
import { Listings } from "./routes/Listings";
import { Rotation } from "./routes/Rotation";
import { Sets } from "./routes/Sets";
import { Settings } from "./routes/Settings";
import { SoldHistory } from "./routes/SoldHistory";
import { Trends } from "./routes/Trends";
import { Watchlist } from "./routes/Watchlist";

const TITLES: Record<ScreenId, string> = {
  inventory: "Inventory",
  sets: "Sets",
  trends: "Trends",
  watchlist: "Watchlist",
  buy: "Buy List",
  listings: "Listings",
  ducats: "Ducats",
  arcanes: "Arcanes",
  rotation: "Rotation",
  sold: "Sold History",
  settings: "Settings",
};

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("inventory");
  const [search, setSearch] = useState("");
  // Input stays on `search`; screens filter on the deferred value so keystrokes
  // never block on a large grid re-render.
  const deferredSearch = useDeferredValue(search);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { data: summary } = useSummary();
  const refresh = usePricesRefresh();
  const { data: progress } = usePricingProgress();

  // A sync is "in flight" while the manual refresh mutation runs OR a background
  // drain is active — drives the spinning refresh icon + the topbar progress bar.
  const syncing = refresh.isPending || !!progress?.active;
  const syncPct =
    progress && progress.total > 0 ? `${(progress.priced / progress.total) * 100}%` : undefined;

  // Stable identity so memoized rows in every screen don't re-render when App
  // re-renders (e.g. the summary badge updating every 2s during a price sync).
  const open = useCallback((slug: string) => setDrawer(slug), []);

  const badges: Partial<Record<ScreenId, number>> = {
    inventory: summary?.distinct_count || undefined,
    watchlist: summary?.at_target_count || undefined,
  };

  return (
    <div className="win">
      <TitleBar />
      <div className="shell">
        <Sidebar
          screen={screen}
          onNavigate={(s) => {
            setScreen(s);
            setSearch("");
          }}
          onAdd={() => setAdding(true)}
          badges={badges}
        />

        <main className="main">
          <div className="topbar">
            <div className="screen-title">{TITLES[screen]}</div>
            <div className="search-wrap">
              <div className="search">
                <Icon name="search" />
                <input
                  placeholder="Search all items…  (ininv: to scope to inventory)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearch("");
                  }}
                />
              </div>
              {search.trim() ? (
                <SearchResults
                  query={deferredSearch}
                  onOpen={(slug) => {
                    open(slug);
                    setSearch("");
                  }}
                />
              ) : null}
            </div>
            <SyncNow />
            <button
              type="button"
              className={clsx("icon-btn", syncing && "spinning")}
              title="Refresh prices"
              onClick={() => refresh.mutate({})}
              disabled={refresh.isPending}
            >
              <Icon name="refresh" />
            </button>
            {syncing ? (
              <div className="topbar-prog">
                <div
                  className={clsx("topbar-prog-fill", !syncPct && "indeterminate")}
                  style={syncPct ? { width: syncPct } : undefined}
                />
              </div>
            ) : null}
          </div>

          <div className="content">
            {/* Inventory stays mounted and is just hidden when inactive — its
                ~800-tile grid is expensive to mount, so re-creating it on every
                navigation caused a visible freeze. Hidden → instant show. */}
            <div style={screen === "inventory" ? undefined : { display: "none" }}>
              <Inventory onOpen={open} search={deferredSearch} />
            </div>
            {screen === "sets" && <Sets onOpen={open} />}
            {screen === "trends" && <Trends onOpen={open} />}
            {screen === "watchlist" && <Watchlist onOpen={open} />}
            {screen === "buy" && <BuyList onOpen={open} />}
            {screen === "listings" && <Listings onOpen={open} />}
            {screen === "ducats" && <Ducats onOpen={open} />}
            {screen === "arcanes" && <Arcanes onOpen={open} />}
            {screen === "rotation" && <Rotation />}
            {screen === "sold" && <SoldHistory onOpen={open} />}
            {screen === "settings" && (
              <Settings
                onNavigate={(s) => {
                  setScreen(s);
                  setSearch("");
                }}
              />
            )}
          </div>
        </main>

        {drawer ? <Drawer slug={drawer} onClose={() => setDrawer(null)} /> : null}
        {adding ? (
          <AddItems
            target={screen === "watchlist" ? "watchlist" : screen === "buy" ? "buy" : "inventory"}
            onClose={() => setAdding(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
