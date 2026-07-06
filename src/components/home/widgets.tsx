// Home-screen widget catalog. Every widget shares one uniform tile chrome
// (WidgetHeader + a `.hw-b` body) and adapts its content to the grid size it
// was given (1×1 / 1×2 / 2×1 / 2×2). A widget is a glanceable *preview* of a
// screen — its header navigates there; rows inside open the item drawer.
//
// Data comes exclusively from the existing React Query hooks (hooks/queries.ts)
// — no new backend commands. Each widget is its own component so only the
// enabled ones mount (and only their queries run).
import type React from "react";
import { useMemo, useState } from "react";
import {
  useAccountProfile,
  useArcaneDashboard,
  useBudget,
  useBuyList,
  useDucats,
  useInventory,
  useListingRecommendations,
  useListings,
  useNotifications,
  useRelicBrowser,
  useRivenSearches,
  useSales,
  useSearchCatalog,
  useSets,
  useSummary,
  useTrends,
  useVendorBoard,
  useWantedNow,
  useWatchlist,
  useWfmAccount,
  useWorldstate,
} from "../../hooks/queries";
import { clsx, fmt, fmtK, msUntil, nextUtc, pct, syncedAgo } from "../../lib/format";
import { Countdown } from "../Countdown";
import { Icon } from "../Icon";
import type { ScreenId } from "../Sidebar";
import { MiniArea } from "../charts";
import { Glyph } from "../ui";
import {
  atTargetWatches,
  dailyEarnings,
  liveCascade,
  oneAwaySets,
  overMarketListings,
  sumSales,
  within,
} from "./selectors";

export type Nav = (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;

export interface WidgetProps {
  w: number;
  h: number;
  /** Click-to-focus (grid-owned): the row list drops its cap and scrolls. */
  focused?: boolean;
  onOpen: (slug: string) => void;
  onNavigate: Nav;
}

export interface WidgetDef {
  key: string;
  title: string;
  icon: string;
  /** Header click target. */
  screen?: ScreenId;
  /** Grouping in the Add-widget checklist. */
  group: "Overview" | "Portfolio" | "Trading" | "Planning" | "World";
  /** Seed size when first added. */
  default: { w: number; h: number };
  /** Minimum size (defaults to 1×1). Widgets that need room set this. */
  min?: { w: number; h: number };
  Render: (p: WidgetProps) => React.ReactElement;
}

// ---------------------------------------------------------------------------
// Shared body primitives — keep every metric widget visually identical.
// ---------------------------------------------------------------------------

interface Cell {
  k: string;
  v: React.ReactNode;
  tone?: string;
}

/** Colored delta pill: ▲ green / ▼ red, magnitude only (the arrow carries sign). */
function DeltaChip({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span className={clsx("hw-chip", up ? "pos" : "neg")}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
    </span>
  );
}

/** The size-adaptive body. Content scales with the tile and always fills it:
 *  - 1×1 → headline number (+ delta chip, + sparkline if any)
 *  - 2×1 → headline + stat strip
 *  - 1×2 → headline + list
 *  - 2×2 → headline + stat strip + list
 *  Color is semantic: toned headline, delta chip, sparkline, tier-edged glyphs. */
function WidgetBody({
  w,
  h,
  focused,
  big,
  unit,
  bigTone,
  delta,
  spark,
  sub,
  cells,
  rows,
  loading,
  error,
  stale,
  empty,
}: {
  w: number;
  h: number;
  focused?: boolean;
  big: React.ReactNode;
  unit?: string;
  bigTone?: string;
  delta?: number | null;
  spark?: number[];
  sub?: React.ReactNode;
  cells?: Cell[];
  rows?: React.ReactNode[];
  loading?: boolean;
  /** Query failed with nothing cached — pass `isError && !data`. */
  error?: boolean;
  /** Query failed but cached data is shown — a quiet staleness dim. */
  stale?: boolean;
  empty?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="hw-b">
        <div className="hw-msg">Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="hw-b">
        <div className="hw-msg">Couldn't load — retrying.</div>
      </div>
    );
  }
  if (empty != null) {
    return (
      <div className="hw-b">
        <div className="hw-msg">{empty}</div>
      </div>
    );
  }
  const showCells = w >= 2 && !!cells?.length;
  const showRows = h >= 2 && !!rows?.length;
  // Sparkline fills the smallest tier (1×1) where there's no strip or list.
  const showSpark = !showCells && !showRows && !!spark && spark.length >= 2;
  const solo = !showCells && !showRows && !showSpark;
  const rowLimit = w >= 2 ? 5 : 4;
  const up = showSpark && spark![spark!.length - 1] >= spark![0];
  return (
    <div
      className={clsx("hw-b", solo && "solo", stale && "stale")}
      title={stale ? "Data may be stale" : undefined}
    >
      <div className="hw-head">
        <div className="hw-headline">
          <div className={clsx("hw-big", bigTone)}>
            {big}
            {unit ? <span className="hw-u">{unit}</span> : null}
          </div>
          {delta != null ? <DeltaChip delta={delta} /> : null}
        </div>
        {sub != null ? <div className="hw-sub">{sub}</div> : null}
      </div>
      {showSpark ? (
        <div className="hw-spark">
          <MiniArea data={spark!} w={240} h={40} accent={up ? "var(--pos)" : "var(--neg)"} />
        </div>
      ) : null}
      {showCells ? (
        <div className={clsx("hw-cells", !showRows && "fill")}>
          {cells!.slice(0, 4).map((c) => (
            <div className="hw-cell" key={c.k}>
              <div className={clsx("hw-cv", c.tone)}>{c.v}</div>
              <div className="hw-ck">{c.k}</div>
            </div>
          ))}
        </div>
      ) : null}
      {showRows ? (
        // Focused tile: the cap comes off and the list scrolls inside the tile.
        <div className={clsx("hw-rows", focused && "scroll")}>
          {focused ? rows : rows!.slice(0, rowLimit)}
        </div>
      ) : null}
    </div>
  );
}

