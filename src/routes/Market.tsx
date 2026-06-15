import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { ItemTags } from "../components/ItemTags";
import { Spark } from "../components/charts";
import { Chip, Glyph, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useAddToBuyList,
  useAddWatch,
  useCatalog,
  useCatalogItem,
  useItemDetail,
  useItemSellers,
  useListedSlugs,
  useRecommendedPrice,
  useSearchCatalog,
} from "../hooks/queries";
import { copyText } from "../lib/clipboard";
import { CATEGORY_LABELS, clsx, fmt, pct } from "../lib/format";
import { compileQuery } from "../lib/searchQuery";
import { marketSchema } from "../lib/searchSchemas";
import type { BuyOrder, CatalogRow, Category, SellerOrder } from "../lib/types";
import { openMarketExternal } from "../lib/wiki";

// ---------------------------------------------------------------------------
// Persisted screener + seller-view controls (own localStorage key — NOT the
// global theme Prefs). Mirrors the Drawer's wfit.drawerWidth pattern.
// ---------------------------------------------------------------------------
type SortKey = "name" | "price" | "delta" | "ducat" | "volume";
interface MarketPrefs {
  category: "all" | Category;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  vaultedOnly: boolean;
  hideOwned: boolean;
  ducatOnly: boolean;
  onlineOnly: boolean;
  sellerSort: "price" | "rep";
}
const PREFS_KEY = "wfit.market.prefs";
const DEFAULT_PREFS: MarketPrefs = {
  category: "all",
  sortKey: "name",
  sortDir: "asc",
  vaultedOnly: false,
  hideOwned: false,
  ducatOnly: false,
  onlineOnly: true,
  sellerSort: "price",
};
function loadPrefs(): MarketPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const CATEGORIES: ("all" | Category)[] = ["all", "warframe", "weapon", "set", "mod", "arcane"];
const PAGE = 80; // initial render cap; "load more" reveals the next page
/** d/p efficiency cutoff — at/above this, dissolving for ducats beats selling. */
const DUCAT_CUTOFF = 10;

const dper = (r: CatalogRow): number | null =>
  r.ducats != null && r.median_plat ? r.ducats / r.median_plat : null;

/** The standard warframe.market in-game whisper. Ranked items name the rank. */
function whisperLine(o: SellerOrder, displayName: string, ranked: boolean): string {
  const rankPart = ranked && o.rank != null ? ` (rank ${o.rank})` : "";
  return `/w ${o.ingame_name} Hi! I want to buy: "${displayName}"${rankPart} for ${o.platinum} platinum. (warframe.market)`;
}

export function Market({
  onOpen,
  initialSlug,
}: {
  onOpen: (slug: string) => void;
  initialSlug?: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CatalogRow | null>(null);
  const [prefs, setPrefs] = useState<MarketPrefs>(loadPrefs);
  const patch = (p: Partial<MarketPrefs>) => setPrefs((cur) => ({ ...cur, ...p }));

  // Preselect the item view when navigated here with a slug (e.g. the Drawer's
  // "Market" button). Resolve the slug to its catalog row, then open it once — a
  // ref so going Back doesn't immediately reopen it.
  const { data: initialRow } = useCatalogItem(initialSlug ?? null);
  const didPreselect = useRef(false);
  useEffect(() => {
    if (didPreselect.current || !initialSlug || !initialRow) return;
    didPreselect.current = true;
    setPicked(initialRow);
  }, [initialSlug, initialRow]);

  // Persist every control change so the screen reopens exactly as left.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore quota/availability errors — the session still works
    }
  }, [prefs]);

  if (picked) {
    return (
      <ItemView
        picked={picked}
        prefs={prefs}
        patch={patch}
        onBack={() => setPicked(null)}
        onOpen={onOpen}
      />
    );
  }
  return (
    <Screener query={query} setQuery={setQuery} prefs={prefs} patch={patch} onPick={setPicked} />
  );
}

