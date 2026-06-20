// Dashboard — the action-first overview, presented in the Rotation screen's
// visual idiom: .fwx portfolio hero, .rsetbar world strip, and a dense
// two-column .rot-grid of tpanels. Every row opens its item's drawer; every
// group header opens the owning screen.
import { useMemo, useState } from "react";
import { Countdown, TierBadge } from "../components/Countdown";
import { Icon } from "../components/Icon";
import type { ScreenId } from "../components/Sidebar";
import { MiniArea, Spark } from "../components/charts";
import { BlockStatus, Glyph, ItemName, rowAction } from "../components/ui";
import {
  useAddToBuyList,
  useArcaneDashboard,
  useInventory,
  useListings,
  useSearchCatalog,
  useSets,
  useSummary,
  useTrends,
  useWatchlist,
  useWorldstate,
} from "../hooks/queries";
import {
  CATEGORY_LABELS,
  atTarget,
  clsx,
  dayTime,
  fmt,
  fmtK,
  msUntil,
  nextUtc,
  pct,
  syncedAgo,
} from "../lib/format";
import type { ArbitrationBlock, Summary, TrendRow, TrendsData, Worldstate } from "../lib/types";

// ---------------------------------------------------------------------------
// Portfolio hero (.fwx reuse, accent-tinted variant)
// ---------------------------------------------------------------------------

