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
  useListings,
  useRelics,
  useSales,
  useSearchCatalog,
  useSets,
  useSummary,
  useTrends,
  useWatchlist,
  useWfmAccount,
  useWorldstate,
} from "../../hooks/queries";
import { atTarget, clsx, fmt, fmtK, msUntil, nextUtc, pct, syncedAgo } from "../../lib/format";
import { Countdown } from "../Countdown";
import { Icon } from "../Icon";
import type { ScreenId } from "../Sidebar";
import { MiniArea } from "../charts";
import { Glyph } from "../ui";

export type Nav = (s: ScreenId, opts?: { listingsTab?: "mine" | "recommended" }) => void;

export interface WidgetProps {
  w: number;
  h: number;
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
  big,
  unit,
  bigTone,
  delta,
  spark,
  sub,
  cells,
  rows,
  loading,
  empty,
}: {
  w: number;
  h: number;
  big: React.ReactNode;
  unit?: string;
  bigTone?: string;
  delta?: number | null;
  spark?: number[];
  sub?: React.ReactNode;
  cells?: Cell[];
  rows?: React.ReactNode[];
  loading?: boolean;
  empty?: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="hw-b">
        <div className="hw-msg">Loading…</div>
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
    <div className={clsx("hw-b", solo && "solo")}>
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
      {showRows ? <div className="hw-rows">{rows!.slice(0, rowLimit)}</div> : null}
    </div>
  );
}

/** One preview row: tier glyph + name (+ sub) and a right-aligned value. Opens
 *  the item drawer. */
function HwRow({
  slug,
  name,
  plat,
  thumb,
  sub,
  right,
  tone,
  onOpen,
}: {
  slug: string;
  name: string;
  plat: number | null | undefined;
  thumb?: string | null;
  sub?: React.ReactNode;
  right: React.ReactNode;
  tone?: string;
  onOpen: (slug: string) => void;
}) {
  return (
    <button type="button" className="hw-row" onClick={() => onOpen(slug)}>
      <Glyph name={name} plat={plat} thumb={thumb} />
      <span className="hw-row-i">
        <span className="hw-row-n">{name}</span>
        {sub != null ? <span className="hw-row-s">{sub}</span> : null}
      </span>
      <span className={clsx("hw-row-v", tone)}>{right}</span>
    </button>
  );
}

const toneOf = (n: number | null | undefined) => (n == null ? undefined : n >= 0 ? "pos" : "neg");
const within = (iso: string, days: number) =>
  Date.now() - new Date(iso).getTime() <= days * 86_400_000;

// ---------------------------------------------------------------------------
// Portfolio / inventory
// ---------------------------------------------------------------------------

function InventoryWidget({ w, h, onOpen }: WidgetProps) {
  const { data: summary } = useSummary();
  const inv = useInventory();
  const top = useMemo(
    () =>
      (inv.data ?? [])
        .filter((r) => !r.excluded && (r.realizable_plat ?? 0) > 0)
        .sort((a, b) => (b.realizable_plat ?? 0) - (a.realizable_plat ?? 0))
        .slice(0, 6),
    [inv.data],
  );
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={!summary}
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

function MoversWidget({ w, h, onOpen }: WidgetProps) {
  const inv = useInventory();
  const movers = useMemo(
    () =>
      (inv.data ?? [])
        .filter(
          (r) =>
            r.delta_7d != null && !r.excluded && (r.realizable_plat ?? r.median_plat ?? 0) >= 10,
        )
        .sort((a, b) => Math.abs(b.delta_7d!) - Math.abs(a.delta_7d!))
        .slice(0, 6),
    [inv.data],
  );
  const up = movers.filter((r) => (r.delta_7d ?? 0) >= 0).length;
  const lead = movers[0];
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={inv.isLoading}
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

function RelicsWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useRelics();
  const relics = data ?? [];
  const totalEv = relics.reduce((s, r) => s + r.ev_plat * r.qty, 0);
  const totalQty = relics.reduce((s, r) => s + r.qty, 0);
  const top = [...relics].sort((a, b) => b.ev_plat - a.ev_plat).slice(0, 6);
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
      big={`~${fmtK(totalEv)}`}
      unit="p"
      sub={`${fmt(totalQty)} relics · expected`}
      empty={!isLoading && relics.length === 0 ? "No relics tracked yet." : undefined}
      cells={[
        { k: "Relics", v: fmt(totalQty) },
        { k: "Distinct", v: fmt(relics.length) },
        { k: "Best", v: `${fmt(top[0]?.ev_plat)}p` },
      ]}
      rows={top.map((r) => (
        <HwRow
          key={`${r.tier}-${r.relic_name}-${r.refinement}`}
          slug=""
          name={r.display_name}
          plat={r.ev_plat}
          sub={`×${r.qty} · ${r.refinement}`}
          right={`${fmt(r.ev_plat)}p`}
          onOpen={() => {}}
        />
      ))}
    />
  );
}

function ArcanesWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useArcaneDashboard();
  const s = data?.summary;
  const owned = data?.owned ?? [];
  const dissolve = owned.filter((a) => a.verdict === "dissolve").length;
  const top = [...owned].sort((a, b) => (b.plat ?? 0) - (a.plat ?? 0)).slice(0, 6);
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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

function DucatsWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useDucats();
  const rows = data ?? [];
  const totalDucats = rows.reduce((s, r) => s + r.ducats * r.qty, 0);
  const highDp = rows.filter((r) => (r.ducats_per_plat ?? 0) >= 10).length;
  const top = [...rows].sort((a, b) => b.ducats * b.qty - a.ducats * a.qty).slice(0, 6);
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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

function SetsWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useSets();
  const sets = data ?? [];
  const complete = sets.filter((s) => s.complete).length;
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
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
      big={`${fmt(complete)}/${fmt(sets.length)}`}
      sub="sets complete"
      empty={!isLoading && sets.length === 0 ? "No sets tracked." : undefined}
      cells={[
        { k: "Sets", v: fmt(sets.length) },
        { k: "Complete", v: fmt(complete), tone: "pos" },
        { k: "One away", v: fmt(oneAway.length), tone: "hot" },
      ]}
      rows={oneAway.slice(0, 6).map((s) => {
        const missing = s.parts.find((p) => !p.owned);
        return (
          <HwRow
            key={s.set_slug}
            slug={missing?.slug ?? ""}
            name={s.set_name}
            plat={s.set_value}
            sub={missing ? `missing ${missing.part_name}` : "one part away"}
            right={`+${fmt(s.missing_value)}p`}
            onOpen={onOpen}
          />
        );
      })}
    />
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function WatchlistWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useWatchlist();
  const watch = data ?? [];
  const hits = useMemo(
    () =>
      watch
        .filter(atTarget)
        .sort((a, b) => b.target_plat! - b.median_plat! - (a.target_plat! - a.median_plat!)),
    [watch],
  );
  const spend = hits.reduce((s, r) => s + (r.median_plat ?? 0), 0);
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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
        .slice(0, 6)
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

function BuyListWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useBuyList();
  const { data: budget } = useBudget();
  const rows = data ?? [];
  const units = rows.reduce((s, r) => s + r.buy_qty, 0);
  const cost = rows.reduce((s, r) => s + (r.median_plat ?? 0) * r.buy_qty, 0);
  const left = budget == null ? null : budget - cost;
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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
      rows={[...rows]
        .sort((a, b) => (b.median_plat ?? 0) * b.buy_qty - (a.median_plat ?? 0) * a.buy_qty)
        .slice(0, 6)
        .map((r) => (
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

function ListingsWidget({ w, h, onOpen }: WidgetProps) {
  const listings = useListings();
  const { data: acct } = useWfmAccount();
  const rows = listings.data ?? [];
  const listed = rows.reduce((s, r) => s + (r.your_price ?? 0) * r.qty, 0);
  const over = useMemo(
    () =>
      rows
        .filter((l) => l.your_price != null && l.market_low != null && l.your_price > l.market_low)
        .sort((a, b) => b.your_price! - b.market_low! - (a.your_price! - a.market_low!)),
    [rows],
  );
  const connected = acct?.connected ?? false;
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={listings.isLoading}
      big={fmt(rows.length)}
      sub={connected ? `${acct?.status ?? "listed"} · ${fmtK(listed)}p listed` : "not connected"}
      empty={!listings.isLoading && !connected ? "Connect a warframe.market account." : undefined}
      cells={[
        { k: "Listed", v: `${fmtK(listed)}p` },
        { k: "Over mkt", v: fmt(over.length), tone: over.length ? "neg" : undefined },
        { k: "Status", v: acct?.status ?? "—" },
      ]}
      rows={over
        .slice(0, 6)
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

function SoldWidget({ w, h, onOpen }: WidgetProps) {
  const { data, isLoading } = useSales();
  const sales = data ?? [];
  const sum = (days: number) =>
    sales
      .filter((s) => within(s.sold_at, days))
      .reduce((acc, s) => acc + (s.plat_per_unit ?? 0) * s.qty, 0);
  const earned7 = sum(7);
  const earned30 = sum(30);
  const units = sales.filter((s) => within(s.sold_at, 30)).reduce((acc, s) => acc + s.qty, 0);
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
      big={fmtK(earned7)}
      unit="p"
      bigTone={earned7 > 0 ? "pos" : undefined}
      sub="earned · 7d"
      empty={!isLoading && sales.length === 0 ? "No sales recorded yet." : undefined}
      cells={[
        { k: "7d", v: `${fmtK(earned7)}p`, tone: earned7 ? "pos" : undefined },
        { k: "30d", v: `${fmtK(earned30)}p` },
        { k: "Units", v: fmt(units) },
      ]}
      rows={sales
        .slice(0, 6)
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

function MarketPulseWidget({ w, h, onOpen }: WidgetProps) {
  const { data: trends, isLoading } = useTrends("30d");
  const up = (trends?.index_change ?? 0) >= 0;
  const spark = trends?.index_spark ?? [];
  const hot = (trends?.unusual ?? []).slice(0, 6);
  if (isLoading) {
    return (
      <div className="hw-b">
        <div className="hw-msg">Loading…</div>
      </div>
    );
  }
  return (
    <div className="hw-b">
      <div className="hw-head">
        <div className={clsx("hw-big", up ? "pos" : "neg")}>
          {trends ? pct(trends.index_change) : "—"}
        </div>
        <div className="hw-sub">market index · 30d</div>
      </div>
      {h >= 2 && spark.length >= 2 ? (
        <div className="hw-area">
          <MiniArea data={spark} w={260} h={48} accent={up ? "var(--pos)" : "var(--neg)"} />
        </div>
      ) : null}
      {w >= 2 ? (
        <div className="hw-cells">
          <div className="hw-cell">
            <div className="hw-cv pos">{fmt(trends?.advancing)}</div>
            <div className="hw-ck">Advancing</div>
          </div>
          <div className="hw-cell">
            <div className="hw-cv neg">{fmt(trends?.declining)}</div>
            <div className="hw-ck">Declining</div>
          </div>
          <div className="hw-cell">
            <div className="hw-cv">{fmt(trends?.sell_signal_count)}</div>
            <div className="hw-ck">Sell sig</div>
          </div>
        </div>
      ) : null}
      {w >= 2 && h >= 2 && hot.length ? (
        <div className="hw-rows">
          {hot.map((r) => (
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
        </div>
      ) : null}
    </div>
  );
}

function MarketSearchWidget({ h, onOpen }: WidgetProps) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const { data = [], isFetching } = useSearchCatalog(query);
  return (
    <div className="hw-b hw-search">
      <div className="hw-search-box">
        <Icon name="search" />
        <input
          placeholder="Search any item…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQ("");
          }}
        />
      </div>
      {query.length >= 2 && h >= 2 ? (
        <div className="hw-rows hw-search-res">
          {data.length === 0 ? (
            <div className="hw-msg">{isFetching ? "Searching…" : "No items match."}</div>
          ) : (
            data.slice(0, 6).map((r) => (
              <HwRow
                key={r.slug}
                slug={r.slug}
                name={r.display_name}
                plat={r.median_plat}
                thumb={r.thumbnail_url}
                sub={r.part_type}
                right={r.median_plat == null ? "—" : `${fmt(r.median_plat)}p`}
                onOpen={(s) => {
                  onOpen(s);
                  setQ("");
                }}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

function RotationWidget({ w, h }: WidgetProps) {
  const { data: ws, isLoading } = useWorldstate();
  const fissures = (ws?.fissures ?? []).filter((f) => msUntil(f.expiry) > 0);
  const cascade = fissures
    .filter((f) => /cascade/i.test(f.mission_type))
    .sort((a, b) => msUntil(b.expiry) - msUntil(a.expiry))[0];
  const baro = ws?.baro;
  const baroIso = baro ? (baro.active ? baro.expiry : baro.activation) : null;
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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

function ArbitrationWidget({ w, h }: WidgetProps) {
  const { data: ws, isLoading } = useWorldstate();
  const block = ws?.arbitration ?? null;
  const cur = block?.current ?? null;
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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
      rows={(block?.notable ?? []).slice(0, 6).map((a) => (
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

function AccountWidget({ w, h }: WidgetProps) {
  const { data, isLoading } = useAccountProfile();
  const p = data;
  const nodePct =
    p && p.nodes_total > 0 ? Math.round((p.nodes_completed / p.nodes_total) * 100) : null;
  return (
    <WidgetBody
      w={w}
      h={h}
      loading={isLoading}
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

function DoNextWidget({ w, h, onOpen, onNavigate }: WidgetProps) {
  const listings = useListings();
  const watch = useWatchlist();
  const sets = useSets();
  const trends = useTrends("30d");

  const over = useMemo(
    () =>
      (listings.data ?? []).filter(
        (l) => l.your_price != null && l.market_low != null && l.your_price > l.market_low,
      ),
    [listings.data],
  );
  const hits = useMemo(() => (watch.data ?? []).filter(atTarget), [watch.data]);
  const oneAway = useMemo(
    () => (sets.data ?? []).filter((s) => !s.complete && s.total_parts - s.owned_parts === 1),
    [sets.data],
  );
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
        slug={missing?.slug ?? ""}
        name={s.set_name}
        plat={s.set_value}
        sub={missing ? `need ${missing.part_name}` : "one part away"}
        right={`+${fmt(s.missing_value)}p`}
        onOpen={(slug) => (slug ? onOpen(slug) : onNavigate("sets"))}
      />,
    );
  }

  return (
    <WidgetBody
      w={w}
      h={h}
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
    default: { w: 1, h: 1 },
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
];

export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((d) => [d.key, d]),
);

/** The seed layout for a never-customized home screen: the five reworked
 *  panels, uniform 2×2, flowing two per row. Order-based (no x/y) — the grid
 *  flows tiles across and fills gaps automatically. */
// Freeform x/y placement on a 4-column grid (each cell 150px tall). Tiles live
// where they're put — gaps are allowed; dropping onto a tile pushes it down.
export const DEFAULT_LAYOUT = [
  { key: "do-next", x: 0, y: 0, w: 2, h: 2 },
  { key: "movers", x: 2, y: 0, w: 2, h: 2 },
  { key: "market-pulse", x: 0, y: 2, w: 2, h: 2 },
  { key: "arbitration", x: 2, y: 2, w: 2, h: 2 },
  { key: "market-search", x: 0, y: 4, w: 2, h: 2 },
];
