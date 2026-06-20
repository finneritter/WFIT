// Dashboard — the action-first overview. The top stays fixed (the .fwx portfolio
// hero + .rsetbar world strip); the lower half is a user-customizable widget grid
// (HomeWidgetGrid) — add/remove/move/resize tiles, each a glanceable preview of a
// screen. Layout persists in localStorage.
import { Countdown } from "../components/Countdown";
import type { ScreenId } from "../components/Sidebar";
import { HomeWidgetGrid } from "../components/home/HomeWidgetGrid";
import { useSummary, useTrends, useWorldstate } from "../hooks/queries";
import { clsx, fmt, fmtK, msUntil, nextUtc, pct, syncedAgo } from "../lib/format";
import type { Summary, TrendsData, Worldstate } from "../lib/types";

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
  const { data: trends } = useTrends("30d");

  return (
    <>
      <PortfolioHero summary={summary} trends={trends} />
      <WorldStrip ws={ws} lastSynced={summary?.last_synced} onNavigate={onNavigate} />
      <HomeWidgetGrid onOpen={onOpen} onNavigate={onNavigate} />
    </>
  );
}
