import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { GameScanPanel } from "../components/GameScanPanel";
import { Icon } from "../components/Icon";
import { KeybindCapture } from "../components/KeybindCapture";
import type { ScreenId } from "../components/Sidebar";
import {
  useAppVersion,
  useBackupNow,
  useBackups,
  useCatalogRefresh,
  useClearSimulatedInventory,
  useDevDashboardUrl,
  useExcludedMinPlat,
  useExcludedMinPlatByCat,
  useExcludedRarities,
  useNotificationPrefs,
  useOpenDevDashboard,
  useOverlayPrefs,
  usePricesRefresh,
  useRebuildCache,
  useRecMinPrice,
  useRelicOcrPrefs,
  useSetExcludedMinPlat,
  useSetExcludedMinPlatByCat,
  useSetExcludedRarities,
  useSetNotificationPrefs,
  useSetOverlayPrefs,
  useSetRecMinPrice,
  useSetRelicOcrPrefs,
  useSetsRefresh,
  useSimulateInventory,
  useSummary,
  useUpdateGameData,
  useUpdateStatus,
  useWfmAccount,
} from "../hooks/queries";

// Categories that can have a per-category cheap-item floor.
const CAT_FLOORS: [string, string][] = [
  ["warframe", "Warframe"],
  ["weapon", "Weapon"],
  ["set", "Set"],
  ["mod", "Mod"],
  ["arcane", "Arcane"],
];
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  installAppUpdate,
  openBackupsDir,
  restartApp,
  sendTestNotification,
  triggerRelicCrack,
  wipeApp,
} from "../lib/api";
import { clsx, fmtBytes, syncedAgo } from "../lib/format";
import {
  FONTS,
  type Font,
  type Prefs,
  type Theme,
  loadPrefs,
  savePrefs,
  systemTimezone,
  timezoneOptions,
} from "../lib/prefs";
import { errorMessage, pushToast } from "../lib/toast";
import type {
  GameDataProgress,
  NotificationPrefs,
  OverlayPrefs,
  RelicOcrPrefs,
  UpdateProgress,
} from "../lib/types";