/** One preview row: tier glyph + name (+ sub) and a right-aligned value.
 *  Clickable only when it has somewhere to go — `onClick` wins, else a truthy
 *  slug + onOpen opens the item drawer; otherwise it renders as a static line
 *  (no button, no hover affordance). */
function HwRow({
  slug,
  name,
  plat,
  thumb,
  sub,
  right,
  tone,
  onOpen,
  onClick,
}: {
  slug?: string | null;
  name: string;
  plat: number | null | undefined;
  thumb?: string | null;
  sub?: React.ReactNode;
  right: React.ReactNode;
  tone?: string;
  onOpen?: (slug: string) => void;
  onClick?: () => void;
}) {
  const act = onClick ?? (slug && onOpen ? () => onOpen(slug) : undefined);
  const inner = (
    <>
      <Glyph name={name} plat={plat} thumb={thumb} />
      <span className="hw-row-i">
        <span className="hw-row-n">{name}</span>
        {sub != null ? <span className="hw-row-s">{sub}</span> : null}
      </span>
      <span className={clsx("hw-row-v", tone)}>{right}</span>
    </>
  );
  if (!act) return <div className="hw-row hw-row-static">{inner}</div>;
  return (
    <button type="button" className="hw-row" onClick={act}>
      {inner}
    </button>
  );
}

const toneOf = (n: number | null | undefined) => (n == null ? undefined : n >= 0 ? "pos" : "neg");

// Widgets hand WidgetBody a generous list (the focused tile scrolls through
// it); WidgetBody itself caps what an unfocused tile renders.
const ROW_POOL = 24;

// ---------------------------------------------------------------------------
// Portfolio / inventory
// ---------------------------------------------------------------------------