// ===========================================================================
// Screener — browse a category or search, with filters, sort, keyboard nav.
// ===========================================================================
function Screener({
  query,
  setQuery,
  prefs,
  patch,
  onPick,
}: {
  query: string;
  setQuery: (q: string) => void;
  prefs: MarketPrefs;
  patch: (p: Partial<MarketPrefs>) => void;
  onPick: (r: CatalogRow) => void;
}) {
  // The screener's own search box (the topbar stays global on this screen).
  // Bare words go to the backend catalog search; the DIM-style clauses from the
  // topbar grammar (cat:mod, ducat>=45, is:owned…) also work, client-side.
  const { test, freeText } = useMemo(() => compileQuery(query, marketSchema), [query]);
  const q = freeText.trim();
  const searching = q.length >= 2;
  // Search returns every category (we filter client-side); browse asks the
  // backend for just the active category. Both are cached DB reads — no API call.
  const search = useSearchCatalog(q, 120);
  const browseCat = prefs.category === "all" ? undefined : prefs.category;
  const browse = useCatalog(searching ? undefined : browseCat);
  const source = searching ? search : browse;
  const listed = useListedSlugs();
  const addWatch = useAddWatch();
  const addBuy = useAddToBuyList();

  const rows = useMemo(() => {
    let rs = source.data ?? [];
    rs = rs.filter(test);
    if (prefs.category !== "all") rs = rs.filter((r) => r.category === prefs.category);
    if (prefs.vaultedOnly) rs = rs.filter((r) => r.is_vaulted);
    if (prefs.hideOwned) rs = rs.filter((r) => r.owned_qty === 0);
    if (prefs.ducatOnly) rs = rs.filter((r) => (dper(r) ?? 0) >= DUCAT_CUTOFF);
    const dir = prefs.sortDir === "asc" ? 1 : -1;
    // Nulls always sort last regardless of direction (no price ≠ "cheapest").
    const num = (v: number | null | undefined) =>
      v == null
        ? prefs.sortDir === "asc"
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : v;
    const key = (r: CatalogRow): number =>
      prefs.sortKey === "price"
        ? num(r.median_plat)
        : prefs.sortKey === "delta"
          ? num(r.delta_7d)
          : prefs.sortKey === "volume"
            ? num(r.volume_7d)
            : num(dper(r));
    return [...rs].sort((a, b) =>
      prefs.sortKey === "name"
        ? dir * a.display_name.localeCompare(b.display_name)
        : dir * (key(a) - key(b)),
    );
  }, [source.data, test, prefs]);

  // Reveal the result set in pages, and keyboard-highlight a row.
  const [limit, setLimit] = useState(PAGE);
  const [hi, setHi] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging/highlight whenever the result set changes
  useEffect(() => {
    setLimit(PAGE);
    setHi(-1);
  }, [query, prefs]);
  const visible = rows.slice(0, limit);
  const hiRow = useRef<HTMLTableRowElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the newly-highlighted row into view
  useEffect(() => {
    hiRow.current?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(visible.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" && hi >= 0 && hi < visible.length) {
      e.preventDefault();
      onPick(visible[hi]);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  // Toggle asc/desc on the active column (the screener always has a sort active).
  const setSort = (key: SortKey) =>
    patch(
      prefs.sortKey === key
        ? { sortDir: prefs.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: key === "name" ? "asc" : "desc" },
    );
  const colSort = { key: prefs.sortKey, dir: prefs.sortDir };

  return (
    <div className="mkt-screener" onKeyDown={onKey}>
      <div className="search mkt-search">
        <Icon name="search" />
        <input
          autoFocus
          placeholder="Search any item, or browse a category below…  (cat:mod ducat>=45 works too)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="mkt-filters">
        {CATEGORIES.map((c) => (
          <Chip key={c} active={prefs.category === c} onClick={() => patch({ category: c })}>
            {c === "all" ? "All" : CATEGORY_LABELS[c]}
          </Chip>
        ))}
        <span className="mkt-sep" />
        <Chip active={prefs.vaultedOnly} onClick={() => patch({ vaultedOnly: !prefs.vaultedOnly })}>
          Vaulted
        </Chip>
        <Chip active={prefs.hideOwned} onClick={() => patch({ hideOwned: !prefs.hideOwned })}>
          Hide owned
        </Chip>
        <Chip active={prefs.ducatOnly} onClick={() => patch({ ducatOnly: !prefs.ducatOnly })}>
          Ducat ≥ {DUCAT_CUTOFF}
        </Chip>
      </div>

      <div className="tpanel">
        <table className="dtable mkt-table">
          <thead>
            <tr>
              <th>Item</th>
              <SortTh<SortKey> label="Price" col="price" sort={colSort} onSort={setSort} right />
              <SortTh<SortKey> label="7d" col="delta" sort={colSort} onSort={setSort} right />
              <SortTh<SortKey> label="Vol" col="volume" sort={colSort} onSort={setSort} right />
              <SortTh<SortKey> label="Ducats" col="ducat" sort={colSort} onSort={setSort} right />
              <th className="r">Add</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <TableStatus
                span={6}
                loading={source.isLoading}
                error={source.isError}
                emptyText={searching ? "No items match." : "Nothing in this category."}
              />
            ) : (
              visible.map((r, i) => {
                const dp = dper(r);
                const watched = r.on_watchlist;
                const inBuy = r.buy_qty > 0;
                return (
                  <tr
                    key={r.slug}
                    ref={i === hi ? hiRow : undefined}
                    className={clsx("rowlink", i === hi && "hi")}
                    {...rowAction(() => onPick(r))}
                  >
                    <td>
                      <ItemName
                        name={r.display_name}
                        plat={r.median_plat}
                        thumb={r.thumbnail_url}
                        tags={
                          <ItemTags
                            trend={r.trend}
                            vaulted={r.is_vaulted}
                            listed={listed.has(r.slug)}
                          />
                        }
                        sub={
                          <>
                            {r.part_type} · {CATEGORY_LABELS[r.category]}
                            {r.owned_qty > 0 ? ` · owned ×${r.owned_qty}` : ""}
                          </>
                        }
                      />
                    </td>
                    <td className="r num">
                      {r.median_plat == null ? "—" : `${fmt(r.median_plat)}p`}
                    </td>
                    <td
                      className={clsx(
                        "r num",
                        r.delta_7d == null ? "muted" : r.delta_7d >= 0 ? "pos" : "neg",
                      )}
                    >
                      {r.delta_7d == null ? "—" : pct(r.delta_7d)}
                    </td>
                    <td className="r num muted">{r.volume_7d == null ? "—" : fmt(r.volume_7d)}</td>
                    <td className="r num">
                      {r.ducats == null ? (
                        "—"
                      ) : (
                        <>
                          {fmt(r.ducats)}
                          {dp != null && dp >= DUCAT_CUTOFF ? (
                            <span className="deal">{dp.toFixed(1)} d/p</span>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="r mkt-add">
                      <button
                        type="button"
                        className="btn sm"
                        disabled={watched || addWatch.isPending}
                        title="Add to watchlist"
                        onClick={(e) => {
                          e.stopPropagation();
                          addWatch.mutate({ slug: r.slug });
                        }}
                      >
                        {watched ? "✓W" : "+W"}
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={inBuy || addBuy.isPending}
                        title="Add to buy list"
                        onClick={(e) => {
                          e.stopPropagation();
                          addBuy.mutate({ slug: r.slug });
                        }}
                      >
                        {inBuy ? "✓B" : "+B"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {rows.length > limit ? (
          <button type="button" className="btn load-more" onClick={() => setLimit((l) => l + PAGE)}>
            Showing {limit} of {fmt(rows.length)} — load more
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ===========================================================================
// Item view — sellers + inline buy-decision context + demand depth.
// ===========================================================================
function ItemView({
  picked,
  prefs,
  patch,
  onBack,
  onOpen,
}: {
  picked: CatalogRow;
  prefs: MarketPrefs;
  patch: (p: Partial<MarketPrefs>) => void;
  onBack: () => void;
  onOpen: (slug: string) => void;
}) {
  const [maxPrice, setMaxPrice] = useState("");
  const [wantRank, setWantRank] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addedWatch, setAddedWatch] = useState(false);
  const [addedBuy, setAddedBuy] = useState(false);

  const { data, isLoading, isError } = useItemSellers(picked.slug);
  const detail = useItemDetail(picked.slug);
  const addWatch = useAddWatch();
  const addBuy = useAddToBuyList();
  const listed = useListedSlugs();

  const ranked = data?.max_rank != null;
  const median = picked.median_plat ?? null;
  // Lowball-resistant fair buy price (per selected rank for mods/arcanes).
  const fair = useRecommendedPrice(picked.slug, ranked ? wantRank : null);
  const fairPrice = fair.data ?? null;
  // A row is a "deal" against the fair price when known, else the median.
  const dealAt = fairPrice ?? median;

  const view = useMemo(() => {
    let rows = data?.orders ?? [];
    if (prefs.onlineOnly) rows = rows.filter((o) => o.status !== "offline");
    if (ranked && wantRank != null) rows = rows.filter((o) => o.rank === wantRank);
    const cap = Number.parseInt(maxPrice, 10);
    if (Number.isFinite(cap)) rows = rows.filter((o) => o.platinum <= cap);
    return [...rows].sort(
      prefs.sellerSort === "price"
        ? (a, b) => a.platinum - b.platinum
        : (a, b) => b.reputation - a.reputation,
    );
  }, [data, prefs.onlineOnly, prefs.sellerSort, ranked, wantRank, maxPrice]);

  const onlineSells = (data?.orders ?? []).filter((o) => o.status !== "offline");
  const bestSell = onlineSells.length ? Math.min(...onlineSells.map((o) => o.platinum)) : null;
  const spread = bestSell != null && data?.best_buy != null ? bestSell - data.best_buy : null;

  const copy = async (o: SellerOrder, key: string) => {
    const name = data?.display_name ?? picked.display_name;
    if (await copyText(whisperLine(o, name, ranked))) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    }
  };

  const span = ranked ? 7 : 6;
  const watched = picked.on_watchlist || addedWatch;
  const inBuy = picked.buy_qty > 0 || addedBuy;

  return (
    <>
      <div className="mkt-head">
        <button type="button" className="btn sm" onClick={onBack}>
          ← Back
        </button>
        <Glyph name={picked.display_name} plat={median} thumb={picked.thumbnail_url} />
        <div className="mkt-id">
          <button
            type="button"
            className="mkt-name"
            title="Open item details"
            onClick={() => onOpen(picked.slug)}
          >
            {picked.display_name}
            <ItemTags
              trend={picked.trend}
              vaulted={picked.is_vaulted}
              listed={listed.has(picked.slug)}
            />
          </button>
          <span className="muted">
            {picked.part_type} · {CATEGORY_LABELS[picked.category]}
            {picked.owned_qty > 0 ? ` · owned ×${picked.owned_qty}` : ""}
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn sm"
          disabled={watched || addWatch.isPending}
          onClick={() =>
            addWatch.mutate({ slug: picked.slug }, { onSuccess: () => setAddedWatch(true) })
          }
        >
          {watched ? "Watched" : "+ Watchlist"}
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={inBuy || addBuy.isPending}
          onClick={() =>
            addBuy.mutate({ slug: picked.slug }, { onSuccess: () => setAddedBuy(true) })
          }
        >
          {inBuy ? "In buy list" : "+ Buy list"}
        </button>
        <button
          type="button"
          className="btn sm"
          title="Open this item's warframe.market page in your browser"
          onClick={() => openMarketExternal(picked.slug)}
        >
          warframe.market ↗
        </button>
      </div>

      <ContextBand detail={detail.data} median={median} />

      <div className="mkt-controls">
        <Chip active={prefs.onlineOnly} onClick={() => patch({ onlineOnly: !prefs.onlineOnly })}>
          Online only
        </Chip>
        <Chip active={prefs.sellerSort === "price"} onClick={() => patch({ sellerSort: "price" })}>
          Cheapest
        </Chip>
        <Chip active={prefs.sellerSort === "rep"} onClick={() => patch({ sellerSort: "rep" })}>
          Reputation
        </Chip>
        <span className="mkt-field">
          <span className="muted">Max</span>
          <input
            className="lf-qty"
            type="number"
            min={1}
            placeholder="∞"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
          <span className="muted">p</span>
        </span>
        {ranked ? (
          <span className="mkt-field">
            <span className="muted">Rank</span>
            <select
              className="lf-select"
              value={wantRank ?? ""}
              onChange={(e) => setWantRank(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">any</option>
              {Array.from({ length: (data?.max_rank ?? 0) + 1 }, (_, r) => r).map((rk) => (
                <option key={rk} value={rk}>
                  Rank {rk}
                  {rk === data?.max_rank ? " (max)" : ""}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>

      <div className="statband">
        <StatBox
          k="Cheapest online"
          v={bestSell == null ? "—" : fmt(bestSell)}
          unit={bestSell == null ? undefined : "p"}
        />
        <StatBox
          k="Fair buy"
          v={fairPrice == null ? "—" : fmt(fairPrice)}
          unit={fairPrice == null ? undefined : "p"}
        />
        <StatBox
          k="Median"
          v={median == null ? "—" : fmt(median)}
          unit={median == null ? undefined : "p"}
        />
        <StatBox k="Online sellers" v={fmt(data?.sellers ?? 0)} />
        <StatBox
          k="Spread"
          v={spread == null ? "—" : fmt(spread)}
          unit={spread == null ? undefined : "p"}
        />
      </div>

      <BidLadder bids={data?.bids} ranked={ranked} wantRank={wantRank} />

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Seller</th>
              <th className="r">Price</th>
              <th className="r">Qty</th>
              {ranked ? <th className="r">Rank</th> : null}
              <th>Status</th>
              <th className="r">Rep</th>
              <th className="r">Whisper</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || view.length === 0 ? (
              <TableStatus
                span={span}
                loading={isLoading}
                error={isError}
                loadingText="Loading sellers…"
                errorText="Couldn't load orders. Try again in a moment."
                emptyText="No sellers match these filters."
              />
            ) : (
              view.map((o) => {
                // A user has at most one sell order per (item, rank) → unique key.
                const key = `${o.ingame_name}-${o.rank ?? "x"}`;
                const deal = dealAt != null && o.platinum <= dealAt;
                return (
                  <tr key={key}>
                    <td>{o.ingame_name}</td>
                    <td className={clsx("r num", deal && "pos")}>
                      {fmt(o.platinum)}p{deal ? <span className="deal">deal</span> : null}
                    </td>
                    <td className="r num">{o.quantity}</td>
                    {ranked ? <td className="r num">{o.rank ?? "—"}</td> : null}
                    <td>
                      <span className={clsx("mkt-dot", o.status)} /> {o.status}
                    </td>
                    <td className="r num">{fmt(o.reputation)}</td>
                    <td className="r">
                      <button type="button" className="btn sm" onClick={() => copy(o, key)}>
                        {copiedKey === key ? "Copied!" : "Copy /w"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Inline price context: sparkline + 7d/30d move + where the price sits in its
 *  90d range — so the buy decision doesn't require opening the drawer. */
function ContextBand({
  detail,
  median,
}: {
  detail: ReturnType<typeof useItemDetail>["data"];
  median: number | null;
}) {
  const series = useMemo(
    () => (detail?.history ?? []).map((h) => h.median).filter((m): m is number => m != null),
    [detail],
  );
  if (series.length < 2) return null;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const cur = series[series.length - 1];
  const rangePos = hi > lo ? (cur - lo) / (hi - lo) : 0.5;
  // 30d move from the median series (≈ one point/day); 7d from the cached delta.
  const d30 =
    series.length > 30
      ? ((cur - series[series.length - 31]) / series[series.length - 31]) * 100
      : null;
  const d7 = detail?.delta_7d ?? null;

  return (
    <div className="mkt-context">
      <Spark data={series} w={120} h={28} up={d7 == null ? undefined : d7 >= 0} />
      <span className="mkt-ctx-deltas">
        <span className={clsx("num", d7 == null ? "muted" : d7 >= 0 ? "pos" : "neg")}>
          7d {d7 == null ? "—" : pct(d7)}
        </span>
        <span className={clsx("num", d30 == null ? "muted" : d30 >= 0 ? "pos" : "neg")}>
          30d {d30 == null ? "—" : pct(d30)}
        </span>
      </span>
      <span
        className="mkt-range"
        title={`90d range ${fmt(lo)}–${fmt(hi)}p · ${Math.round(rangePos * 100)}% of range`}
      >
        <span className="muted">90d range</span>
        <span className="mkt-range-track">
          <span className="mkt-range-fill" style={{ width: `${Math.round(rangePos * 100)}%` }} />
          <span className="mkt-range-dot" style={{ left: `${Math.round(rangePos * 100)}%` }} />
        </span>
        <span className="num">
          {Math.round(rangePos * 100)}%
          {median != null ? (
            <span className="muted">
              {" "}
              · {fmt(lo)}–{fmt(hi)}p
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}

/** Demand depth: the online bid ladder, highest price first, with cumulative
 *  quantity bars. Tells a buyer how much demand sits under the ask and a seller
 *  what buyers will actually pay. Rank-filtered to match the seller table. */
function BidLadder({
  bids,
  ranked,
  wantRank,
}: {
  bids: BuyOrder[] | undefined;
  ranked: boolean;
  wantRank: number | null;
}) {
  const levels = useMemo(() => {
    let bs = bids ?? [];
    if (ranked && wantRank != null) bs = bs.filter((b) => b.rank === wantRank);
    const top = bs.slice(0, 8);
    const max = top.reduce((m, b) => Math.max(m, b.quantity), 0) || 1;
    let cum = 0;
    return top.map((b) => {
      cum += b.quantity;
      return { ...b, cum, frac: b.quantity / max };
    });
  }, [bids, ranked, wantRank]);

  if (levels.length === 0) return null;
  return (
    <div className="bidladder">
      <div className="bidladder-h">
        Buyer demand · top bids{ranked && wantRank != null ? ` (rank ${wantRank})` : ""}
      </div>
      {levels.map((b) => (
        <div key={`${b.platinum}-${b.rank ?? "x"}`} className="bidrow">
          <span className="num bidrow-p pos">{fmt(b.platinum)}p</span>
          <span className="bidrow-track">
            <span className="bidrow-fill" style={{ width: `${Math.round(b.frac * 100)}%` }} />
          </span>
          <span className="num bidrow-q">×{fmt(b.quantity)}</span>
          <span className="num bidrow-cum muted">Σ{fmt(b.cum)}</span>
        </div>
      ))}
    </div>
  );
}