function Row({
  label,
  hint,
  children,
  flash,
}: {
  label: string;
  // Detailed explanation, shown on hover behind a small ⓘ. Omit for
  // self-evident controls so they stay clean.
  hint?: string;
  children: React.ReactNode;
  /** Flash-highlight the row (arrived-at via a notification deep-link). */
  flash?: boolean;
}) {
  return (
    <div className={flash ? "set-row flash" : "set-row"}>
      <div className="set-l">
        <div className="set-k">
          {label}
          {hint ? (
            <span className="set-i" title={hint}>
              <Icon name="info" />
            </span>
          ) : null}
        </div>
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

// Default while the pref query loads — matches the Rust `Default`.
const NOTIF_DEFAULTS: NotificationPrefs = {
  master_enabled: true,
  close_to_tray: true,
  s_tier_arbitration: true,
  void_cascade: true,
  vendor_arrival: true,
  daily_reset: false,
  weekly_reset: true,
  auto_check_updates: true,
};

const OFF_ON: [string, string][] = [
  ["off", "Off"],
  ["on", "On"],
];

/** Settings › About › Updates: check → install (with live download %) → restart.
 *  Windows never reaches the restart step — the installer exits the app itself.
 *  Installs that can't self-update (deb/rpm/bare binary) get a GitHub link. */
function UpdatesRow({ flash }: { flash?: boolean }) {
  const upd = useUpdateStatus();
  const [phase, setPhase] = useState<"idle" | "installing" | "done">("idle");
  const [prog, setProg] = useState<UpdateProgress | null>(null);
  useEffect(() => {
    const unProg = listen<UpdateProgress>("update-download-progress", (e) => setProg(e.payload));
    const unDone = listen("update-download-finished", () => setPhase("done"));
    return () => {
      unProg.then((f) => f());
      unDone.then((f) => f());
    };
  }, []);

  const s = upd.data;
  const install = async () => {
    setPhase("installing");
    try {
      await installAppUpdate(); // on Windows the installer exits the app inside this call
      setPhase("done");
    } catch (e) {
      pushToast(errorMessage(e));
      setPhase("idle");
      setProg(null);
    }
  };

  let body: React.ReactNode;
  if (phase === "installing") {
    const pct =
      prog?.total && prog.total > 0 ? `${Math.floor((prog.downloaded * 100) / prog.total)}%` : null;
    body = (
      <span className="muted num">
        Downloading… {pct ?? (prog ? fmtBytes(prog.downloaded) : "")}
      </span>
    );
  } else if (phase === "done") {
    body = (
      <button type="button" className="btn" onClick={() => restartApp()}>
        Restart now
      </button>
    );
  } else if (s?.update_available && s.in_place) {
    body = (
      <button type="button" className="btn" onClick={install}>
        Install v{s.latest_version}
      </button>
    );
  } else if (s?.update_available) {
    body = (
      <button
        type="button"
        className="btn"
        onClick={() => openExternal("https://github.com/finneritter/WFIT/releases/latest")}
      >
        Get v{s.latest_version} on GitHub
      </button>
    );
  } else {
    body = (
      <>
        {upd.isError ? (
          <span className="muted">Check failed</span>
        ) : s ? (
          <span className="muted">Up to date</span>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={upd.isFetching}
          onClick={() => upd.refetch()}
        >
          {upd.isFetching ? "Checking…" : "Check for updates"}
        </button>
      </>
    );
  }

  return (
    <Row
      label="Updates"
      hint="Windows installs and Linux AppImages update in place; other installs link to GitHub."
      flash={flash}
    >
      {body}
    </Row>
  );
}

function Notifications() {
  const { data } = useNotificationPrefs();
  const setPrefs = useSetNotificationPrefs();
  const [testing, setTesting] = useState(false);
  const prefs = data ?? NOTIF_DEFAULTS;
  // Always write the full blob (the backend stores one JSON object), merging the patch.
  const save = (patch: Partial<NotificationPrefs>) => setPrefs.mutate({ ...prefs, ...patch });
  // Per-event toggle row — disabled (and dimmed) while the master switch is off.
  const Evt = (key: keyof NotificationPrefs, label: string, hint: string) => (
    <Row label={label} hint={hint}>
      <div style={{ opacity: prefs.master_enabled ? 1 : 0.4 }}>
        <Seg
          value={prefs[key] ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => prefs.master_enabled && save({ [key]: v === "on" })}
        />
      </div>
    </Row>
  );
  const doTest = async () => {
    setTesting(true);
    try {
      await sendTestNotification();
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="tpanel">
      <div className="tpanel-h">
        <h3>Notifications</h3>
      </div>
      <Row
        label="Close to tray"
        hint="Closing the window hides WFIT to the system tray instead of quitting. Reopen or quit it from the tray icon. (Needs a system tray; disabled automatically if one isn't available.)"
      >
        <Seg
          value={prefs.close_to_tray ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => save({ close_to_tray: v === "on" })}
        />
      </Row>
      {/* App-level background behavior like close-to-tray, not an OS toast —
          deliberately NOT gated by the master switch below. */}
      <Row
        label="Check for updates"
        hint="Once a day, check GitHub for a new WFIT version and post an in-app notification. Nothing installs without you."
      >
        <Seg
          value={prefs.auto_check_updates ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => save({ auto_check_updates: v === "on" })}
        />
      </Row>
      <Row
        label="Desktop notifications"
        hint="Master switch for the OS notifications below. They fire from the background, so they reach you even while WFIT sits in the tray."
      >
        <Seg
          value={prefs.master_enabled ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => save({ master_enabled: v === "on" })}
        />
      </Row>
      {Evt(
        "s_tier_arbitration",
        "S/A-tier arbitrations",
        "When a top-rated arbitration (community S or A tier) goes live.",
      )}
      {Evt("void_cascade", "Void Cascade fissures", "When a Void Cascade fissure appears.")}
      {Evt("vendor_arrival", "Vendor arrivals", "When Baro Ki'Teer or Varzia is in.")}
      {Evt("daily_reset", "Daily reset", "At the daily reset (00:00 UTC).")}
      {Evt("weekly_reset", "Weekly reset", "At the weekly reset (Monday 00:00 UTC).")}
      <Row label="Test" hint="Fire a sample notification now to confirm your OS shows them.">
        <button type="button" className="btn" disabled={testing} onClick={doTest}>
          {testing ? "Sending…" : "Send test"}
        </button>
      </Row>
    </section>
  );
}

// Default while the pref query loads — matches the Rust `Default`.
const OVERLAY_DEFAULTS: OverlayPrefs = {
  enabled: false,
  hotkey: "Alt+KeyC",
  duration_secs: 6,
};

// Linux/WebKitGTK userAgent contains "Linux"; show the platform caveat only there.
const IS_LINUX = typeof navigator !== "undefined" && /Linux/i.test(navigator.userAgent);

function Overlay() {
  const { data } = useOverlayPrefs();
  const setPrefs = useSetOverlayPrefs();
  const prefs = data ?? OVERLAY_DEFAULTS;
  const [durInput, setDurInput] = useState("");
  // Show the live pref unless the user is mid-edit on the duration field.
  const durValue = durInput !== "" ? durInput : String(prefs.duration_secs);
  // Always write the full blob (the backend stores one JSON object), merging the patch.
  const save = (patch: Partial<OverlayPrefs>) => setPrefs.mutate({ ...prefs, ...patch });
  const commitDuration = () => {
    const n = Math.round(Number(durInput));
    if (durInput !== "" && Number.isFinite(n)) {
      save({ duration_secs: Math.min(30, Math.max(1, n)) });
    }
    setDurInput("");
  };

  return (
    <section className="tpanel">
      <div className="tpanel-h">
        <h3>Cascade overlay</h3>
      </div>
      <Row
        label="Enable overlay"
        hint="A global hotkey pops up a small always-on-top pill showing whether a Void Cascade fissure is live (tinted by relic tier) or how long until the Omnia rotation resets — without leaving the game."
      >
        <Seg
          value={prefs.enabled ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => save({ enabled: v === "on" })}
        />
      </Row>
      <Row
        label="Hotkey"
        hint="Click, then press your shortcut. Needs at least one modifier (Ctrl/Alt/Shift/Super). Pick a combo your game doesn't already bind."
      >
        <div style={{ opacity: prefs.enabled ? 1 : 0.4 }}>
          <KeybindCapture value={prefs.hotkey} onChange={(hotkey) => save({ hotkey })} />
        </div>
      </Row>
      <Row
        label="On-screen time"
        hint="How long the overlay stays visible per press (1–30 seconds)."
      >
        <div className="set-num" style={{ opacity: prefs.enabled ? 1 : 0.4 }}>
          <input
            type="number"
            min={1}
            max={30}
            value={durValue}
            onChange={(e) => setDurInput(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="u">s</span>
        </div>
      </Row>
      {IS_LINUX ? (
        <Row label="Heads-up">
          <div className="set-note">
            Run Warframe in <b>Borderless/Windowed Fullscreen</b> so the overlay can draw over it —
            nothing composites over true exclusive fullscreen. On native Wayland, global hotkeys are
            unreliable; an X11 session is recommended.
          </div>
        </Row>
      ) : null}
    </section>
  );
}

// Default while the pref query loads — matches the Rust `Default`.
const RELIC_OCR_DEFAULTS: RelicOcrPrefs = {
  enabled: false,
  hotkey: "Alt+KeyX",
  duration_secs: 10,
  auto_detect: false,
};

function RelicOcr() {
  const { data } = useRelicOcrPrefs();
  const setPrefs = useSetRelicOcrPrefs();
  const prefs = data ?? RELIC_OCR_DEFAULTS;
  const [durInput, setDurInput] = useState("");
  const [testing, setTesting] = useState(false);
  const durValue = durInput !== "" ? durInput : String(prefs.duration_secs);
  const save = (patch: Partial<RelicOcrPrefs>) =>
    setPrefs.mutate({ ...prefs, ...patch }, { onError: (e) => pushToast(errorMessage(e)) });
  const commitDuration = () => {
    const n = Math.round(Number(durInput));
    if (durInput !== "" && Number.isFinite(n)) {
      save({ duration_secs: Math.min(30, Math.max(3, n)) });
    }
    setDurInput("");
  };
  const testCapture = async () => {
    setTesting(true);
    try {
      const cap = await triggerRelicCrack();
      if (cap.error) pushToast(cap.error);
      else pushToast(`read ${cap.rewards.length} reward(s) in ${cap.ocr_ms}ms`, "info");
    } catch (e) {
      pushToast(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="tpanel">
      <div className="tpanel-h">
        <h3>Relic reward prices</h3>
      </div>
      <Row
        label="Enable capture"
        hint="On the relic reward screen, press the hotkey: WFIT takes a one-off screenshot, reads the offered part names locally, and shows their platinum/ducat prices in a small HUD box top-left. Same approach as WFInfo — a screenshot read on your machine; no game files or memory are touched, DE has tolerated tools like this for years."
      >
        <Seg
          value={prefs.enabled ? "on" : "off"}
          options={OFF_ON}
          onChange={(v) => save({ enabled: v === "on" })}
        />
      </Row>
      <Row
        label="Hotkey"
        hint="Click, then press your shortcut. Needs at least one modifier. Must differ from the Cascade overlay's key."
      >
        <div style={{ opacity: prefs.enabled ? 1 : 0.4 }}>
          <KeybindCapture value={prefs.hotkey} onChange={(hotkey) => save({ hotkey })} />
        </div>
      </Row>
      <Row
        label="On-screen time"
        hint="How long the price box stays visible (3–30 seconds; the reward choice window is about 10)."
      >
        <div className="set-num" style={{ opacity: prefs.enabled ? 1 : 0.4 }}>
          <input
            type="number"
            min={3}
            max={30}
            value={durValue}
            onChange={(e) => setDurInput(e.target.value)}
            onBlur={commitDuration}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="u">s</span>
        </div>
      </Row>
      <Row
        label="Auto-detect reward screen"
        hint="Watches the game's engine log (EE.log, a plain text file — read only) and shows the price box automatically the moment the reward choices appear, no hotkey needed. The hotkey keeps working either way."
      >
        <div style={{ opacity: prefs.enabled ? 1 : 0.4 }}>
          <Seg
            value={prefs.auto_detect ? "on" : "off"}
            options={OFF_ON}
            onChange={(v) => prefs.enabled && save({ auto_detect: v === "on" })}
          />
        </div>
      </Row>
      <Row
        label="Test capture"
        hint="Runs the full pipeline right now against whatever is on screen (with the game up on the reward screen, you should see the box top-left)."
      >
        <button
          type="button"
          className="btn"
          disabled={!prefs.enabled || testing}
          onClick={testCapture}
        >
          {testing ? "Capturing…" : "Capture now"}
        </button>
      </Row>
      {IS_LINUX ? (
        <Row label="Heads-up">
          <div className="set-note">
            Run Warframe in <b>Borderless/Windowed Fullscreen</b> — capture and overlay both need
            it. The game window is captured directly (X11), which works in a Wayland session too.
          </div>
        </Row>
      ) : null}
    </section>
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

// Developer aid: fill the DB with a random owned inventory + account so the
// value-bearing screens can be exercised without a live game-client scan.
// Both actions back up / are reversible, but still confirm before replacing data.
function SimPanel() {
  const sim = useSimulateInventory();
  const clear = useClearSimulatedInventory();
  const [armed, setArmed] = useState<null | "sim" | "clear">(null);
  // How full the simulated account is: % of the tradeable catalog it owns.
  // High = a lived-in, near-maxed account (thousands of items).
  const [fill, setFill] = useState(75);
  const busy = sim.isPending || clear.isPending;
  return (
    <>
      <Row
        label="Inventory size"
        hint="How full the fake account is — the share of the catalog it owns. 100% ≈ a maxed, lived-in account (thousands of items); low is sparse."
      >
        <div className="sim-scale">
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={fill}
            disabled={busy}
            onChange={(e) => setFill(Number(e.target.value))}
            aria-label="Inventory fill percent"
          />
          <span className="num">{fill}%</span>
        </div>
      </Row>
      <Row
        label="Simulate fake inventory"
        hint="Replace your inventory & account with random sets, mods, arcanes, resources and a plat/credit balance (profile shows random_user). Snapshots the DB to /backups first. For testing screens without a game scan."
      >
        {armed === "sim" ? (
          <div className="wipe-act">
            <button
              type="button"
              className="btn warn"
              disabled={busy}
              onClick={() => {
                sim.mutate(fill);
                setArmed(null);
              }}
            >
              {sim.isPending ? "Simulating…" : "Replace with fake data"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setArmed(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn warn"
            disabled={busy}
            onClick={() => setArmed("sim")}
          >
            Simulate…
          </button>
        )}
      </Row>
      <Row
        label="Clear simulated data"
        hint="Empty the inventory + account snapshot and reset the profile name back to default. Use to return to a fresh state without a full app wipe."
      >
        {armed === "clear" ? (
          <div className="wipe-act">
            <button
              type="button"
              className="btn warn"
              disabled={busy}
              onClick={() => {
                clear.mutate();
                setArmed(null);
              }}
            >
              {clear.isPending ? "Clearing…" : "Clear everything"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setArmed(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => setArmed("clear")}>
            Clear…
          </button>
        )}
      </Row>
    </>
  );
}

// Opens the local dev web dashboard (stress + observability + fault injection).
// The URL is only non-null when the app was launched with the dev-dashboard build
// (`npm run tauri:dev:dash`); otherwise the button explains how to enable it.
function DevDashboardRow() {
  const { data: url } = useDevDashboardUrl();
  const open = useOpenDevDashboard();
  return (
    <Row
      label="Web dashboard"
      hint={
        url
          ? `Live stress & observability dashboard at ${url} — metrics, load generation, fault injection.`
          : "Not running. Launch with `npm run tauri:dev:dash` to enable the dev dashboard."
      }
    >
      <button
        type="button"
        className="btn"
        disabled={!url || open.isPending}
        onClick={() => open.mutate()}
      >
        {url ? "Open dashboard" : "Unavailable"}
      </button>
    </Row>
  );
}

export function Settings({
  onNavigate,
  focusSection,
}: {
  onNavigate: (id: ScreenId) => void;
  /** Section to scroll to + flash on mount ("updates" from the update notification). */
  focusSection?: string | null;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  // Notification deep-link: scroll the About panel into view and flash the
  // Updates row, so "new version" clicks land on the control that installs it.
  const aboutRef = useRef<HTMLElement | null>(null);
  const [flashUpdates, setFlashUpdates] = useState(false);
  useEffect(() => {
    if (focusSection !== "updates") return;
    aboutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashUpdates(true);
    const t = setTimeout(() => setFlashUpdates(false), 1700);
    return () => clearTimeout(t);
  }, [focusSection]);
  const { data: summary } = useSummary();
  const { data: account } = useWfmAccount();
  const { data: version } = useAppVersion();
  const { data: backups = [] } = useBackups();
  const backup = useBackupNow();
  const prices = usePricesRefresh();
  const catalog = useCatalogRefresh();
  const sets = useSetsRefresh();
  const rebuild = useRebuildCache();
  const updateAll = useUpdateGameData();
  const [updProg, setUpdProg] = useState<GameDataProgress | null>(null);
  // Mirror the backend's game-data-progress events into a live bar; clear when idle.
  useEffect(() => {
    const un = listen<GameDataProgress>("game-data-progress", (e) => setUpdProg(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (!updateAll.isPending) setUpdProg(null);
  }, [updateAll.isPending]);
  const { data: excluded = [] } = useExcludedRarities();
  const setExcluded = useSetExcludedRarities();
  const { data: excludedMinPlat = 0 } = useExcludedMinPlat();
  const setExcludedMin = useSetExcludedMinPlat();
  const [minInput, setMinInput] = useState("");
  useEffect(() => {
    setMinInput(excludedMinPlat ? String(excludedMinPlat) : "");
  }, [excludedMinPlat]);
  const { data: catFloors = {} } = useExcludedMinPlatByCat();
  const setCatFloors = useSetExcludedMinPlatByCat();
  const [catInput, setCatInput] = useState<Record<string, string>>({});
  useEffect(() => {
    setCatInput(
      Object.fromEntries(CAT_FLOORS.map(([k]) => [k, catFloors[k] ? String(catFloors[k]) : ""])),
    );
  }, [catFloors]);
  const commitCatFloors = () => {
    const next: Record<string, number> = {};
    for (const [k] of CAT_FLOORS) {
      const n = Math.max(0, Math.round(Number(catInput[k]) || 0));
      if (n > 0) next[k] = n;
    }
    setCatFloors.mutate(next);
  };
  const { data: recMinPrice = 15 } = useRecMinPrice();
  const setRecMin = useSetRecMinPrice();
  const [recMinInput, setRecMinInput] = useState("");
  useEffect(() => {
    setRecMinInput(String(recMinPrice));
  }, [recMinPrice]);
  const commitRecMin = () => {
    const n = Math.max(0, Math.round(Number(recMinInput) || 0));
    if (n !== recMinPrice) setRecMin.mutate(n);
  };
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

  const busy =
    prices.isPending ||
    catalog.isPending ||
    sets.isPending ||
    rebuild.isPending ||
    updateAll.isPending;
  const upd = updateAll.data;

  return (
    <div className="settings">
      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Appearance</h3>
        </div>
        <Row label="Theme">
          <Seg
            value={prefs.theme}
            options={[
              ["dark", "Dark"],
              ["light", "Light"],
            ]}
            onChange={(v) => update({ theme: v as Theme })}
          />
        </Row>
        <Row
          label="Font"
          hint={
            FONTS.find((f) => f.value === prefs.font)?.hint ??
            "UI typeface — numbers stay monospaced"
          }
        >
          <Seg
            value={prefs.font}
            options={FONTS.map((f) => [f.value, f.label] as [string, string])}
            onChange={(v) => update({ font: v as Font })}
          />
        </Row>
        <Row label="Density">
          <Seg
            value={prefs.dense ? "dense" : "comfy"}
            options={[
              ["comfy", "Comfortable"],
              ["dense", "Dense"],
            ]}
            onChange={(v) => update({ dense: v === "dense" })}
          />
        </Row>
        <Row
          label="Scan tag"
          hint="Show a small “SCAN” tag on inventory rows imported via the game memory-scan"
        >
          <Seg
            value={prefs.showScanTag ? "on" : "off"}
            options={OFF_ON}
            onChange={(v) => update({ showScanTag: v === "on" })}
          />
        </Row>
        <Row label="Price deltas">
          <Seg
            value={prefs.flatDeltas ? "flat" : "color"}
            options={[
              ["color", "Colored"],
              ["flat", "Flat"],
            ]}
            onChange={(v) => update({ flatDeltas: v === "flat" })}
          />
        </Row>
        <Row
          label="Time zone"
          hint={`Clock times on the Rotation screen (arbitration schedule, data age). Countdowns are unaffected. Auto follows the PC's zone (${systemTimezone()}).`}
        >
          <select
            className="tz-select"
            value={prefs.timezone}
            onChange={(e) => update({ timezone: e.target.value })}
          >
            <option value="auto">Auto (PC time zone)</option>
            {timezoneOptions().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Row>
      </section>

      <Notifications />

      <Overlay />

      <RelicOcr />

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
        <Row
          label="Hide cheap items by category"
          hint="Drop items worth this much plat or less from your portfolio value (and dim them in the grid — use Inventory's “Hide excluded” to remove them from view). E.g. set Mod to 2 and every 1–2p mod stops counting. 0 = off."
        >
          <div className="cat-mins">
            {CAT_FLOORS.map(([k, l]) => (
              <label key={k} className="cat-min">
                <span className="cat-min-l">{l}</span>
                <span className="set-num">
                  <input
                    type="number"
                    min={0}
                    value={catInput[k] ?? ""}
                    placeholder="0"
                    onChange={(e) => setCatInput((s) => ({ ...s, [k]: e.target.value }))}
                    onBlur={commitCatFloors}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <span className="u">p</span>
                </span>
              </label>
            ))}
          </div>
        </Row>
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Listing recommendations</h3>
        </div>
        <Row
          label="Minimum sell price"
          hint="Only recommend listing an item when its suggested price is at least this much plat per unit — below this it isn't worth the trade. Applies to the Listings → Recommended tab. Default 15."
        >
          <div className="set-num">
            <input
              type="number"
              min={0}
              value={recMinInput}
              placeholder="15"
              onChange={(e) => setRecMinInput(e.target.value)}
              onBlur={commitRecMin}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="u">p</span>
          </div>
        </Row>
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>Data &amp; cache</h3>
          <span className="meta">synced {syncedAgo(summary?.last_synced ?? null)}</span>
        </div>
        <Row
          label="Update game data"
          hint="After a Warframe patch: pull new items, ducats, vault changes, set composition and relics in one go (~a minute). Prices for new items fill in shortly after."
        >
          <button type="button" className="btn" disabled={busy} onClick={() => updateAll.mutate()}>
            {updateAll.isPending ? "Updating…" : "Update"}
          </button>
        </Row>
        {updateAll.isPending ? (
          <div className="upd-status">
            <div className="upd-prog">
              <div
                className={clsx("upd-prog-fill", (updProg?.total ?? 0) === 0 && "indeterminate")}
                style={
                  updProg && updProg.total > 0
                    ? { width: `${Math.round((updProg.current / updProg.total) * 100)}%` }
                    : undefined
                }
              />
            </div>
            <span className="meta">
              {updProg
                ? `Step ${updProg.step}/${updProg.steps} · ${updProg.label}${
                    updProg.total > 0 ? ` ${updProg.current}/${updProg.total}` : ""
                  }`
                : "Starting…"}
            </span>
          </div>
        ) : null}
        {upd && !updateAll.isPending ? (
          <div className="meta" style={{ padding: "0 0 8px" }}>
            {`+${upd.catalog_new} item${upd.catalog_new === 1 ? "" : "s"} (${upd.catalog_total} total) · `}
            {upd.vault_refreshed ? "vault refreshed · " : "vault unchanged · "}
            {`${upd.sets_synced} set parts · `}
            {upd.relics_refreshed
              ? `+${upd.relics_new} relic${upd.relics_new === 1 ? "" : "s"} (${upd.relics_total} total) · `
              : "relics unchanged · "}
            {upd.manifest_refreshed
              ? `item manifest refreshed (${upd.manifest_total} items)`
              : "manifest unchanged"}
          </div>
        ) : null}
        <Row label="Refresh prices">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => prices.mutate({ force: true })}
          >
            {prices.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </Row>
        <Row label="Refresh catalog">
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
          <h3>Backups</h3>
          <span className="meta">snapshots also happen automatically before any DB migration</span>
        </div>
        <Row
          label="Back up now"
          hint="Snapshot the database into …/backups — the newest 10 are kept"
        >
          <button
            type="button"
            className="btn"
            disabled={backup.isPending}
            onClick={() => backup.mutate()}
          >
            {backup.isPending ? "Backing up…" : "Back up"}
          </button>{" "}
          <button type="button" className="btn" onClick={() => openBackupsDir()}>
            Open folder
          </button>
        </Row>
        {backups.length === 0 ? (
          <div className="empty">No backups yet.</div>
        ) : (
          <div className="backup-list">
            {backups.map((b) => (
              <div key={b.file_name} className="backup-row">
                <span className="num bk-name">{b.file_name}</span>
                <span className="num bk-size">{fmtBytes(b.size_bytes)}</span>
                <span className="muted bk-date">{new Date(b.modified_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="tpanel">
        <div className="tpanel-h">
          <h3>warframe.market account</h3>
        </div>
        <Row label="Connection">
          <span className="muted" style={{ marginRight: 10 }}>
            {account?.connected
              ? `${account.username}${account.has_session ? " · session active" : ""}`
              : "Not connected"}
          </span>
          <button type="button" className="btn" onClick={() => onNavigate("listings")}>
            Manage
          </button>
        </Row>
      </section>

      <GameScanPanel />

      <section className="tpanel" ref={aboutRef}>
        <div className="tpanel-h">
          <h3>About</h3>
        </div>
        <Row label="Version">
          <span className="num">v{version ?? "…"}</span>
        </Row>
        <UpdatesRow flash={flashUpdates} />
        <Row label="Data sources">
          <span className="muted">warframe.market · warframestat.us</span>
        </Row>
        <Row label="Database">
          <span className="muted">$APPDATA/dev.finn.wfit/wfit.sqlite</span>
        </Row>
        <Row label="Developer mode" hint="Reveals testing tools, including a full app wipe.">
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
        <section className="tpanel">
          <div className="tpanel-h">
            <h3>Developer</h3>
          </div>
          <DevDashboardRow />
          <SimPanel />
          <DangerZone />
        </section>
      ) : null}
    </div>
  );
}