function PortfolioHero({
  summary,
  trends,
}: {
  summary: Summary | undefined;
  trends: TrendsData | undefined;
}) {
  const port7d = summary?.portfolio_7d;
  // Liquidity = realizable / market ceiling — the app's core "how much is actually sellable".
  const liquidPct =
    summary && summary.total_plat > 0
      ? Math.round((summary.realizable_plat / summary.total_plat) * 100)
      : null;
  const indexUp = (trends?.index_change ?? 0) >= 0;
  return (
    <div className="fwx fwx--port">
      <div className="fwx-top">
        <span className="led" />
        <span className="lbl">Portfolio · realizable</span>
        <span>{fmt(summary?.distinct_count)} items · liquidation-adjusted</span>
        <span className="status">● LIVE · synced {syncedAgo(summary?.last_synced ?? null)}</span>
      </div>
      <div className="fwx-main">
        <div>
          <div className="fwx-title">~{fmtK(summary?.realizable_plat)}p</div>
          <div className="fwx-meta">
            <span>ceiling {fmtK(summary?.total_plat)}p</span>
            <span className="muted">·</span>
            <span>{fmt(summary?.full_set_count)} full sets</span>
          </div>
        </div>
        <div className="fwx-timer">
          <div className={clsx("big", port7d != null && (port7d >= 0 ? "pos" : "neg"))}>
            {port7d == null ? "—" : pct(port7d)}
          </div>
          <div className="tl">7d change</div>
        </div>
      </div>
      <div className="fwx-counts">
        <div
          className="fwx-cell"
          title="Realizable value as a share of the optimistic market ceiling"
        >
          <div className="v">{liquidPct == null ? "—" : `${liquidPct}%`}</div>
          <div className="k">Liquid</div>
        </div>
        <div className="fwx-cell">
          <div className={clsx("v", indexUp ? "pos" : "neg")}>
            {trends ? pct(trends.index_change) : "—"}
          </div>
          <div className="k">Market 30d</div>
        </div>
        <div className="fwx-cell">
          <div className="v">{fmt(summary?.hot_count)}</div>
          <div className="k">Hot movers</div>
        </div>
        <div className="fwx-cell">
          <div className="v">{fmtK(summary?.sold_7d)}p</div>
          <div className="k">Sold 7d</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// World strip (.rsetbar reuse) — one click target for the Rotation screen
// ---------------------------------------------------------------------------

function WorldStrip({
  ws,
  lastSynced,
  onNavigate,
}: {
  ws: Worldstate | undefined;
  lastSynced: string | null | undefined;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  const ground = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0 && !f.is_storm);
  // If both Normal + Steel Path cascades are up, show the longer-lived one.
  const cascade = ground
    .filter((f) => /cascade/i.test(f.mission_type))
    .sort((a, b) => msUntil(b.expiry) - msUntil(a.expiry))[0];
  const omnia = ground
    .filter((f) => f.tier.toLowerCase() === "omnia")
    .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry))[0];
  const cascadeLive = cascade !== undefined;
  const baro = ws?.baro;
  const baroActive = baro?.active ?? false;
  const baroIso = baro ? (baroActive ? baro.expiry : baro.activation) : null;
  const fissuresLive = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0).length;
  return (
    <button type="button" className="rsetbar r5" onClick={() => onNavigate("rotation")}>
      {/* Live cascade tints the whole box like Rotation's .fwx.hit hero —
          Steel Path carries the SP amber; a normal one stays green. */}
      <span className={clsx("rsetbox", cascadeLive && (cascade.is_hard ? "hit-sp" : "hit"))}>
        <span className="k">Void Cascade</span>
        <span className={clsx("v", cascadeLive && (cascade.is_hard ? "sp" : "pos"))}>
          {cascadeLive ? "Live" : <Countdown iso={omnia?.expiry} />}
        </span>
      </span>
      <span className="rsetbox">
        <span className="k">{baroActive ? "Baro · departs" : "Baro · arrives"}</span>
        <span className="v">
          <Countdown iso={baroIso} warnMs={12 * 3_600_000} soonMs={2 * 3_600_000} />
        </span>
      </span>
      <span className="rsetbox">
        <span className="k">Daily reset</span>
        <span className="v">
          <Countdown iso={nextUtc(0)} />
        </span>
      </span>
      <span className="rsetbox">
        <span className="k">Fissures live</span>
        <span className="v">{fissuresLive}</span>
      </span>
      <span className="rsetbox">
        <span className="k">Price data</span>
        <span className="v">{syncedAgo(lastSynced ?? null)}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// "Do next" panel — the centerpiece: real item-level actions, grouped
// ---------------------------------------------------------------------------

function GroupHeader({
  label,
  count,
  onNav,
}: {
  label: string;
  count: number;
  onNav: () => void;
}) {
  return (
    <button type="button" className="fgroup-h" onClick={onNav}>
      {label} · {count}
      <span className="fg-go">view all →</span>
    </button>
  );
}

function DoNextPanel({
  onOpen,
  onNavigate,
}: {
  onOpen: (slug: string) => void;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  const listingsQ = useListings();
  const watchQ = useWatchlist();
  const setsQ = useSets();
  const trendsQ = useTrends("30d");
  const arcQ = useArcaneDashboard();
  const buy = useAddToBuyList();

  const listings = listingsQ.data ?? [];
  const watch = watchQ.data ?? [];
  const sets = setsQ.data ?? [];
  const arc = arcQ.data;

  // Mirrors the Listings screen's "Undercut" signal: priced ABOVE the market
  // median, so it won't sell and needs lowering. (`market_low` is the headline
  // median, despite its name.)
  const over = useMemo(
    () =>
      listings
        .filter((l) => l.your_price != null && l.market_low != null && l.your_price > l.market_low)
        .sort((a, b) => b.your_price! - b.market_low! - (a.your_price! - a.market_low!)),
    [listings],
  );

  // Shared at-target predicate (lib/format), sorted by savings.
  const atTargetRows = useMemo(
    () =>
      watch
        .filter(atTarget)
        .sort((a, b) => b.target_plat! - b.median_plat! - (a.target_plat! - a.median_plat!)),
    [watch],
  );

  const oneAway = useMemo(
    () =>
      sets
        .filter((s) => !s.complete && s.total_parts - s.owned_parts === 1)
        .sort(
          (a, b) =>
            (a.missing_value ?? Number.POSITIVE_INFINITY) -
            (b.missing_value ?? Number.POSITIVE_INFINITY),
        ),
    [sets],
  );

  const sell = trendsQ.data?.sell_signals.slice(0, 2) ?? [];

  const dissolve = useMemo(() => {
    if (!arc) return null;
    const count = arc.owned.filter((a) => a.verdict === "dissolve").length;
    if (count === 0) return null;
    const vosfor = arc.summary.total_vosfor;
    return { count, vosfor, plat: Math.round(vosfor * arc.summary.plat_per_vosfor) };
  }, [arc]);

  // isLoading (not isPending): a WFM-disconnected listings *error* must fall
  // to [] and simply omit the group, never wedge the panel.
  const loading =
    listingsQ.isLoading ||
    watchQ.isLoading ||
    setsQ.isLoading ||
    trendsQ.isLoading ||
    arcQ.isLoading;
  const total =
    over.length + atTargetRows.length + oneAway.length + sell.length + (dissolve ? 1 : 0);

  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Do next</h3>
        <span className="meta">{loading ? "…" : `${total} actionable`}</span>
      </div>
      {loading ? (
        <BlockStatus />
      ) : total === 0 ? (
        <div className="dx-clear">All clear — nothing needs attention right now.</div>
      ) : (
        <>
          {over.length > 0 ? (
            <>
              <GroupHeader
                label="Listings over market"
                count={over.length}
                onNav={() => onNavigate("listings")}
              />
              {over.slice(0, 3).map((l) => (
                <button
                  key={l.order_id}
                  type="button"
                  className="dx-row"
                  onClick={() => onOpen(l.slug)}
                >
                  <ItemName
                    name={l.display_name}
                    plat={l.your_price}
                    thumb={l.thumbnail_url}
                    sub={`yours ${fmt(l.your_price)}p · market ${fmt(l.market_low)}p`}
                  />
                  <span className="dx-val neg">+{fmt(l.your_price! - l.market_low!)}p over</span>
                </button>
              ))}
            </>
          ) : null}

          {atTargetRows.length > 0 ? (
            <>
              <GroupHeader
                label="Watchlist at target"
                count={atTargetRows.length}
                onNav={() => onNavigate("watchlist")}
              />
              {atTargetRows.slice(0, 3).map((r) => (
                // div (not button): the row contains the inline + buy control.
                <div key={r.slug} className="dx-row" {...rowAction(() => onOpen(r.slug))}>
                  <ItemName
                    name={r.display_name}
                    plat={r.median_plat}
                    thumb={r.thumbnail_url}
                    sub={`target ${fmt(r.target_plat)}p · now ${fmt(r.median_plat)}p`}
                  />
                  <span className="dx-val pos">−{fmt(r.target_plat! - r.median_plat!)}p</span>
                  <button
                    type="button"
                    className="btn sm dx-act"
                    disabled={buy.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      buy.mutate({ slug: r.slug });
                    }}
                  >
                    + buy
                  </button>
                </div>
              ))}
            </>
          ) : null}

          {oneAway.length > 0 ? (
            <>
              <GroupHeader
                label="One part from a set"
                count={oneAway.length}
                onNav={() => onNavigate("sets")}
              />
              {oneAway.slice(0, 3).map((s) => {
                const missing = s.parts.find((p) => !p.owned);
                return (
                  <button
                    key={s.set_slug}
                    type="button"
                    className="dx-row"
                    onClick={() => (missing ? onOpen(missing.slug) : onNavigate("sets"))}
                  >
                    <ItemName
                      name={s.set_name}
                      plat={s.set_value}
                      sub={missing ? `missing ${missing.part_name}` : "missing part unknown"}
                    />
                    <span className="dx-val">+{fmt(s.missing_value)}p to complete</span>
                  </button>
                );
              })}
            </>
          ) : null}

          {sell.length > 0 ? (
            <>
              <GroupHeader
                label="Consider selling"
                count={trendsQ.data?.sell_signal_count ?? sell.length}
                onNav={() => onNavigate("listings", { listingsTab: "recommended" })}
              />
              {sell.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className="dx-row"
                  onClick={() => onOpen(t.slug)}
                >
                  <ItemName
                    name={t.display_name}
                    plat={t.median_plat}
                    thumb={t.thumbnail_url}
                    sub={`${t.part_type} · owned ×${t.owned_qty}`}
                  />
                  <span className={clsx("dx-val", t.delta >= 0 ? "pos" : "neg")}>
                    {pct(t.delta)}
                  </span>
                  <span className="dx-val">{fmt(t.median_plat)}p</span>
                </button>
              ))}
            </>
          ) : null}

          {dissolve ? (
            <>
              <GroupHeader
                label="Arcanes to dissolve"
                count={dissolve.count}
                onNav={() => onNavigate("arcanes")}
              />
              <button type="button" className="dx-row" onClick={() => onNavigate("arcanes")}>
                <span className="dx-sum">
                  Dissolve {dissolve.count} arcanes → {fmtK(dissolve.vosfor)} vf · ≈
                  {fmt(dissolve.plat)}p
                </span>
              </button>
            </>
          ) : null}

          <div className="src-note">rows open the item · headers open the screen</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right column panels
// ---------------------------------------------------------------------------

function MoversPanel({
  onOpen,
  onNavigate,
}: {
  onOpen: (slug: string) => void;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  const invQ = useInventory();
  const movers = useMemo(
    () =>
      (invQ.data ?? [])
        .filter(
          (r) =>
            r.delta_7d != null && !r.excluded && (r.realizable_plat ?? r.median_plat ?? 0) >= 10,
        )
        .sort((a, b) => Math.abs(b.delta_7d!) - Math.abs(a.delta_7d!))
        .slice(0, 5),
    [invQ.data],
  );
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Your movers · 7d</h3>
        <button type="button" className="tp-link" onClick={() => onNavigate("inventory")}>
          view all →
        </button>
      </div>
      {invQ.isLoading ? (
        <BlockStatus />
      ) : movers.length === 0 ? (
        <div className="empty">No notable moves this week.</div>
      ) : (
        movers.map((r) => (
          <button key={r.slug} type="button" className="dx-row mv" onClick={() => onOpen(r.slug)}>
            <ItemName
              name={r.display_name}
              plat={r.median_plat}
              thumb={r.thumbnail_url}
              sub={r.part_type}
            />
            <Spark data={r.spark} w={60} h={18} up={(r.delta_7d ?? 0) >= 0} />
            <span className={clsx("dx-val", (r.delta_7d ?? 0) >= 0 ? "pos" : "neg")}>
              {pct(r.delta_7d ?? 0)}
            </span>
            <span className="dx-val">{fmt(r.realizable_plat)}p</span>
          </button>
        ))
      )}
    </div>
  );
}

function ArbitrationPanel({
  block,
  onNavigate,
}: {
  block: ArbitrationBlock | null;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Arbitration</h3>
        <button type="button" className="tp-link" onClick={() => onNavigate("rotation")}>
          full schedule →
        </button>
      </div>
      {!block ? (
        <div className="empty">Schedule unavailable.</div>
      ) : (
        <>
          {block.current ? (
            <div className="arb-now">
              <TierBadge tier={block.current.tier} />
              <div className="arb-i">
                <div className="arb-mission">{block.current.mission_type}</div>
                <div className="arb-node">
                  {block.current.node}
                  {block.current.enemy ? ` · ${block.current.enemy}` : ""}
                </div>
              </div>
              <div className="arb-cd num">
                <Countdown iso={block.current.expiry} />
              </div>
            </div>
          ) : (
            <div className="empty">No live arbitration right now.</div>
          )}
          {block.notable.length > 0 ? (
            <>
              <div className="fgroup-h">Ones of note · S/A</div>
              {block.notable.slice(0, 2).map((a) => (
                <div className="arbn-row" key={a.activation}>
                  <TierBadge tier={a.tier} />
                  <div className="arbn-i">
                    <div className="arbn-n">{a.node}</div>
                    <div className="arbn-s">
                      {a.mission_type}
                      {a.enemy ? ` · ${a.enemy}` : ""}
                    </div>
                  </div>
                  <div className="arbn-r">
                    <div className="arbn-at num">{dayTime(a.activation)}</div>
                    <div className="arbn-cd num">
                      <Countdown iso={a.activation} />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function MarketPulsePanel({
  trends,
  loading,
  onNavigate,
}: {
  trends: TrendsData | undefined;
  loading: boolean;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  const up = (trends?.index_change ?? 0) >= 0;
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Market · 30d</h3>
        {trends ? (
          <span className={clsx("meta", up ? "pos" : "neg")}>{pct(trends.index_change)}</span>
        ) : null}
        <button type="button" className="tp-link" onClick={() => onNavigate("trends")}>
          view all →
        </button>
      </div>
      {loading ? (
        <BlockStatus />
      ) : !trends || trends.index_spark.length < 2 ? (
        <div className="empty">Market index appears here once prices sync.</div>
      ) : (
        <div className="dx-m30">
          <MiniArea
            data={trends.index_spark}
            w={260}
            h={56}
            accent={up ? "var(--pos)" : "var(--neg)"}
          />
          <div className="fwx-counts">
            <div className="fwx-cell">
              <div className="v pos">{fmt(trends.advancing)}</div>
              <div className="k">Advancing</div>
            </div>
            <div className="fwx-cell">
              <div className="v neg">{fmt(trends.declining)}</div>
              <div className="k">Declining</div>
            </div>
            <div className="fwx-cell">
              <div className="v muted">{fmt(trends.flat)}</div>
              <div className="k">Flat</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Market search: live autofill suggestions (same pattern as the Market tab)
 *  plus a "hot right now" mini-list of the biggest market movers. Picking any
 *  item opens its drawer — the app's universal item-market view. */
function MarketSearch({ onOpen, hot }: { onOpen: (slug: string) => void; hot: TrendRow[] }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const { data = [], isFetching } = useSearchCatalog(query);
  return (
    <div className="tpanel">
      <div className="tpanel-h">
        <h3>Market search</h3>
      </div>
      <div className="lb-search">
        <div className="lb-search-rel">
          <div className="search">
            <Icon name="search" />
            <input
              placeholder="Search any tradable item…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQ("");
              }}
            />
          </div>
          {query.length >= 2 ? (
            <div className="search-results">
              {data.length === 0 ? (
                <div className="sr-empty">{isFetching ? "Searching…" : "No items match."}</div>
              ) : (
                data.map((r) => (
                  <button
                    key={r.slug}
                    type="button"
                    className="sr-row"
                    onClick={() => {
                      onOpen(r.slug);
                      setQ("");
                    }}
                  >
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
          ) : null}
        </div>

        <div className="lb-hot">
          <div className="lb-hot-h">Hot right now · 30d</div>
          {hot.length === 0 ? (
            <div className="lb-hot-empty">Market movers will appear here once prices sync.</div>
          ) : (
            hot.map((r) => (
              <button
                key={r.slug}
                type="button"
                className="lb-hot-row"
                onClick={() => onOpen(r.slug)}
              >
                <Glyph name={r.display_name} plat={r.median_plat} thumb={r.thumbnail_url} />
                <span className="lb-hot-n">{r.display_name}</span>
                <span className="lb-hot-p num">{fmt(r.median_plat)}p</span>
                <span className={clsx("lb-hot-d num", r.delta >= 0 ? "pos" : "neg")}>
                  {pct(r.delta)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function Dashboard({
  onOpen,
  onNavigate,
}: {
  onOpen: (slug: string) => void;
  onNavigate: (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;
}) {
  const { data: summary } = useSummary();
  const { data: ws } = useWorldstate();
  const { data: trends, isLoading: trendsLoading } = useTrends("30d");

  return (
    <>
      <PortfolioHero summary={summary} trends={trends} />
      <WorldStrip ws={ws} lastSynced={summary?.last_synced} onNavigate={onNavigate} />
      <div className="rot-grid v2">
        <div className="rot-col">
          <DoNextPanel onOpen={onOpen} onNavigate={onNavigate} />
        </div>
        <div className="rot-col">
          <MoversPanel onOpen={onOpen} onNavigate={onNavigate} />
          <ArbitrationPanel block={ws?.arbitration ?? null} onNavigate={onNavigate} />
          <MarketPulsePanel trends={trends} loading={trendsLoading} onNavigate={onNavigate} />
          <MarketSearch onOpen={onOpen} hot={(trends?.unusual ?? []).slice(0, 3)} />
        </div>
      </div>
    </>
  );
}
