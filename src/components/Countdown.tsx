// Shared live-countdown machinery (extracted from Rotation): one 1s interval
// drives every timer on screen, and each Countdown leaf re-renders itself in
// isolation — never the panel/table around it.
import { memo, useEffect, useState } from "react";
import { clsx, countdown } from "../lib/format";

// One shared 1s interval drives every live countdown; leaves subscribe so only
// the timer cells re-render each second — not the whole fissure table + summary.
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
export function subscribeTick(fn: () => void): () => void {
  tickListeners.add(fn);
  if (tickTimer === undefined) {
    tickTimer = setInterval(() => {
      for (const l of tickListeners) l();
    }, 1000);
  }
  return () => {
    tickListeners.delete(fn);
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}

/** A self-ticking countdown leaf — re-renders itself each second, in isolation.
 *  Recolors as it crosses thresholds: ink → --hot (warn) → --neg (soon).
 *  Hero/vendor timers pass larger (hours-scale) thresholds. */
export const Countdown = memo(function Countdown({
  iso,
  fallback = "—",
  warnMs = 5 * 60_000,
  soonMs = 90_000,
}: {
  iso: string | null | undefined;
  fallback?: string;
  warnMs?: number;
  soonMs?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeTick(() => setNow(Date.now())), []);
  if (!iso) return <>{fallback}</>;
  const ms = new Date(iso).getTime() - now;
  const cls = ms > 0 && ms <= soonMs ? "cd-soon" : ms > 0 && ms <= warnMs ? "cd-warn" : null;
  const text = countdown(iso, now);
  return cls ? <span className={cls}>{text}</span> : <>{text}</>;
});

/** Community S–D arbitration rating (browse.wf / Arbitration Goons) as a grade box. */
export function TierBadge({ tier }: { tier: string | null }) {
  return (
    <span className={clsx("tierb", tier && `t-${tier.toLowerCase()}`)} title="community rating">
      {tier ?? "—"}
    </span>
  );
}