function InventoryWidget({ w, h, focused, onOpen }: WidgetProps) {
  const sum = useSummary();
  const summary = sum.data;
  const inv = useInventory();
  const top = useMemo(
    () =>
      (inv.data ?? [])
        .filter((r) => !r.excluded && (r.realizable_plat ?? 0) > 0)
        .sort((a, b) => (b.realizable_plat ?? 0) - (a.realizable_plat ?? 0))
        .slice(0, ROW_POOL),
    [inv.data],
  );
  const loading = (!summary && !sum.isError) || inv.isLoading;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={loading}
      error={sum.isError && !summary}
      empty={
        !loading && summary && summary.distinct_count === 0 ? "No items tracked yet." : undefined
      }
      big={`~${fmtK(summary?.realizable_plat)}`}
      unit="p"
      delta={summary?.portfolio_7d}
      sub={`${fmt(summary?.distinct_count)} items · ${fmt(summary?.full_set_count)} sets`}
      cells={[
        { k: "Ceiling", v: `${fmtK(summary?.total_plat)}p` },
        {
          k: "7d",
          v: summary?.portfolio_7d == null ? "—" : pct(summary.portfolio_7d),
          tone: toneOf(summary?.portfolio_7d),
        },
        { k: "Hot", v: fmt(summary?.hot_count) },
      ]}
      rows={top.map((r) => (
        <HwRow
          key={r.slug}
          slug={r.slug}
          name={r.display_name}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={r.part_type}
          right={`${fmt(r.realizable_plat)}p`}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

function MoversWidget({ w, h, focused, onOpen }: WidgetProps) {
  const inv = useInventory();
  const movers = useMemo(
    () =>
      (inv.data ?? [])
        .filter(
          (r) =>
            r.delta_7d != null && !r.excluded && (r.realizable_plat ?? r.median_plat ?? 0) >= 10,
        )
        .sort((a, b) => Math.abs(b.delta_7d!) - Math.abs(a.delta_7d!))
        .slice(0, ROW_POOL),
    [inv.data],
  );
  const up = movers.filter((r) => (r.delta_7d ?? 0) >= 0).length;
  const lead = movers[0];
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={inv.isLoading}
      error={inv.isError && !inv.data}
      big={fmt(movers.length)}
      delta={lead?.delta_7d}
      spark={lead?.spark}
      sub="movers · 7d"
      empty={!inv.isLoading && movers.length === 0 ? "No notable moves this week." : undefined}
      cells={[
        { k: "Up", v: fmt(up), tone: "pos" },
        { k: "Down", v: fmt(movers.length - up), tone: "neg" },
        { k: "Top", v: lead ? pct(lead.delta_7d ?? 0) : "—", tone: toneOf(lead?.delta_7d) },
      ]}
      rows={movers.map((r) => (
        <HwRow
          key={r.slug}
          slug={r.slug}
          name={r.display_name}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={`${fmt(r.median_plat)}p`}
          right={pct(r.delta_7d ?? 0)}
          tone={toneOf(r.delta_7d)}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

function RelicsWidget({ w, h, focused, onNavigate }: WidgetProps) {
  const browser = useRelicBrowser(1);
  // Owned relics only — the widget is a glance at your holdings, not the catalog.
  const owned = useMemo(() => (browser.data ?? []).filter((r) => r.qty > 0), [browser.data]);
  const { totalEv, totalQty } = useMemo(
    () => ({
      totalEv: owned.reduce((s, r) => s + r.ev_plat * r.qty, 0),
      totalQty: owned.reduce((s, r) => s + r.qty, 0),
    }),
    [owned],
  );
  // The crack queue: what to burn next — crackable-right-now first, protected out.
  const queue = useMemo(
    () =>
      owned
        .filter((r) => !r.protected)
        .sort((a, b) => Number(b.crackable_now) - Number(a.crackable_now) || b.score - a.score)
        .slice(0, ROW_POOL),
    [owned],
  );
  const crackable = useMemo(() => owned.filter((r) => r.crackable_now).length, [owned]);
  const loading = browser.isLoading;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={loading}
      error={browser.isError && !browser.data}
      big={`~${fmtK(totalEv)}`}
      unit="p"
      sub={`${fmt(totalQty)} relics · expected`}
      empty={!loading && owned.length === 0 ? "No relics tracked yet." : undefined}
      cells={[
        { k: "Relics", v: fmt(totalQty) },
        { k: "Crackable", v: fmt(crackable), tone: crackable ? "pos" : undefined },
        { k: "Best", v: `${fmt(queue[0]?.ev_plat)}p` },
      ]}
      rows={queue.map((r) => (
        <HwRow
          key={`${r.tier}-${r.relic_name}`}
          name={r.display_name}
          plat={r.ev_plat}
          sub={`×${r.qty}`}
          right={`${fmt(r.ev_plat)}p`}
          tone={r.crackable_now ? "pos" : undefined}
          onClick={() => onNavigate("relics")}
        />
      ))}
    />
  );
}

function ArcanesWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useArcaneDashboard();
  const s = data?.summary;
  const { dissolve, top } = useMemo(() => {
    const owned = data?.owned ?? [];
    return {
      dissolve: owned.filter((a) => a.verdict === "dissolve").length,
      top: [...owned].sort((a, b) => (b.plat ?? 0) - (a.plat ?? 0)).slice(0, ROW_POOL),
    };
  }, [data?.owned]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(s?.owned_count)}
      sub="arcanes owned"
      empty={!isLoading && (s?.owned_count ?? 0) === 0 ? "No arcanes owned." : undefined}
      cells={[
        { k: "Sell", v: `${fmtK(s?.sell_plat)}p` },
        { k: "Dissolve", v: fmt(dissolve) },
        { k: "Vosfor", v: fmtK(s?.total_vosfor) },
      ]}
      rows={top.map((a) => (
        <HwRow
          key={a.slug}
          slug={a.slug}
          name={a.display_name}
          plat={a.plat}
          thumb={a.thumbnail_url}
          sub={a.rarity ?? undefined}
          right={a.verdict === "dissolve" ? "dissolve" : `${fmt(a.plat)}p`}
          tone={a.verdict === "dissolve" ? "neg" : undefined}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

function DucatsWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useDucats();
  const rows = data ?? [];
  const { totalDucats, highDp, top } = useMemo(() => {
    const list = data ?? [];
    return {
      totalDucats: list.reduce((s, r) => s + r.ducats * r.qty, 0),
      highDp: list.filter((r) => (r.ducats_per_plat ?? 0) >= 10).length,
      top: [...list].sort((a, b) => b.ducats * b.qty - a.ducats * a.qty).slice(0, ROW_POOL),
    };
  }, [data]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmtK(totalDucats)}
      unit="d"
      sub={`${fmt(rows.length)} convertible parts`}
      empty={!isLoading && rows.length === 0 ? "Nothing to convert." : undefined}
      cells={[
        { k: "Ducats", v: fmtK(totalDucats) },
        { k: "≥10 d/p", v: fmt(highDp) },
        { k: "Parts", v: fmt(rows.length) },
      ]}
      rows={top.map((r) => (
        <HwRow
          key={r.slug}
          slug={r.slug}
          name={r.display_name}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={`×${r.qty} · ${fmt(r.ducats)}d`}
          right={`${fmt(r.ducats * r.qty)}d`}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

function SetsWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useSets();
  const sets = data ?? [];
  const complete = sets.filter((s) => s.complete).length;
  const oneAway = useMemo(() => oneAwaySets(data ?? []), [data]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={`${fmt(complete)}/${fmt(sets.length)}`}
      sub="sets complete"
      empty={!isLoading && sets.length === 0 ? "No sets tracked." : undefined}
      cells={[
        { k: "Sets", v: fmt(sets.length) },
        { k: "Complete", v: fmt(complete), tone: "pos" },
        { k: "One away", v: fmt(oneAway.length), tone: "hot" },
      ]}
      rows={oneAway.slice(0, ROW_POOL).map((s) => {
        const missing = s.parts.find((p) => !p.owned);
        return (
          <HwRow
            key={s.set_slug}
            slug={missing?.slug}
            name={s.set_name}
            plat={s.set_value}
            sub={missing ? `missing ${missing.part_name}` : "one part away"}
            right={`+${fmt(s.missing_value)}p`}
            onOpen={missing?.slug ? onOpen : undefined}
          />
        );
      })}
    />
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function WatchlistWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useWatchlist();
  const watch = data ?? [];
  const hits = useMemo(() => atTargetWatches(data ?? []), [data]);
  const spend = hits.reduce((s, r) => s + (r.median_plat ?? 0), 0);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(hits.length)}
      bigTone={hits.length > 0 ? "pos" : undefined}
      sub={`at target · ${fmt(watch.length)} watching`}
      empty={!isLoading && watch.length === 0 ? "Watchlist is empty." : undefined}
      cells={[
        { k: "Watching", v: fmt(watch.length) },
        { k: "At target", v: fmt(hits.length), tone: hits.length ? "pos" : undefined },
        { k: "Spend", v: `${fmtK(spend)}p` },
      ]}
      rows={hits
        .slice(0, ROW_POOL)
        .map((r) => (
          <HwRow
            key={r.slug}
            slug={r.slug}
            name={r.display_name}
            plat={r.median_plat}
            thumb={r.thumbnail_url}
            sub={`target ${fmt(r.target_plat)}p`}
            right={`${fmt(r.median_plat)}p`}
            tone="pos"
            onOpen={onOpen}
          />
        ))}
    />
  );
}

function BuyListWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useBuyList();
  const { data: budget } = useBudget();
  const rows = data ?? [];
  const { units, cost, top } = useMemo(() => {
    const list = data ?? [];
    return {
      units: list.reduce((s, r) => s + r.buy_qty, 0),
      cost: list.reduce((s, r) => s + (r.median_plat ?? 0) * r.buy_qty, 0),
      top: [...list]
        .sort((a, b) => (b.median_plat ?? 0) * b.buy_qty - (a.median_plat ?? 0) * a.buy_qty)
        .slice(0, ROW_POOL),
    };
  }, [data]);
  const left = budget == null ? null : budget - cost;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={`${fmtK(cost)}`}
      unit="p"
      sub={`${fmt(rows.length)} items · ${fmt(units)} units`}
      empty={!isLoading && rows.length === 0 ? "Buy list is empty." : undefined}
      cells={[
        { k: "Items", v: fmt(rows.length) },
        { k: "Cost", v: `${fmtK(cost)}p` },
        {
          k: "Budget",
          v: left == null ? "—" : `${fmtK(left)}p`,
          tone: left == null ? undefined : left >= 0 ? "pos" : "neg",
        },
      ]}
      rows={top.map((r) => (
        <HwRow
          key={r.slug}
          slug={r.slug}
          name={r.display_name}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={`×${r.buy_qty} · ${fmt(r.median_plat)}p`}
          right={`${fmt((r.median_plat ?? 0) * r.buy_qty)}p`}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

function ListingsWidget({ w, h, focused, onOpen }: WidgetProps) {
  const listings = useListings();
  const { data: acct } = useWfmAccount();
  const rows = listings.data ?? [];
  const { listed, over } = useMemo(() => {
    const list = listings.data ?? [];
    return {
      listed: list.reduce((s, r) => s + (r.your_price ?? 0) * r.qty, 0),
      over: overMarketListings(list),
    };
  }, [listings.data]);
  const connected = acct?.connected ?? false;
  const empty = !listings.isLoading
    ? !connected
      ? "Connect a warframe.market account."
      : rows.length === 0
        ? "No active listings."
        : undefined
    : undefined;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={listings.isLoading}
      error={listings.isError && !listings.data}
      stale={listings.isError && !!listings.data}
      big={fmt(rows.length)}
      sub={connected ? `${acct?.status ?? "listed"} · ${fmtK(listed)}p listed` : "not connected"}
      empty={empty}
      cells={[
        { k: "Listed", v: `${fmtK(listed)}p` },
        { k: "Over mkt", v: fmt(over.length), tone: over.length ? "neg" : undefined },
        { k: "Status", v: acct?.status ?? "—" },
      ]}
      rows={over
        .slice(0, ROW_POOL)
        .map((l) => (
          <HwRow
            key={l.order_id}
            slug={l.slug}
            name={l.display_name}
            plat={l.your_price}
            thumb={l.thumbnail_url}
            sub={`yours ${fmt(l.your_price)}p · mkt ${fmt(l.market_low)}p`}
            right={`+${fmt(l.your_price! - l.market_low!)}p`}
            tone="neg"
            onOpen={onOpen}
          />
        ))}
    />
  );
}

function SoldWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useSales();
  const sales = data ?? [];
  const { earned7, earned30, units, spark } = useMemo(() => {
    const list = data ?? [];
    return {
      earned7: sumSales(list, 7),
      earned30: sumSales(list, 30),
      units: list.filter((s) => within(s.sold_at, 30)).reduce((acc, s) => acc + s.qty, 0),
      // 30d daily-earnings series — fills the 1×1 tile as a sparkline.
      spark: dailyEarnings(list, 30),
    };
  }, [data]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmtK(earned7)}
      unit="p"
      bigTone={earned7 > 0 ? "pos" : undefined}
      sub="earned · 7d"
      spark={earned30 > 0 ? spark : undefined}
      empty={!isLoading && sales.length === 0 ? "No sales recorded yet." : undefined}
      cells={[
        { k: "7d", v: `${fmtK(earned7)}p`, tone: earned7 ? "pos" : undefined },
        { k: "30d", v: `${fmtK(earned30)}p` },
        { k: "Units", v: fmt(units) },
      ]}
      rows={sales
        .slice(0, ROW_POOL)
        .map((s) => (
          <HwRow
            key={s.id}
            slug={s.slug}
            name={s.display_name}
            plat={s.plat_per_unit}
            thumb={s.thumbnail_url}
            sub={`×${s.qty}`}
            right={`${fmt((s.plat_per_unit ?? 0) * s.qty)}p`}
            tone="pos"
            onOpen={onOpen}
          />
        ))}
    />
  );
}

function MarketPulseWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data: trends, isLoading, isError } = useTrends("30d");
  const up = (trends?.index_change ?? 0) >= 0;
  // Hot movers double as the row list at every size with room for one (1×2 / 2×2).
  const hot = (trends?.unusual ?? []).slice(0, ROW_POOL);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !trends}
      empty={!isLoading && !trends ? "No market data yet." : undefined}
      big={trends ? pct(trends.index_change) : "—"}
      bigTone={up ? "pos" : "neg"}
      spark={trends?.index_spark}
      sub="market index · 30d"
      cells={[
        { k: "Advancing", v: fmt(trends?.advancing), tone: "pos" },
        { k: "Declining", v: fmt(trends?.declining), tone: "neg" },
        { k: "Sell sig", v: fmt(trends?.sell_signal_count) },
      ]}
      rows={hot.map((r) => (
        <HwRow
          key={r.slug}
          slug={r.slug}
          name={r.display_name}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={r.part_type}
          right={pct(r.delta)}
          tone={toneOf(r.delta)}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

function MarketSearchWidget({ h, focused, onOpen }: WidgetProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const query = q.trim();
  const { data = [], isFetching } = useSearchCatalog(query);
  const results = data.slice(0, focused ? ROW_POOL : 6);
  const pick = (slug: string) => {
    onOpen(slug);
    setQ("");
    setActive(0);
  };
  // At 1 row tall there's no room for an inline list — the same results render
  // as a popover anchored under the input, so the widget works at every size.
  const asPopover = h < 2;
  const open = query.length > 0;
  const list = !open ? null : (
    <div
      className={clsx("hw-rows hw-search-res", asPopover && "hw-search-pop", focused && "scroll")}
    >
      {query.length < 2 ? (
        <div className="hw-msg">Type 2+ characters…</div>
      ) : results.length === 0 ? (
        <div className="hw-msg">{isFetching ? "Searching…" : "No items match."}</div>
      ) : (
        results.map((r, i) => (
          <div key={r.slug} className={clsx(i === active && "hw-row-active")}>
            <HwRow
              slug={r.slug}
              name={r.display_name}
              plat={r.median_plat}
              thumb={r.thumbnail_url}
              sub={r.part_type}
              right={r.median_plat == null ? "—" : `${fmt(r.median_plat)}p`}
              onOpen={pick}
            />
          </div>
        ))
      )}
    </div>
  );
  return (
    <div className="hw-b hw-search">
      <div className="hw-search-box">
        <Icon name="search" />
        <input
          placeholder="Search any item…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQ("");
              setActive(0);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              const hit = results[active] ?? results[0];
              if (hit) pick(hit.slug);
            }
          }}
        />
        {asPopover ? list : null}
      </div>
      {!asPopover ? list : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

function RotationWidget({ w, h, focused }: WidgetProps) {
  const { data: ws, isLoading, isError } = useWorldstate();
  const fissures = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0);
  const cascade = liveCascade(ws?.fissures ?? []);
  const baro = ws?.baro;
  const baroIso = baro ? (baro.active ? baro.expiry : baro.activation) : null;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !ws}
      stale={isError && !!ws}
      empty={!isLoading && !isError && !ws ? "Worldstate unavailable." : undefined}
      big={fmt(fissures.length)}
      sub="fissures live"
      cells={[
        { k: "Cascade", v: cascade ? "Live" : "—", tone: cascade ? "pos" : undefined },
        {
          k: baro?.active ? "Baro departs" : "Baro in",
          v: <Countdown iso={baroIso} warnMs={12 * 3_600_000} soonMs={2 * 3_600_000} />,
        },
        { k: "Reset", v: <Countdown iso={nextUtc(0)} /> },
      ]}
    />
  );
}

function ArbitrationWidget({ w, h, focused }: WidgetProps) {
  const { data: ws, isLoading, isError } = useWorldstate();
  const block = ws?.arbitration ?? null;
  const cur = block?.current ?? null;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !ws}
      stale={isError && !!ws}
      big={cur ? (cur.tier ?? "—") : "—"}
      sub={cur ? cur.mission_type : "no live arbitration"}
      empty={!isLoading && !block ? "Schedule unavailable." : undefined}
      cells={
        cur
          ? [
              { k: "Node", v: cur.node },
              { k: "Ends", v: <Countdown iso={cur.expiry} /> },
            ]
          : []
      }
      rows={(block?.notable ?? []).slice(0, ROW_POOL).map((a) => (
        <div className="hw-row hw-row-static" key={a.activation}>
          <span className="hw-row-i">
            <span className="hw-row-n">
              {a.tier ? `${a.tier} · ` : ""}
              {a.node}
            </span>
            <span className="hw-row-s">{a.mission_type}</span>
          </span>
          <span className="hw-row-v">
            <Countdown iso={a.activation} />
          </span>
        </div>
      ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

function AccountWidget({ w, h, focused }: WidgetProps) {
  const { data, isLoading, isError } = useAccountProfile();
  const p = data;
  const nodePct =
    p && p.nodes_total > 0 ? Math.round((p.nodes_completed / p.nodes_total) * 100) : null;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={p?.has_data ? `MR ${fmt(p.mastery_rank)}` : "—"}
      sub={p?.has_data ? `scanned ${syncedAgo(p.scanned_at)} ago` : "scan to populate"}
      empty={!isLoading && !p?.has_data ? "No profile scan yet." : undefined}
      cells={[
        { k: "Platinum", v: fmtK(p?.platinum) },
        { k: "Credits", v: fmtK(p?.credits) },
        { k: "Star chart", v: nodePct == null ? "—" : `${nodePct}%` },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// "Do next" — the action centerpiece, condensed.
// ---------------------------------------------------------------------------

function DoNextWidget({ w, h, focused, onOpen, onNavigate }: WidgetProps) {
  const listings = useListings();
  const watch = useWatchlist();
  const sets = useSets();
  const trends = useTrends("30d");

  const over = useMemo(() => overMarketListings(listings.data ?? []), [listings.data]);
  const hits = useMemo(() => atTargetWatches(watch.data ?? []), [watch.data]);
  const oneAway = useMemo(() => oneAwaySets(sets.data ?? []), [sets.data]);
  const sell = trends.data?.sell_signals ?? [];
  const total = over.length + hits.length + oneAway.length + sell.length;
  const loading = listings.isLoading || watch.isLoading || sets.isLoading || trends.isLoading;

  // A blended, prioritized preview: at-target buys, overpriced listings, near-done sets.
  const rows: React.ReactNode[] = [];
  for (const r of hits.slice(0, 2)) {
    rows.push(
      <HwRow
        key={`h-${r.slug}`}
        slug={r.slug}
        name={r.display_name}
        plat={r.median_plat}
        thumb={r.thumbnail_url}
        sub="at buy target"
        right={`${fmt(r.median_plat)}p`}
        tone="pos"
        onOpen={onOpen}
      />,
    );
  }
  for (const l of over.slice(0, 2)) {
    rows.push(
      <HwRow
        key={`o-${l.order_id}`}
        slug={l.slug}
        name={l.display_name}
        plat={l.your_price}
        thumb={l.thumbnail_url}
        sub="listing over market"
        right={`+${fmt(l.your_price! - l.market_low!)}p`}
        tone="neg"
        onOpen={onOpen}
      />,
    );
  }
  for (const s of oneAway.slice(0, 2)) {
    const missing = s.parts.find((p) => !p.owned);
    rows.push(
      <HwRow
        key={`s-${s.set_slug}`}
        name={s.set_name}
        plat={s.set_value}
        sub={missing ? `need ${missing.part_name}` : "one part away"}
        right={`+${fmt(s.missing_value)}p`}
        onClick={missing?.slug ? () => onOpen(missing.slug) : () => onNavigate("sets")}
      />,
    );
  }

  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={loading}
      big={fmt(total)}
      bigTone={total > 0 ? "hot" : undefined}
      sub={total === 0 ? "all clear" : "actionable now"}
      cells={[
        { k: "At target", v: fmt(hits.length), tone: hits.length ? "pos" : undefined },
        { k: "Over mkt", v: fmt(over.length), tone: over.length ? "neg" : undefined },
        { k: "One away", v: fmt(oneAway.length) },
      ]}
      rows={rows}
    />
  );
}

// ---------------------------------------------------------------------------
// Farm now — wanted items obtainable from a live source this minute.
// ---------------------------------------------------------------------------

function WantedNowWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useWantedNow();
  const rows = data ?? [];
  const soonest = useMemo(
    () =>
      rows
        .filter((r) => r.eta != null && msUntil(r.eta) > 0)
        .sort((a, b) => msUntil(a.eta) - msUntil(b.eta))[0],
    [rows],
  );
  const sources = useMemo(() => new Set(rows.map((r) => r.source_label)).size, [rows]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(rows.length)}
      bigTone={rows.length > 0 ? "pos" : undefined}
      sub="farmable now"
      empty={!isLoading && rows.length === 0 ? "Nothing farmable right now." : undefined}
      cells={[
        { k: "Wanted", v: fmt(rows.length), tone: rows.length ? "pos" : undefined },
        { k: "Sources", v: fmt(sources) },
        { k: "Soonest gone", v: soonest ? <Countdown iso={soonest.eta} /> : "—" },
      ]}
      rows={rows
        .slice(0, ROW_POOL)
        .map((r) => (
          <HwRow
            key={`${r.slug}-${r.source_label}`}
            slug={r.slug}
            name={r.display_name}
            plat={null}
            sub={r.source_label}
            right={r.eta ? <Countdown iso={r.eta} /> : "open"}
            onOpen={onOpen}
          />
        ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Alerts — the notification center, previewed.
// ---------------------------------------------------------------------------

function AlertsWidget({ w, h, focused, onOpen, onNavigate }: WidgetProps) {
  const { data, isLoading, isError } = useNotifications();
  const items = useMemo(
    () =>
      [...(data ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [data],
  );
  const unread = items.filter((n) => n.read_at == null).length;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(unread)}
      bigTone={unread > 0 ? "hot" : undefined}
      sub="unread alerts"
      empty={!isLoading && items.length === 0 ? "No alerts." : undefined}
      cells={[
        { k: "Unread", v: fmt(unread), tone: unread ? "hot" : undefined },
        { k: "Total", v: fmt(items.length) },
        { k: "Latest", v: items[0] ? `${syncedAgo(items[0].created_at)} ago` : "—" },
      ]}
      rows={items
        .slice(0, ROW_POOL)
        .map((n) => (
          <HwRow
            key={n.id}
            name={n.title}
            plat={null}
            sub={n.body}
            right={syncedAgo(n.created_at)}
            tone={n.read_at == null ? "hot" : undefined}
            onClick={
              n.nav_slug
                ? () => onOpen(n.nav_slug as string)
                : n.nav_screen
                  ? () => onNavigate(n.nav_screen as ScreenId)
                  : undefined
            }
          />
        ))}
    />
  );
}

// ---------------------------------------------------------------------------
// List next — what's worth putting on the market.
// ---------------------------------------------------------------------------

function ListNextWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useListingRecommendations();
  const recs = data ?? [];
  const estValue = useMemo(() => recs.reduce((s, r) => s + r.est_value, 0), [recs]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(recs.length)}
      sub="worth listing"
      empty={!isLoading && recs.length === 0 ? "Nothing worth listing." : undefined}
      cells={[
        { k: "Candidates", v: fmt(recs.length) },
        { k: "Top price", v: recs[0] ? `${fmt(recs[0].suggested_price)}p` : "—" },
        { k: "Est value", v: `${fmtK(estValue)}p` },
      ]}
      rows={recs
        .slice(0, ROW_POOL)
        .map((r) => (
          <HwRow
            key={r.slug}
            slug={r.slug}
            name={r.display_name}
            plat={r.median_plat}
            thumb={r.thumbnail_url}
            sub={`vol ${r.avg_daily_volume.toFixed(1)}/d`}
            right={`${fmt(r.suggested_price)}p`}
            onOpen={onOpen}
          />
        ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Vendor picks — notable stock you don't own yet, from whoever is in town.
// ---------------------------------------------------------------------------

const VENDOR_CUR: Record<string, string> = {
  ducats: "ducats",
  aya: "aya",
  regal_aya: "regal aya",
  steel_essence: "essence",
  cred: "creds",
};

function VendorPicksWidget({ w, h, focused, onOpen }: WidgetProps) {
  const { data, isLoading, isError } = useVendorBoard();
  const { data: watch } = useWatchlist();
  const { data: buy } = useBuyList();
  const active = useMemo(() => (data ?? []).filter((p) => p.active), [data]);
  const picks = useMemo(() => {
    const wanted = new Set([
      ...(watch ?? []).map((r) => r.slug),
      ...(buy ?? []).map((r) => r.slug),
    ]);
    return active
      .flatMap((p) =>
        p.rows
          .filter((r) => !r.checked && (r.median_plat ?? 0) > 0)
          .map((r) => ({ ...r, vendor: p.name })),
      )
      .sort(
        (a, b) =>
          Number(b.slug != null && wanted.has(b.slug)) -
            Number(a.slug != null && wanted.has(a.slug)) ||
          (b.median_plat ?? 0) - (a.median_plat ?? 0),
      )
      .slice(0, ROW_POOL);
  }, [active, watch, buy]);
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(picks.length)}
      sub={active.length ? active.map((p) => p.name).join(" · ") : "no vendors in town"}
      empty={
        !isLoading
          ? active.length === 0
            ? "No vendors are active right now."
            : picks.length === 0
              ? "Nothing notable in stock."
              : undefined
          : undefined
      }
      cells={active.slice(0, 4).map((p) => ({
        k: p.name,
        v: fmt(p.rows.filter((r) => !r.checked && (r.median_plat ?? 0) > 0).length),
      }))}
      rows={picks.map((r) => (
        <HwRow
          key={`${r.vendor}-${r.item_ref}`}
          slug={r.tradeable ? r.slug : null}
          name={r.item}
          plat={r.median_plat}
          thumb={r.thumbnail_url}
          sub={`${r.vendor} · ${r.cost != null ? fmt(r.cost) : "—"} ${VENDOR_CUR[r.currency] ?? ""}`}
          right={`${fmt(r.median_plat)}p`}
          onOpen={onOpen}
        />
      ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Category heat — which market segments are moving.
// ---------------------------------------------------------------------------

function CategoryHeatWidget({ w, h, focused }: WidgetProps) {
  const { data: trends, isLoading, isError } = useTrends("30d");
  const heat = useMemo(
    () =>
      [...(trends?.category_heat ?? [])].sort(
        (a, b) => Math.abs(b.avg_delta) - Math.abs(a.avg_delta),
      ),
    [trends?.category_heat],
  );
  const lead = heat[0];
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !trends}
      big={lead ? lead.category : "—"}
      bigTone={toneOf(lead?.avg_delta)}
      delta={lead?.avg_delta}
      sub="strongest category · 30d"
      empty={!isLoading && heat.length === 0 ? "No market data yet." : undefined}
      cells={heat.slice(0, 4).map((c) => ({
        k: c.category,
        v: pct(c.avg_delta),
        tone: toneOf(c.avg_delta),
      }))}
      rows={heat.map((c) => (
        <HwRow
          key={c.category}
          name={c.category}
          plat={null}
          sub={`${fmt(c.count)} items`}
          right={pct(c.avg_delta)}
          tone={toneOf(c.avg_delta)}
        />
      ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Riven watches — saved searches the background watcher is holding for you.
// ---------------------------------------------------------------------------

function RivenWatchesWidget({ w, h, focused, onNavigate }: WidgetProps) {
  const { data, isLoading, isError } = useRivenSearches();
  const searches = useMemo(
    () => [...(data ?? [])].sort((a, b) => Number(b.notify) - Number(a.notify)),
    [data],
  );
  const watching = searches.filter((s) => s.notify).length;
  return (
    <WidgetBody
      w={w}
      h={h}
      focused={focused}
      loading={isLoading}
      error={isError && !data}
      big={fmt(watching)}
      bigTone={watching > 0 ? "pos" : undefined}
      sub="riven watches"
      empty={!isLoading && searches.length === 0 ? "No saved riven searches." : undefined}
      cells={[
        { k: "Watching", v: fmt(watching), tone: watching ? "pos" : undefined },
        { k: "Saved", v: fmt(searches.length) },
      ]}
      rows={searches
        .slice(0, ROW_POOL)
        .map((s) => (
          <HwRow
            key={s.id}
            name={s.label}
            plat={null}
            sub={s.weapon}
            right={s.notify ? "watching" : "saved"}
            tone={s.notify ? "pos" : undefined}
            onClick={() => onNavigate("rivens")}
          />
        ))}
    />
  );
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const WIDGETS: WidgetDef[] = [
  {
    key: "do-next",
    title: "Do next",
    icon: "rows",
    group: "Overview",
    default: { w: 2, h: 2 },
    min: { w: 2, h: 1 },
    Render: DoNextWidget,
  },
  {
    key: "inventory",
    title: "Portfolio",
    icon: "inventory",
    screen: "inventory",
    group: "Overview",
    default: { w: 2, h: 2 },
    Render: InventoryWidget,
  },
  {
    key: "movers",
    title: "Your movers",
    icon: "trends",
    screen: "inventory",
    group: "Overview",
    default: { w: 2, h: 2 },
    Render: MoversWidget,
  },
  {
    key: "sold",
    title: "Sold",
    icon: "sold",
    screen: "sold",
    group: "Overview",
    default: { w: 1, h: 1 },
    Render: SoldWidget,
  },
  {
    key: "sets",
    title: "Sets",
    icon: "sets",
    screen: "sets",
    group: "Portfolio",
    default: { w: 1, h: 2 },
    Render: SetsWidget,
  },
  {
    key: "relics",
    title: "Relics",
    icon: "box",
    screen: "relics",
    group: "Portfolio",
    default: { w: 1, h: 2 },
    Render: RelicsWidget,
  },
  {
    key: "arcanes",
    title: "Arcanes",
    icon: "arcane",
    screen: "arcanes",
    group: "Portfolio",
    default: { w: 1, h: 1 },
    Render: ArcanesWidget,
  },
  {
    key: "ducats",
    title: "Ducats",
    icon: "coin",
    screen: "ducats",
    group: "Portfolio",
    default: { w: 1, h: 1 },
    Render: DucatsWidget,
  },
  {
    key: "watchlist",
    title: "Watchlist",
    icon: "watchlist",
    screen: "watchlist",
    group: "Planning",
    default: { w: 1, h: 2 },
    Render: WatchlistWidget,
  },
  {
    key: "buy",
    title: "Buy list",
    icon: "buy",
    screen: "buy",
    group: "Planning",
    default: { w: 1, h: 1 },
    Render: BuyListWidget,
  },
  {
    key: "listings",
    title: "Listings",
    icon: "tag",
    screen: "listings",
    group: "Trading",
    default: { w: 2, h: 2 },
    Render: ListingsWidget,
  },
  {
    key: "market-pulse",
    title: "Market",
    icon: "trends",
    screen: "trends",
    group: "Trading",
    default: { w: 2, h: 2 },
    Render: MarketPulseWidget,
  },
  {
    key: "market-search",
    title: "Market search",
    icon: "search",
    screen: "market",
    group: "Trading",
    default: { w: 2, h: 2 },
    min: { w: 2, h: 1 },
    Render: MarketSearchWidget,
  },
  {
    key: "rotation",
    title: "World state",
    icon: "timer",
    screen: "rotation",
    group: "World",
    default: { w: 2, h: 1 },
    Render: RotationWidget,
  },
  {
    key: "arbitration",
    title: "Arbitration",
    icon: "timer",
    screen: "rotation",
    group: "World",
    default: { w: 1, h: 2 },
    Render: ArbitrationWidget,
  },
  {
    key: "account",
    title: "Account",
    icon: "user",
    screen: "account",
    group: "Overview",
    default: { w: 1, h: 1 },
    Render: AccountWidget,
  },
  {
    key: "alerts",
    title: "Alerts",
    icon: "bell",
    group: "Overview",
    default: { w: 1, h: 2 },
    Render: AlertsWidget,
  },
  {
    key: "wanted-now",
    title: "Farm now",
    icon: "timer",
    screen: "rotation",
    group: "Planning",
    default: { w: 1, h: 2 },
    Render: WantedNowWidget,
  },
  {
    key: "list-next",
    title: "List next",
    icon: "tag",
    screen: "listings",
    group: "Trading",
    default: { w: 1, h: 2 },
    Render: ListNextWidget,
  },
  {
    key: "vendor-picks",
    title: "Vendor picks",
    icon: "coin",
    screen: "vendors",
    group: "World",
    default: { w: 1, h: 2 },
    Render: VendorPicksWidget,
  },
  {
    key: "category-heat",
    title: "Category heat",
    icon: "chips",
    screen: "trends",
    group: "Trading",
    default: { w: 2, h: 1 },
    min: { w: 2, h: 1 },
    Render: CategoryHeatWidget,
  },
  {
    key: "riven-watches",
    title: "Riven watches",
    icon: "bookmark",
    screen: "rivens",
    group: "Trading",
    default: { w: 1, h: 1 },
    Render: RivenWatchesWidget,
  },
];

export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((d) => [d.key, d]),
);

/** The seed layout for a never-customized home screen. Freeform x/y placement
 *  on a 4-column grid (each cell 150px tall): tiles live where they're put —
 *  gaps are allowed; dropping onto a tile pushes overlapped tiles down. */
export const DEFAULT_LAYOUT = [
  { key: "do-next", x: 0, y: 0, w: 2, h: 2 },
  { key: "movers", x: 2, y: 0, w: 2, h: 2 },
  { key: "market-pulse", x: 0, y: 2, w: 2, h: 2 },
  { key: "arbitration", x: 2, y: 2, w: 2, h: 2 },
  { key: "market-search", x: 0, y: 4, w: 2, h: 2 },
];
