import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { AddItems } from "./components/AddItems";
import { Drawer } from "./components/Drawer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Icon } from "./components/Icon";
import { LiveBadge } from "./components/LiveBadge";
import { type ScreenId, Sidebar } from "./components/Sidebar";
import { SyncNow } from "./components/SyncNow";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { GLOBAL_PREFIX, TopbarSearch } from "./components/TopbarSearch";
import {
  useLivePriceEvents,
  usePricesRefresh,
  usePricingProgress,
  useSummary,
  useWorldstateHardReset,
} from "./hooks/queries";
import { clsx } from "./lib/format";
import { type SearchKeyHandler, SearchProvider } from "./lib/searchContext";
import { PAGE_SCHEMAS } from "./lib/searchSchemas";
import { attachSmoothScroll } from "./lib/smoothScroll";
import { Arcanes } from "./routes/Arcanes";
// Routes are imported eagerly. This is a local desktop app — the bundle loads
// from disk, so code-splitting saves nothing at startup and only adds a chunk-
// fetch delay (and a Suspense flash) when navigating to a screen.
import { BuyList } from "./routes/BuyList";
import { Dashboard } from "./routes/Dashboard";
import { Ducats } from "./routes/Ducats";
import { Inventory } from "./routes/Inventory";
import { Listings } from "./routes/Listings";
import { Market } from "./routes/Market";
import { Rotation } from "./routes/Rotation";
import { Sets } from "./routes/Sets";
import { Settings } from "./routes/Settings";
import { SoldHistory } from "./routes/SoldHistory";
import { Trends } from "./routes/Trends";
import { Watchlist } from "./routes/Watchlist";

// Below this window width the sidebar auto-collapses to reclaim space.
const NAV_NARROW = "(max-width: 1000px)";

const TITLES: Record<ScreenId, string> = {
  home: "Home",
  inventory: "Inventory",
  sets: "Sets",
  trends: "Trends",
  watchlist: "Watchlist",
  buy: "Buy List",
  market: "Market",
  listings: "Listings",
  ducats: "Ducats",
  arcanes: "Arcanes",
  rotation: "Rotation",
  sold: "Sold History",
  settings: "Settings",
};

