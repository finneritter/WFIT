import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Chip, Glyph, StatBox } from "../components/ui";
import { useAddToBuyList, useAddWatch, useItemSellers, useSearchCatalog } from "../hooks/queries";
import { copyText } from "../lib/clipboard";
import { CATEGORY_LABELS, clsx, fmt } from "../lib/format";
import type { CatalogRow, SellerOrder } from "../lib/types";

/** The standard warframe.market in-game whisper. Ranked items name the rank. */
function whisperLine(o: SellerOrder, displayName: string, ranked: boolean): string {
  const rankPart = ranked && o.rank != null ? ` (rank ${o.rank})` : "";
  return `/w ${o.ingame_name} Hi! I want to buy: "${displayName}"${rankPart} for ${o.platinum} platinum. (warframe.market)`;
}

/** Inline catalog-search dropdown that hands back the FULL row (name, price,
 *  thumbnail, owned/watch/buy flags) so the page needs no extra lookups. */
function SearchDropdown({
  query,
  onPick,
}: {
  query: string;
  onPick: (r: CatalogRow) => void;
}) {
  const { data = [], isFetching } = useSearchCatalog(query);
  return (
    <div className="search-results">
      {data.length === 0 ? (
        <div className="sr-empty">{isFetching ? "Searching…" : "No items match."}</div>
      ) : (
        data.map((r) => (
          <button key={r.slug} type="button" className="sr-row" onClick={() => onPick(r)}>
            <Glyph name={r.display_name} plat={r.median_plat} thumb={r.thumbnail_url} />
            <span className="sr-i">
              <span className="sr-n">{r.display_name}</span>
              <span className="sr-s">
                {r.part_type} · {CATEGORY_LABELS[r.category]}
                {r.owned_qty > 0 ? ` · owned ×${r.owned_qty}` : ""}
              </span>
            </span>
            <span className="sr-p num">
              {r.median_plat == null ? "—" : `${fmt(r.median_plat)}p`}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

export function Market({ onOpen }: { onOpen: (slug: string) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CatalogRow | null>(null);
  // controls (persist across searches)
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [sortBy, setSortBy] = useState<"price" | "rep">("price");
  const [maxPrice, setMaxPrice] = useState("");
  const [wantRank, setWantRank] = useState<number | null>(null);
  // per-row copy flash + per-item add flags (reset on each pick)
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [addedWatch, setAddedWatch] = useState(false);
  const [addedBuy, setAddedBuy] = useState(false);

  const { data, isLoading, isError } = useItemSellers(picked?.slug ?? null);
  const addWatch = useAddWatch();
  const addBuy = useAddToBuyList();

  const ranked = data?.max_rank != null;
  const median = picked?.median_plat ?? null;

  // Filtered + sorted seller rows for the table (client-side — never refetches).
  const view = useMemo(() => {
    let rows = data?.orders ?? [];
    if (onlineOnly) rows = rows.filter((o) => o.status !== "offline");
    if (ranked && wantRank != null) rows = rows.filter((o) => o.rank === wantRank);
    const cap = Number.parseInt(maxPrice, 10);
    if (Number.isFinite(cap)) rows = rows.filter((o) => o.platinum <= cap);
    return [...rows].sort(
      sortBy === "price"
        ? (a, b) => a.platinum - b.platinum
        : (a, b) => b.reputation - a.reputation,
    );
  }, [data, onlineOnly, ranked, wantRank, maxPrice, sortBy]);

  // Stats reflect the whole online market for the item, not the filtered view.
  const onlineSells = (data?.orders ?? []).filter((o) => o.status !== "offline");
  const bestSell = onlineSells.length ? Math.min(...onlineSells.map((o) => o.platinum)) : null;
  const spread = bestSell != null && data?.best_buy != null ? bestSell - data.best_buy : null;

  const pick = (r: CatalogRow) => {
    setPicked(r);
    setQuery("");
    setWantRank(null);
    setMaxPrice("");
    setAddedWatch(false);
    setAddedBuy(false);
  };

  const copy = async (o: SellerOrder, key: string) => {
    const name = data?.display_name ?? picked?.display_name ?? "";
    if (await copyText(whisperLine(o, name, ranked))) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    }
  };

  // ---------- Idle: centered hero search ----------
  if (!picked) {
    return (
      <div className="mkt-hero">
        <h2>Market search</h2>
        <p className="muted" style={{ margin: 0, textAlign: "center" }}>
          Search any item to see who's selling and copy a whisper to send in-game.
        </p>
        <div style={{ position: "relative", width: "100%" }}>
          <div className="search">
            <Icon name="search" />
            <input
              // biome-ignore lint/a11y/noAutofocus: search-first page, focus is expected
              autoFocus
              placeholder="Search any item to buy…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query.trim().length >= 2 ? <SearchDropdown query={query.trim()} onPick={pick} /> : null}
        </div>
        <div className="mkt-toggles">
          <Chip active={onlineOnly} onClick={() => setOnlineOnly((v) => !v)}>
            Online only
          </Chip>
          <Chip active={sortBy === "price"} onClick={() => setSortBy("price")}>
            Cheapest first
          </Chip>
          <Chip active={sortBy === "rep"} onClick={() => setSortBy("rep")}>
            Best reputation
          </Chip>
        </div>
      </div>
    );
  }

  // ---------- Selected: seller list ----------
  const span = ranked ? 7 : 6;
  const watched = picked.on_watchlist || addedWatch;
  const inBuy = picked.buy_qty > 0 || addedBuy;
  return (
    <>
      <div className="mkt-head">
        <button type="button" className="btn sm" onClick={() => setPicked(null)}>
          ← Change item
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
          </button>
          <span className="muted">
            {picked.part_type} · {CATEGORY_LABELS[picked.category]}
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
      </div>

      <div className="mkt-controls">
        <Chip active={onlineOnly} onClick={() => setOnlineOnly((v) => !v)}>
          Online only
        </Chip>
        <Chip active={sortBy === "price"} onClick={() => setSortBy("price")}>
          Cheapest
        </Chip>
        <Chip active={sortBy === "rep"} onClick={() => setSortBy("rep")}>
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

      <div className="statband" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <StatBox
          k="Cheapest online"
          v={bestSell == null ? "—" : fmt(bestSell)}
          unit={bestSell == null ? undefined : "p"}
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
            {isLoading ? (
              <tr>
                <td colSpan={span} className="muted">
                  Loading sellers…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={span} className="muted">
                  Couldn't load orders. Try again in a moment.
                </td>
              </tr>
            ) : view.length === 0 ? (
              <tr>
                <td colSpan={span} className="muted">
                  No sellers match these filters.
                </td>
              </tr>
            ) : (
              view.map((o) => {
                // A user has at most one sell order per (item, rank) → unique key.
                const key = `${o.ingame_name}-${o.rank ?? "x"}`;
                const deal = median != null && o.platinum < median;
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
