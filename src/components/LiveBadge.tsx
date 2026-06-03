import { useEffect, useState } from "react";
import { usePricingProgress } from "../hooks/queries";
import { clsx } from "../lib/format";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/**
 * Topbar liveness indicator: a dot + "how fresh is the newest data" readout,
 * ticking every second. Fed by `last_price_sync`, which the backend stamps on
 * every launch-drain batch, manual refresh, and live-heartbeat tick — so under
 * normal operation this hovers under a minute and visibly resets as the
 * heartbeat lands new prices. Green = fresh, dims once nothing has arrived
 * for a few minutes (e.g. offline).
 */
export function LiveBadge() {
  const { data: progress } = usePricingProgress();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const last = progress?.last_price_sync;
  if (!last) return null;
  const stale = now - Date.parse(last) > 5 * 60_000; // heartbeat ticks every 45s
  return (
    <span className={clsx("live-badge", stale && "stale")} title="Newest market data age">
      <span className="live-dot" />
      <span className="num">{ago(last, now)}</span>
    </span>
  );
}