export default function App() {
  const [screen, setScreen] = useState<ScreenId>("home");
  const [search, setSearch] = useState("");
  // Input stays on `search`; screens filter on the deferred value so keystrokes
  // never block on a large grid re-render.
  const deferredSearch = useDeferredValue(search);
  // The query each screen filters on: empty in global (`all:`) mode or on
  // screens without a search schema (those fall back to the catalog dropdown).
  const pageQuery =
    PAGE_SCHEMAS[screen] && !GLOBAL_PREFIX.test(deferredSearch) ? deferredSearch : "";
  // The active screen's handler for Arrow/Enter keys typed in the topbar input
  // (Market's screener registers itself via useSearchKeys).
  const searchKeysRef = useRef<SearchKeyHandler | null>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The user's explicit collapse choice (persisted). On narrow windows the
  // sidebar auto-collapses regardless; widening again restores this preference.
  const manualNav = useRef(localStorage.getItem("wfit.navCollapsed") === "1");
  const [navCollapsed, setNavCollapsed] = useState(
    () => manualNav.current || window.matchMedia(NAV_NARROW).matches,
  );
  const { data: summary } = useSummary();
  const refresh = usePricesRefresh();
  // On the Rotation screen the topbar refresh button repurposes itself as the
  // world-state hard reset (discard backend caches, re-fetch every source).
  const wsReset = useWorldstateHardReset();
  const { data: progress } = usePricingProgress();
  // Refetch value-bearing views the moment the backend heartbeat lands new data.
  useLivePriceEvents();

  // A sync is "in flight" while the manual refresh mutation runs OR a background
  // drain is active — drives the spinning refresh icon + the topbar progress bar.
  const syncing = refresh.isPending || !!progress?.active;
  const syncPct =
    progress && progress.total > 0 ? `${(progress.priced / progress.total) * 100}%` : undefined;

  // Stable identity so memoized rows in every screen don't re-render when App
  // re-renders (e.g. the summary badge updating every 2s during a price sync).
  const open = useCallback((slug: string) => setDrawer(slug), []);

  const toggleNav = useCallback(() => {
    setNavCollapsed((c) => {
      const next = !c;
      manualNav.current = next;
      localStorage.setItem("wfit.navCollapsed", next ? "1" : "0");
      return next;
    });
  }, []);

  // Force-collapse when the window gets narrow; restore the manual choice when
  // it's wide again, so a small window never wastes space on the 182px sidebar.
  useEffect(() => {
    const mq = window.matchMedia(NAV_NARROW);
    const onChange = (e: MediaQueryListEvent) =>
      setNavCollapsed(e.matches ? true : manualNav.current);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!contentRef.current) return;
    return attachSmoothScroll(contentRef.current);
  }, []);

  const badges: Partial<Record<ScreenId, number>> = {
    inventory: summary?.distinct_count || undefined,
    watchlist: summary?.at_target_count || undefined,
  };

  return (
    <div className="win">
      <TitleBar />
      <div className={clsx("shell", navCollapsed && "nav-collapsed")}>
        <Sidebar
          screen={screen}
          onNavigate={(s) => {
            setScreen(s);
            setSearch("");
          }}
          onAdd={() => setAdding(true)}
          badges={badges}
        />

        {/* Floats over the sidebar's top strip; slides to the window edge when
            collapsed so it stays clickable to expand again. */}
        <button
          type="button"
          className="icon-btn nav-toggle"
          title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!navCollapsed}
          onClick={toggleNav}
        >
          <Icon name="chevrons" />
        </button>

        <main className="main">
          <div className="topbar">
            <div className="screen-title">{TITLES[screen]}</div>
            <TopbarSearch
              screen={screen}
              search={search}
              setSearch={setSearch}
              deferredSearch={deferredSearch}
              keysRef={searchKeysRef}
              onOpen={open}
            />
            <LiveBadge />
            <SyncNow />
            <button
              type="button"
              className={clsx(
                "icon-btn",
                (screen === "rotation" ? wsReset.isPending : syncing) && "spinning",
              )}
              title={
                screen === "rotation"
                  ? "Hard reset — discard cached world-state and re-fetch everything now"
                  : "Refresh prices"
              }
              onClick={() => (screen === "rotation" ? wsReset.mutate() : refresh.mutate({}))}
              disabled={screen === "rotation" ? wsReset.isPending : refresh.isPending}
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

          <div className="content" ref={contentRef}>
            <SearchProvider query={pageQuery} keysRef={searchKeysRef}>
              {/* Inventory stays mounted and is just hidden when inactive — its
                ~800-tile grid is expensive to mount, so re-creating it on every
                navigation caused a visible freeze. Hidden → instant show. */}
              <div style={screen === "inventory" ? undefined : { display: "none" }}>
                <Inventory onOpen={open} />
              </div>
              {/* Switchable routes share one boundary, keyed by screen so a caught
                error clears on navigation. The always-mounted Inventory above is
                intentionally outside it — a key={screen} boundary would remount
                its heavy grid on every navigation (covered by the root boundary
                in main.tsx instead). */}
              <ErrorBoundary key={screen}>
                {screen === "home" && (
                  <Dashboard
                    onOpen={open}
                    onNavigate={(s) => {
                      setScreen(s);
                      setSearch("");
                    }}
                  />
                )}
                {screen === "sets" && <Sets onOpen={open} />}
                {screen === "trends" && <Trends onOpen={open} />}
                {screen === "watchlist" && <Watchlist onOpen={open} />}
                {screen === "buy" && <BuyList onOpen={open} />}
                {screen === "market" && <Market onOpen={open} />}
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
              </ErrorBoundary>
            </SearchProvider>
          </div>
        </main>

        {drawer ? (
          <Drawer
            slug={drawer}
            onClose={() => setDrawer(null)}
            onGoListings={() => {
              setDrawer(null);
              setScreen("listings");
              setSearch("");
            }}
          />
        ) : null}
        {adding ? (
          <AddItems
            target={screen === "watchlist" ? "watchlist" : screen === "buy" ? "buy" : "inventory"}
            onClose={() => setAdding(false)}
          />
        ) : null}
        <Toasts />
      </div>
    </div>
  );
}
