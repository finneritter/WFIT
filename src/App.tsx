import { Suspense, lazy, useCallback, useDeferredValue, useState } from "react";
import { AddItems } from "./components/AddItems";
import { Drawer } from "./components/Drawer";
import { Icon } from "./components/Icon";
import { SearchResults } from "./components/SearchResults";
import { type ScreenId, Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { usePricesRefresh, useSummary } from "./hooks/queries";

// Routes are code-split: only the active screen's module is parsed/evaluated, so
// startup and per-screen cost drop (the inventory grid is the heaviest by far).
const Inventory = lazy(() => import("./routes/Inventory").then((m) => ({ default: m.Inventory })));
const Sets = lazy(() => import("./routes/Sets").then((m) => ({ default: m.Sets })));
const Trends = lazy(() => import("./routes/Trends").then((m) => ({ default: m.Trends })));
const Watchlist = lazy(() => import("./routes/Watchlist").then((m) => ({ default: m.Watchlist })));
const BuyList = lazy(() => import("./routes/BuyList").then((m) => ({ default: m.BuyList })));
const Listings = lazy(() => import("./routes/Listings").then((m) => ({ default: m.Listings })));
const Ducats = lazy(() => import("./routes/Ducats").then((m) => ({ default: m.Ducats })));
const Rotation = lazy(() => import("./routes/Rotation").then((m) => ({ default: m.Rotation })));
const SoldHistory = lazy(() =>
  import("./routes/SoldHistory").then((m) => ({ default: m.SoldHistory })),
);
const Settings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.Settings })));

const TITLES: Record<ScreenId, string> = {
  inventory: "Inventory",
  sets: "Sets",
  trends: "Trends",
  watchlist: "Watchlist",
  buy: "Buy List",
  listings: "Listings",
  ducats: "Ducats",
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
            <button
              type="button"
              className="icon-btn"
              title="Refresh prices"
              onClick={() => refresh.mutate({})}
              disabled={refresh.isPending}
            >
              <Icon name="refresh" />
            </button>
          </div>

          <div className="content">
            <Suspense fallback={<div className="empty">Loading…</div>}>
              {screen === "inventory" && <Inventory onOpen={open} search={deferredSearch} />}
              {screen === "sets" && <Sets onOpen={open} />}
              {screen === "trends" && <Trends onOpen={open} />}
              {screen === "watchlist" && <Watchlist onOpen={open} />}
              {screen === "buy" && <BuyList onOpen={open} />}
              {screen === "listings" && <Listings onOpen={open} />}
              {screen === "ducats" && <Ducats onOpen={open} />}
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
            </Suspense>
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
