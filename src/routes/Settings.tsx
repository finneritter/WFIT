import { useEffect, useState } from "react";
import { GameScanPanel } from "../components/GameScanPanel";
import type { ScreenId } from "../components/Sidebar";
import {
  useCatalogRefresh,
  useExcludedMinPlat,
  useExcludedRarities,
  usePricesRefresh,
  useRebuildCache,
  useSetExcludedMinPlat,
  useSetExcludedRarities,
  useSetsRefresh,
  useSummary,
  useWfmAccount,
} from "../hooks/queries";
import { wipeApp } from "../lib/api";
import { syncedAgo } from "../lib/format";
import { type Prefs, type Theme, loadPrefs, savePrefs } from "../lib/prefs";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-l">
        <div className="set-k">{label}</div>
        <div className="set-h">{hint}</div>
      </div>
      <div className="set-c">{children}</div>
    </div>
  );
}

function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          className="chip"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// Dev-only factory reset, behind a two-step confirm (the spec wants warning screens).
function DangerZone() {
  const [armed, setArmed] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [wiping, setWiping] = useState(false);
  const doWipe = async () => {
    setWiping(true);
    try {
      await wipeApp(); // erases everything + restarts the app; this call won't resolve
    } catch {
      setWiping(false);
    }
  };
  if (!armed) {
    return (
      <Row
        label="Wipe all app data"
        hint="Factory reset: erase inventory, sales, watchlist, settings and every cache, then restart as a fresh install. To test the new-user experience. Cannot be undone."
      >
        <button type="button" className="btn warn" onClick={() => setArmed(true)}>
          Wipe…
        </button>
      </Row>
    );
  }
  return (
    <div className="wipe-confirm">
      <div className="wipe-warn">
        ⚠ This permanently erases <b>everything</b> — your whole inventory, sales history,
        watchlist, buy list, settings, and all cached prices — and restarts the app empty. There is
        no undo.
      </div>
      <div className="wipe-act">
        <input
          type="text"
          placeholder="type ERASE to confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn warn"
          disabled={confirm !== "ERASE" || wiping}
          onClick={doWipe}
        >
          {wiping ? "Erasing…" : "Erase everything & restart"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={wiping}
          onClick={() => {
            setArmed(false);
            setConfirm("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Settings({ onNavigate }: { onNavigate: (id: ScreenId) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const { data: summary } = useSummary();
  const { data: account } = useWfmAccount();
  const prices = usePricesRefresh();
  const catalog = useCatalogRefresh();
  const sets = useSetsRefresh();
  const rebuild = useRebuildCache();
  const { data: excluded = [] } = useExcludedRarities();
  const setExcluded = useSetExcludedRarities();
  const { data: excludedMinPlat = 0 } = useExcludedMinPlat();
  const setExcludedMin = useSetExcludedMinPlat();
  const [minInput, setMinInput] = useState("");
  useEffect(() => {
    setMinInput(excludedMinPlat ? String(excludedMinPlat) : "");
  }, [excludedMinPlat]);
  const [dev, setDevState] = useState(() => {
    try {
      return localStorage.getItem("wfit-dev") === "1";
    } catch {
      return false;
    }
  });
  const setDev = (v: boolean) => {
    setDevState(v);
    try {
      localStorage.setItem("wfit-dev", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const toggleRarity = (r: string) =>
    setExcluded.mutate(excluded.includes(r) ? excluded.filter((x) => x !== r) : [...excluded, r]);
  const commitMinPlat = () => {
    const n = Math.max(0, Math.round(Number(minInput) || 0));
    if (n !== excludedMinPlat) setExcludedMin.mutate(n);
  };

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  };

  const busy = prices.isPending || catalog.isPending || sets.isPending || rebuild.isPending;

  return (
    <div className="settings">
      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Appearance</h3>
        </div>
        <Row label="Theme" hint="Light or dark palette — applies instantly, remembered next launch">
          <Seg
            value={prefs.theme}
            options={[
              ["dark", "Dark"],
              ["light", "Light"],
            ]}
            onChange={(v) => update({ theme: v as Theme })}
          />
        </Row>
        <Row label="Density" hint="Tile size in the inventory grid">
          <Seg
            value={prefs.dense ? "dense" : "comfy"}
            options={[
              ["comfy", "Comfortable"],
              ["dense", "Dense"],
            ]}
            onChange={(v) => update({ dense: v === "dense" })}
          />
        </Row>
        <Row label="Price deltas" hint="Color gains/losses green & red, or keep them flat mono">
          <Seg
            value={prefs.flatDeltas ? "flat" : "color"}
            options={[
              ["color", "Colored"],
              ["flat", "Flat"],
            ]}
            onChange={(v) => update({ flatDeltas: v === "flat" })}
          />
        </Row>
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Portfolio valuation</h3>
          {excluded.length > 0 ? (
            <span className="meta">{excluded.length} rarity excluded</span>
          ) : null}
        </div>
        <Row
          label="Exclude mod rarities"
          hint="Tap a rarity to drop those mods from your portfolio plat — your Realizable total, summary and Trends. They still show in your inventory, dimmed. (warframe.market exposes no rarity; these come from a bundled dataset.)"
        >
          <div className="seg">
            {(
              [
                ["common", "Common"],
                ["uncommon", "Uncommon"],
                ["rare", "Rare"],
                ["legendary", "Legendary"],
              ] as [string, string][]
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                className="chip"
                aria-pressed={excluded.includes(v)}
                onClick={() => toggleRarity(v)}
                title={
                  excluded.includes(v)
                    ? "Excluded — tap to count again"
                    : "Counted — tap to exclude"
                }
              >
                {l}
              </button>
            ))}
          </div>
        </Row>
        {excluded.length > 0 ? (
          <Row
            label="Keep pricier mods"
            hint="Within the excluded rarities, still count any mod worth at least this much plat (0 = exclude them all). E.g. set 30 and a 30p uncommon stays in your value."
          >
            <div className="set-num">
              <input
                type="number"
                min={0}
                value={minInput}
                placeholder="0"
                onChange={(e) => setMinInput(e.target.value)}
                onBlur={commitMinPlat}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <span className="u">p</span>
            </div>
          </Row>
        ) : null}
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Data &amp; cache</h3>
          <span className="meta">synced {syncedAgo(summary?.last_synced ?? null)}</span>
        </div>
        <Row
          label="Refresh prices"
          hint="Re-pull owned + watchlist prices from warframe.market now"
        >
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => prices.mutate({ force: true })}
          >
            {prices.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </Row>
        <Row label="Refresh catalog" hint="Re-pull the full item list (~3.8k items, one call)">
          <button type="button" className="btn" disabled={busy} onClick={() => catalog.mutate()}>
            {catalog.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </Row>
        <Row label="Sync set composition" hint="Fetch exact set parts per set (slower; throttled)">
          <button type="button" className="btn" disabled={busy} onClick={() => sets.mutate()}>
            {sets.isPending ? "Syncing…" : "Sync"}
          </button>
        </Row>
        <Row
          label="Rebuild cache"
          hint="Wipe prices, history & set data and re-fetch. Your inventory, sales and watchlist are untouched."
        >
          <button
            type="button"
            className="btn warn"
            disabled={busy}
            onClick={() => rebuild.mutate()}
          >
            {rebuild.isPending ? "Rebuilding…" : "Rebuild"}
          </button>
        </Row>
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>warframe.market account</h3>
        </div>
        <Row
          label="Connection"
          hint={
            account?.connected
              ? `Connected as ${account.username}${account.has_session ? " · session active" : ""}`
              : "Not connected — read-only listings & import"
          }
        >
          <button type="button" className="btn" onClick={() => onNavigate("listings")}>
            Manage
          </button>
        </Row>
      </section>

      <GameScanPanel />

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>About</h3>
        </div>
        <Row label="Version" hint="WFIT — Warframe Item Tracker">
          <span className="num">v0.1.0</span>
        </Row>
        <Row
          label="Data sources"
          hint="Prices/items: warframe.market · World-state: warframestat.us"
        >
          <span />
        </Row>
        <Row label="Database" hint="$APPDATA/dev.finn.wfit/wfit.sqlite — local, single user">
          <span />
        </Row>
        <Row label="Developer mode" hint="Reveals testing tools, including a full app wipe">
          <Seg
            value={dev ? "on" : "off"}
            options={[
              ["off", "Off"],
              ["on", "On"],
            ]}
            onChange={(v) => setDev(v === "on")}
          />
        </Row>
      </section>

      {dev ? (
        <section className="tpanel danger">
          <div className="tpanel-h">
            <h3>Developer · danger zone</h3>
          </div>
          <DangerZone />
        </section>
      ) : null}
    </div>
  );
}
