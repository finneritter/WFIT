import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import type { ScreenId } from "../components/Sidebar";
import { MiniArea } from "../components/charts";
import { Glyph } from "../components/ui";
import {
  useArcaneDashboard,
  useBuyList,
  useListings,
  useSearchCatalog,
  useSummary,
  useTrends,
  useWorldstate,
} from "../hooks/queries";
import { CATEGORY_LABELS, clsx, countdown, fmt, fmtK, msUntil, nextUtc, pct } from "../lib/format";
import type { ArbitrationBlock, TrendRow, Worldstate } from "../lib/types";

/** A 1-second clock for the live world rail + ticking data-age. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const STYLE = (c: string) => ({ "--c": `var(${c})` }) as React.CSSProperties;

/** Market panel: search with live autofill suggestions (same pattern as the
 *  Market tab) plus a "hot right now" mini-list of the biggest market movers.
 *  Picking any item opens its drawer — the app's universal item-market view. */
function MarketSearch({ onOpen, hot }: { onOpen: (slug: string) => void; hot: TrendRow[] }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const { data = [], isFetching } = useSearchCatalog(query);
  return (
    <div className="lb-search">
      <div className="lb-search-head">Market search</div>
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
              <span className={clsx("lb-hot-d num", r.delta >= 0 ? "lb-pos" : "lb-neg")}>
                {pct(r.delta)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// arbitration community grade → accent color token
const GRADE_C: Record<string, string> = {
  s: "--g-s",
  a: "--g-a",
  b: "--g-b",
  c: "--g-c",
  d: "--g-d",
  f: "--g-f",
};

/** Compact live arbitration box — current rotation + the next notable S/A tier.
 *  Clicking opens the Rotation screen for the full schedule. */
function ArbitrationBox({
  block,
  onNavigate,
}: {
  block: ArbitrationBlock | null | undefined;
  onNavigate: (s: ScreenId) => void;
}) {
  const now = useNow();
  const cur = block?.current ?? null;
  const tier = cur?.tier ?? null;
  const next = block?.notable?.[0] ?? null;
  return (
    <button
      type="button"
      className="lb-arb"
      style={STYLE(tier ? (GRADE_C[tier.toLowerCase()] ?? "--soft") : "--soft")}
      onClick={() => onNavigate("rotation")}
    >
      <div className="lb-arb-head">
        <span className="lb-arb-title">Arbitration</span>
        {cur ? (
          <span className="lb-arb-cd num">{countdown(cur.expiry, now)}</span>
        ) : (
          <span className="lb-arb-cd lb-arb-muted">{block ? "none live" : "—"}</span>
        )}
      </div>
      {cur ? (
        <div className="lb-arb-body">
          <span className={clsx("tierb", tier && `t-${tier.toLowerCase()}`)}>{tier ?? "—"}</span>
          <span className="lb-arb-i">
            <span className="lb-arb-mission">{cur.mission_type}</span>
            <span className="lb-arb-node">
              {cur.node}
              {cur.enemy ? ` · ${cur.enemy}` : ""}
            </span>
          </span>
        </div>
      ) : (
        <div className="lb-arb-empty">
          {block ? "No live arbitration right now." : "Schedule unavailable."}
        </div>
      )}
      {next ? (
        <div className="lb-arb-next">
          next{" "}
          <b className={clsx("tierb-inline", `t-${(next.tier ?? "").toLowerCase()}`)}>
            {next.tier}
          </b>
          <span className="num"> {countdown(next.activation, now)}</span>
          <span className="lb-arb-muted"> · {next.node}</span>
        </div>
      ) : null}
    </button>
  );
}

/** The ticking world-pulse rail. Isolated so its 1s clock re-renders only
 *  this strip — not the whole dashboard (hero, cards, search). */
function WorldRail({
  ws,
  lastSynced,
  onNavigate,
}: {
  ws: Worldstate | undefined;
  lastSynced: string | null | undefined;
  onNavigate: (s: ScreenId) => void;
}) {
  const now = useNow();
  const ground = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0 && !f.is_storm);
  const cascade = ground
    .filter((f) => /cascade/i.test(f.mission_type))
    .sort((a, b) => msUntil(b.expiry) - msUntil(a.expiry))[0];
  const omnia = ground
    .filter((f) => f.tier.toLowerCase() === "omnia")
    .sort((a, b) => msUntil(a.expiry) - msUntil(b.expiry))[0];
  const cascadeLive = cascade !== undefined;
  const cascadeIso = (cascade ?? omnia)?.expiry;
  const baro = ws?.baro;
  const baroActive = baro?.active ?? false;
  const baroIso = baro ? (baroActive ? baro.expiry : baro.activation) : null;
  const fissuresLive = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0).length;
  const ageSecs = lastSynced
    ? Math.max(0, Math.floor((now - new Date(lastSynced).getTime()) / 1000))
    : null;
  const ageTxt =
    ageSecs == null
      ? "—"
      : ageSecs < 60
        ? `${ageSecs}s`
        : ageSecs < 3600
          ? `${Math.floor(ageSecs / 60)}m`
          : `${Math.floor(ageSecs / 3600)}h`;

  return (
    <button type="button" className="lb-pulse" onClick={() => onNavigate("rotation")}>
      <span className="lb-pulse-cell" style={STYLE("--pos")}>
        <span className="lb-pulse-lbl">Void Cascade</span>
        <span className={clsx("lb-pulse-val", !cascadeLive && "lb-mono")}>
          {cascadeLive ? (
            <>
              <span className="lb-livedot lb-livedot--pos lb-pulse-anim" />
              Live
            </>
          ) : (
            countdown(cascadeIso, now)
          )}
        </span>
        <span className="lb-pulse-meta">{cascadeLive ? "active now" : "until rotation"}</span>
      </span>
      <span className="lb-pulse-cell" style={STYLE("--essence")}>
        <span className="lb-pulse-lbl">Baro Ki'Teer</span>
        <span className="lb-pulse-val lb-mono">{baroIso ? countdown(baroIso, now) : "—"}</span>
        <span className="lb-pulse-meta">{baroActive ? "until departure" : "until arrival"}</span>
      </span>
      <span className="lb-pulse-cell" style={STYLE("--hot")}>
        <span className="lb-pulse-lbl">Daily reset</span>
        <span className="lb-pulse-val lb-mono">{countdown(nextUtc(0), now)}</span>
        <span className="lb-pulse-meta">countdown</span>
      </span>
      <span className="lb-pulse-cell" style={STYLE("--blue")}>
        <span className="lb-pulse-lbl">Fissures live</span>
        <span className="lb-pulse-val lb-mono">{fissuresLive}</span>
        <span className="lb-pulse-meta">across all tiers</span>
      </span>
      <span className="lb-pulse-cell" style={STYLE("--pos")}>
        <span className="lb-pulse-lbl">Price data</span>
        <span className="lb-pulse-val lb-mono">
          <span className="lb-livedot lb-livedot--pos lb-pulse-anim" />
          {ageTxt}
        </span>
        <span className="lb-pulse-meta">since last sync</span>
      </span>
    </button>
  );
}

interface CardDef {
  to: ScreenId;
  icon: string;
  label: string;
  color: string;
  value: React.ReactNode;
  unit?: string;
  sub: string;
  attn?: boolean;
}

export function Dashboard({
  onOpen,
  onNavigate,
}: {
  onOpen: (slug: string) => void;
  onNavigate: (s: ScreenId) => void;
}) {
  const { data: summary } = useSummary();
  const { data: listings = [] } = useListings();
  const { data: buy = [] } = useBuyList();
  const { data: arc } = useArcaneDashboard();
  const { data: ws } = useWorldstate();
  // Real market-index series for the hero chart — honest context (the app has no
  // stored portfolio-value history, so we show the market backdrop, clearly labelled).
  const { data: trends } = useTrends("30d");

  // Mirror the Listings screen's "Undercut" signal exactly: priced ABOVE the
  // market median, so it won't sell and needs lowering. Pricing at/under the
  // market (your_price <= market_low) clears it — so fixing prices there updates
  // this count on return. (`market_low` is the headline median, despite its name.)
  const undercutCount = useMemo(
    () =>
      listings.filter(
        (l) => l.your_price != null && l.market_low != null && l.your_price > l.market_low,
      ).length,
    [listings],
  );

  const atTarget = summary?.at_target_count ?? 0;
  const dissolveVosfor = arc?.summary.total_vosfor ?? 0;
  const dissolveCount = arc?.owned.filter((a) => a.verdict === "dissolve").length ?? 0;
  const hot = summary?.hot_count ?? 0;
  const port7d = summary?.portfolio_7d;
  // Liquidity = realizable / market ceiling — the app's core "how much is actually sellable".
  const liquidPct =
    summary && summary.total_plat > 0
      ? Math.round((summary.realizable_plat / summary.total_plat) * 100)
      : null;

  const cards: CardDef[] = [
    {
      to: "inventory",
      icon: "inventory",
      label: "Inventory",
      color: "--accent",
      value: fmt(summary?.distinct_count),
      sub: `${fmt(summary?.part_count)} parts`,
    },
    {
      to: "listings",
      icon: "tag",
      label: "Listings",
      color: "--hot",
      value: fmt(listings.length),
      sub: undercutCount ? `${undercutCount} priced over market` : "all at or under market",
      attn: undercutCount > 0,
    },
    {
      to: "watchlist",
      icon: "watchlist",
      label: "Watchlist",
      color: "--t-rare",
      value: fmt(atTarget),
      sub: atTarget ? "at your buy target" : "none at target",
      attn: atTarget > 0,
    },
    {
      to: "buy",
      icon: "buy",
      label: "Buy list",
      color: "--aya",
      value: fmt(buy.length),
      sub: buy.length ? "to buy" : "empty",
    },
    {
      to: "arcanes",
      icon: "arcane",
      label: "Arcanes",
      color: "--essence",
      value: fmtK(dissolveVosfor),
      unit: "vf",
      sub: dissolveCount ? `${dissolveCount} worth dissolving` : "Vosfor on hand",
      attn: dissolveCount > 0,
    },
    {
      to: "ducats",
      icon: "coin",
      label: "Ducats",
      color: "--ducat",
      value: fmtK(summary?.total_ducats),
      sub: "convertible",
    },
    {
      to: "sold",
      icon: "history",
      label: "Sold · 7d",
      color: "--pos",
      value: fmt(summary?.sold_7d),
      unit: "p",
      sub: "recent sales",
    },
    {
      to: "trends",
      icon: "trends",
      label: "Trends",
      color: "--blue",
      value: fmt(hot),
      sub: hot ? "hot movers" : "market signals",
      attn: hot > 0,
    },
  ];

  const indexUp = (trends?.index_change ?? 0) >= 0;

  return (
    <div className="lb-home">
      {/* ============ HERO ============ */}
      <button
        type="button"
        className="lb-hero"
        style={STYLE("--accent")}
        onClick={() => onNavigate("inventory")}
      >
        <div className="lb-hero-left">
          <div className="lb-hero-head">
            <span className="lb-eyebrow">
              <span className="lb-livedot lb-livedot--pos" />
              Portfolio · realizable
            </span>
            <div className="lb-hero-figrow">
              <span className="lb-hero-fig">~{fmtK(summary?.realizable_plat)}</span>
              <span className="lb-hero-cur">p</span>
            </div>
            <div className="lb-hero-sub">
              liquidation-adjusted across <b>{fmt(summary?.distinct_count)}</b> items
            </div>
          </div>

          <div className="lb-hero-stats">
            <div className="lb-mini">
              <span className="lb-mini-lbl">Market ceiling</span>
              <span className="lb-mini-val">
                {fmtK(summary?.total_plat)}
                <i>p</i>
              </span>
            </div>
            <div className="lb-mini">
              <span className="lb-mini-lbl">7d change</span>
              <span className={clsx("lb-mini-val", (port7d ?? 0) >= 0 ? "lb-pos" : "lb-neg")}>
                {port7d == null ? "—" : pct(port7d)}
              </span>
            </div>
            <div className="lb-mini">
              <span className="lb-mini-lbl">Full sets</span>
              <span className="lb-mini-val">{fmt(summary?.full_set_count)}</span>
            </div>
            <div
              className="lb-mini"
              title="Realizable value as a share of the optimistic market ceiling"
            >
              <span className="lb-mini-lbl">Liquid</span>
              <span className="lb-mini-val">{liquidPct == null ? "—" : `${liquidPct}%`}</span>
            </div>
          </div>
        </div>

        <div className="lb-hero-chart">
          {trends?.index_spark && trends.index_spark.length >= 2 ? (
            <MiniArea
              data={trends.index_spark}
              w={360}
              h={150}
              accent={indexUp ? "var(--pos)" : "var(--neg)"}
            />
          ) : null}
          <span className="lb-chart-tag">
            Market · 30d{" "}
            {trends ? (
              <i className={indexUp ? "lb-pos" : "lb-neg"}>{pct(trends.index_change)}</i>
            ) : null}
          </span>
        </div>
      </button>

      {/* ============ WORLD PULSE RAIL ============ */}
      <WorldRail ws={ws} lastSynced={summary?.last_synced} onNavigate={onNavigate} />

      {/* ============ TOOLS: market search + arbitration ============ */}
      <div className="lb-tools">
        <MarketSearch onOpen={onOpen} hot={(trends?.unusual ?? []).slice(0, 3)} />
        <ArbitrationBox block={ws?.arbitration} onNavigate={onNavigate} />
      </div>

      {/* ============ LAUNCH GRID ============ */}
      <div className="lb-section-bar">
        <span className="lb-section-lbl">Launch</span>
        <span className="lb-section-rule" />
      </div>

      <div className="lb-grid">
        {cards.map((c) => (
          <button
            key={c.to}
            type="button"
            className={clsx("lb-card", c.attn && "lb-card--attn")}
            style={STYLE(c.color)}
            onClick={() => onNavigate(c.to)}
          >
            <div className="lb-card-top">
              <span className="lb-icn">
                <Icon name={c.icon} />
              </span>
              <span className="lb-card-lbl">{c.label}</span>
              {c.attn ? <span className="lb-attn-dot" /> : null}
            </div>
            <div className="lb-card-fig">
              {c.value}
              {c.unit ? <span className="lb-fig-unit"> {c.unit}</span> : null}
            </div>
            <div className="lb-card-sub">{c.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
