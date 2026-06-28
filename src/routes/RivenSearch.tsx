import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SortTh, StatBox, TableStatus } from "../components/ui";
import {
  useCreateRivenSearch,
  useRivenAttributes,
  useRivenSearch,
  useRivenSearches,
  useRivenWeapons,
} from "../hooks/queries";
import { copyText } from "../lib/clipboard";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { rivensSchema } from "../lib/searchSchemas";
import type { RivenAttribute, RivenQuery, RivenResult, RivenWeapon } from "../lib/types";

// Polarities a riven can roll (slug → in-game symbol). "any" = no preference.
const POLARITIES: [string, string][] = [
  ["madurai", "V (Madurai)"],
  ["vazarin", "D (Vazarin)"],
  ["naramon", "— (Naramon)"],
];
const MAX_POSITIVES = 3;
const PREFS_KEY = "wfit.riven.prefs";

interface RivenPrefs {
  weapon: string;
  positives: string[];
  negative: string | null;
  // slug → raw value threshold string (positive = min %, negative = max magnitude);
  // empty/absent = no threshold. A client-side filter; never sent to the API.
  minValues: Record<string, string>;
  polarity: string | null;
  reRollsMax: string;
  masteryMax: string;
  // Client-side seller-presence filter: any · online (online or in-game) · in-game only.
  status: StatusFilter;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}
type SortKey = "match" | "price" | "grade";
type StatusFilter = "any" | "online" | "ingame";
const DEFAULT_PREFS: RivenPrefs = {
  weapon: "",
  positives: [],
  negative: null,
  minValues: {},
  polarity: null,
  reRollsMax: "",
  masteryMax: "",
  status: "any",
  sortKey: "match",
  sortDir: "asc",
};
function loadPrefs(): RivenPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Capitalize the auction's generated riven name (stored lowercase, e.g. "cronibin"). */
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The warframe.market in-game whisper for a riven auction. (Confirm format vs the site.) */
function whisperLine(r: RivenResult): string {
  const price = r.buyout_price ?? r.starting_price ?? 0;
  return `/w ${r.owner_name} Hi! I want to buy: "${r.weapon_name} ${cap(r.riven_name)}" (riven) for ${price} platinum. (warframe.market)`;
}

const priceOf = (r: RivenResult): number | null => r.buyout_price ?? r.starting_price;
const TIER_LABEL = ["Exact", "All pos", "Close", "Partial", "Weapon"];

export function RivenSearch({
  onOpen,
  loadReq,
  onSaved,
}: {
  onOpen: (slug: string) => void;
  // A request from the saved-searches sidebar / a notification to load a saved
  // search into the form. The nonce lets the same id re-fire.
  loadReq?: { id: number; nonce: number } | null;
  // Called after a search is saved — opens the saved-searches panel.
  onSaved?: () => void;
}) {
  const [prefs, setPrefs] = useState<RivenPrefs>(loadPrefs);
  const patch = (p: Partial<RivenPrefs>) => setPrefs((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage errors
    }
  }, [prefs]);

  const weapons = useRivenWeapons();
  const attributes = useRivenAttributes();
  const saved = useRivenSearches();
  const createSaved = useCreateRivenSearch();

  const weapon = useMemo(
    () => (weapons.data ?? []).find((w) => w.slug === prefs.weapon) ?? null,
    [weapons.data, prefs.weapon],
  );

  // Stats valid for this weapon's riven type (exclusive_to null = any weapon).
  const validAttrs = useMemo(() => {
    const all = attributes.data ?? [];
    if (!weapon) return all;
    return all.filter((a) => !a.exclusive_to || a.exclusive_to.includes(weapon.riven_type));
  }, [attributes.data, weapon]);
  const attrName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes.data ?? []) m.set(a.slug, a.name);
    return m;
  }, [attributes.data]);

  // The query sent to the backend — null (no fetch) until a weapon is chosen.
  const query: RivenQuery | null = useMemo(() => {
    if (!prefs.weapon) return null;
    const num = (s: string) => {
      const n = Number.parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    };
    return {
      weapon: prefs.weapon,
      positives: prefs.positives,
      negative: prefs.negative,
      polarity: prefs.polarity,
      re_rolls_max: num(prefs.reRollsMax),
      mastery_rank_max: num(prefs.masteryMax),
    };
  }, [prefs]);
  const search = useRivenSearch(query);

  const addPositive = (slug: string) =>
    setPrefs((cur) =>
      cur.positives.includes(slug) || cur.positives.length >= MAX_POSITIVES
        ? cur
        : { ...cur, positives: [...cur.positives, slug] },
    );
  const removePositive = (slug: string) =>
    setPrefs((cur) => {
      const minValues = { ...cur.minValues };
      delete minValues[slug];
      return { ...cur, positives: cur.positives.filter((s) => s !== slug), minValues };
    });
  // Set or clear the single negative; drop the old negative's threshold when it changes.
  const setNegative = (slug: string | null) =>
    setPrefs((cur) => {
      const minValues = { ...cur.minValues };
      if (cur.negative && cur.negative !== slug) delete minValues[cur.negative];
      return { ...cur, negative: slug, minValues };
    });
  // A blank box means "no threshold" — drop the key so saves/filters stay clean.
  const setMin = (slug: string, value: string) =>
    setPrefs((cur) => {
      const minValues = { ...cur.minValues };
      if (value.trim() === "") delete minValues[slug];
      else minValues[slug] = value;
      return { ...cur, minValues };
    });

  const pickWeapon = (slug: string) =>
    // New weapon → drop stats (and their thresholds) that no longer apply.
    setPrefs((cur) => {
      const w = (weapons.data ?? []).find((x) => x.slug === slug);
      const ok = (s: string) => {
        const a = (attributes.data ?? []).find((x) => x.slug === s);
        return !a || !a.exclusive_to || (w ? a.exclusive_to.includes(w.riven_type) : true);
      };
      const positives = cur.positives.filter(ok);
      const negative = cur.negative && ok(cur.negative) ? cur.negative : null;
      const kept = new Set([...positives, ...(negative ? [negative] : [])]);
      const minValues = Object.fromEntries(
        Object.entries(cur.minValues).filter(([s]) => kept.has(s)),
      );
      return { ...cur, weapon: slug, positives, negative, minValues };
    });

  // Stable so the load-request effect can depend on it without re-running each render.
  const loadSaved = useCallback(
    (id: number) => {
      const s = (saved.data ?? []).find((x) => x.id === id);
      if (!s) return;
      setPrefs((cur) => ({
        ...cur,
        weapon: s.weapon,
        positives: s.positives,
        negative: s.negative,
        polarity: s.polarity,
        reRollsMax: s.re_rolls_max == null ? "" : String(s.re_rolls_max),
        masteryMax: s.mastery_rank_max == null ? "" : String(s.mastery_rank_max),
        minValues: Object.fromEntries(
          Object.entries(s.min_values ?? {}).map(([k, v]) => [k, String(v)]),
        ),
      }));
    },
    [saved.data],
  );
  const saveCurrent = () => {
    if (!query || !weapon) return;
    const label = `${weapon.name}${prefs.positives.length ? ` · ${prefs.positives.map((p) => attrName.get(p) ?? p).join("/")}` : ""}`;
    const minValues: Record<string, number> = {};
    for (const [slug, raw] of Object.entries(prefs.minValues)) {
      const v = Number.parseFloat(raw);
      if (Number.isFinite(v)) minValues[slug] = v;
    }
    createSaved.mutate({ label, query, minValues });
    onSaved?.();
  };

  // Apply a load request from the sidebar / a notification deep-link. Keyed on the
  // nonce (so the same id re-fires) and on saved.data (retry once the list lands).
  const appliedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!loadReq || appliedNonce.current === loadReq.nonce) return;
    if (!(saved.data ?? []).some((x) => x.id === loadReq.id)) return;
    appliedNonce.current = loadReq.nonce;
    loadSaved(loadReq.id);
  }, [loadReq, loadSaved, saved.data]);

  return (
    <div className="mkt-screener">
      <WeaponPicker
        weapons={weapons.data ?? []}
        selected={weapon}
        loading={weapons.isLoading}
        onPick={pickWeapon}
      />

      {weapon ? (
        <StatPicker
          attrs={validAttrs}
          positives={prefs.positives}
          negative={prefs.negative}
          minValues={prefs.minValues}
          onAddPositive={addPositive}
          onRemovePositive={removePositive}
          onSetNegative={setNegative}
          onSetMin={setMin}
        />
      ) : null}

      {/* Secondary constraints + save */}
      {weapon ? (
        <div className="mkt-filters riven-constraints">
          <span className="mkt-field">
            <span className="muted">Polarity</span>
            <select
              className="lf-select"
              value={prefs.polarity ?? ""}
              onChange={(e) => patch({ polarity: e.target.value || null })}
            >
              <option value="">any</option>
              {POLARITIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </span>
          <span className="mkt-field">
            <span className="muted">Max rolls</span>
            <input
              className="lf-qty"
              type="number"
              min={0}
              placeholder="∞"
              value={prefs.reRollsMax}
              onChange={(e) => patch({ reRollsMax: e.target.value })}
            />
          </span>
          <span className="mkt-field">
            <span className="muted">Max MR</span>
            <input
              className="lf-qty"
              type="number"
              min={0}
              placeholder="∞"
              value={prefs.masteryMax}
              onChange={(e) => patch({ masteryMax: e.target.value })}
            />
          </span>
          <span className="mkt-field">
            <span className="muted">Status</span>
            <select
              className="lf-select"
              value={prefs.status}
              onChange={(e) => patch({ status: e.target.value as StatusFilter })}
            >
              <option value="any">any</option>
              <option value="online">online</option>
              <option value="ingame">in-game</option>
            </select>
          </span>
          <span className="mkt-sep" />
          <button
            type="button"
            className="btn sm"
            disabled={createSaved.isPending}
            onClick={saveCurrent}
          >
            ★ Save search
          </button>
          <button
            type="button"
            className="btn sm"
            title="Open this weapon on the Market screen"
            onClick={() => onOpen(weapon.slug)}
          >
            Open weapon
          </button>
        </div>
      ) : null}

      {weapon ? (
        <Results search={search} weapon={weapon} prefs={prefs} patch={patch} />
      ) : (
        <div className="empty">Pick a weapon to search live riven auctions.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weapon combobox: filter the ~400 weapons by name, click to select.
// ---------------------------------------------------------------------------
function WeaponPicker({
  weapons,
  selected,
  loading,
  onPick,
}: {
  weapons: RivenWeapon[];
  selected: RivenWeapon | null;
  loading: boolean;
  onPick: (slug: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return weapons.slice(0, 50);
    return weapons.filter((w) => w.name.toLowerCase().includes(t)).slice(0, 50);
  }, [weapons, q]);

  return (
    <div className="riven-weapon" style={{ position: "relative" }}>
      <div className="search mkt-search">
        <Icon name="search" />
        <input
          placeholder={loading ? "Loading weapons…" : "Choose a weapon…"}
          value={open ? q : selected ? `${selected.name}` : q}
          onFocus={() => {
            setOpen(true);
            setQ("");
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />
        {selected ? (
          <span className="muted" style={{ paddingRight: 8 }}>
            {selected.riven_type} · disp {selected.disposition.toFixed(2)}
          </span>
        ) : null}
      </div>
      {open && matches.length > 0 ? (
        <div className="viewmenu" style={{ left: 0, right: 0, maxHeight: 320, overflowY: "auto" }}>
          {matches.map((w) => (
            <button
              key={w.slug}
              type="button"
              className={clsx("viewopt", selected?.slug === w.slug && "on")}
              onMouseDown={() => onPick(w.slug)}
            >
              <span>{w.name}</span>
              <span className="muted">
                {w.riven_type} · {w.disposition.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Unit suffix shown next to a stat's value field / row. */
const unitSuffix = (a?: RivenAttribute): string =>
  a?.unit === "percent" ? "%" : a?.unit === "seconds" ? "s" : "";

// ---------------------------------------------------------------------------
// Stat picker: positives (≤3) and the negative (≤1) are built the same way — a
// titled section panel with an "Add stat" menu and grid-aligned rows. Each row
// carries a value threshold: positives a minimum (roll at least this), the
// negative a maximum magnitude (downside no worse than this). Thresholds filter
// results client-side — the warframe.market query only knows which slugs are
// wanted. Rows take a green/red hover tint to telegraph the +/- role.
// ---------------------------------------------------------------------------
function StatPicker({
  attrs,
  positives,
  negative,
  minValues,
  onAddPositive,
  onRemovePositive,
  onSetNegative,
  onSetMin,
}: {
  attrs: RivenAttribute[];
  positives: string[];
  negative: string | null;
  minValues: Record<string, string>;
  onAddPositive: (slug: string) => void;
  onRemovePositive: (slug: string) => void;
  onSetNegative: (slug: string | null) => void;
  onSetMin: (slug: string, value: string) => void;
}) {
  const bySlug = useMemo(() => {
    const m = new Map<string, RivenAttribute>();
    for (const a of attrs) m.set(a.slug, a);
    return m;
  }, [attrs]);
  // A stat can't be in two roles at once — hide already-picked ones from both menus.
  const taken = useMemo(
    () => new Set([...positives, ...(negative ? [negative] : [])]),
    [positives, negative],
  );
  const available = useMemo(() => attrs.filter((a) => !taken.has(a.slug)), [attrs, taken]);

  const row = (slug: string, kind: "min" | "max", onRemove: () => void) => {
    const a = bySlug.get(slug);
    const isPos = kind === "min";
    return (
      <div key={slug} className={clsx("riven-statrow", isPos ? "pos" : "neg")}>
        <span className="rsr-name">
          <span className="rsr-sign">{isPos ? "+" : "−"}</span>
          {a?.name ?? slug}
        </span>
        <label className="riven-val">
          {kind}
          <input
            className="lf-qty"
            type="number"
            min={0}
            placeholder="any"
            value={minValues[slug] ?? ""}
            onChange={(e) => onSetMin(slug, e.target.value)}
          />
          <span className="rv-unit">{unitSuffix(a)}</span>
        </label>
        <button type="button" className="rm" title="Remove stat" onClick={onRemove}>
          ✕
        </button>
      </div>
    );
  };

  return (
    <div className="riven-picker">
      <div className="riven-statsec">
        <div className="riven-sechead">
          <span className="rsh-label">Positives</span>
          <span className="rsh-count">
            {positives.length}/{MAX_POSITIVES}
          </span>
          <span className="rsh-spacer" />
          <AddStatMenu
            options={available}
            disabled={positives.length >= MAX_POSITIVES}
            onPick={onAddPositive}
          />
        </div>
        {positives.length === 0 ? (
          <div className="riven-empty">Add up to {MAX_POSITIVES} stats the roll must have.</div>
        ) : (
          positives.map((slug) => row(slug, "min", () => onRemovePositive(slug)))
        )}
      </div>

      <div className="riven-statsec">
        <div className="riven-sechead">
          <span className="rsh-label">Negative</span>
          <span className="rsh-count">{negative ? 1 : 0}/1</span>
          <span className="rsh-spacer" />
          <AddStatMenu
            options={available}
            disabled={!!negative}
            onPick={(slug) => onSetNegative(slug)}
          />
        </div>
        {negative ? (
          row(negative, "max", () => onSetNegative(null))
        ) : (
          <div className="riven-empty">Optional — leave empty to allow any downside.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Add stat" popover: a filtered list of the weapon's remaining stats. A sticky
// search header sits over a scrolling list; it closes on outside-click or Escape
// (not input blur — that swallowed scroll gestures and made the list un-scrollable).
// ---------------------------------------------------------------------------
function AddStatMenu({
  options,
  disabled,
  onPick,
}: {
  options: RivenAttribute[];
  disabled: boolean;
  onPick: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((a) => a.name.toLowerCase().includes(t)) : options;
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="riven-addmenu" ref={wrapRef}>
      <button
        type="button"
        className="btn sm riven-addbtn"
        disabled={disabled}
        onClick={() => {
          setQ("");
          setOpen((o) => !o);
        }}
      >
        <Icon name="plus" />
        Add stat
      </button>
      {open && !disabled ? (
        <div className="riven-menu">
          <div className="riven-menu-head">
            <div className="search">
              <Icon name="search" />
              <input
                ref={inputRef}
                placeholder="Filter stats…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="riven-menu-list">
            {matches.map((a) => (
              <button
                key={a.slug}
                type="button"
                className="riven-menu-opt"
                onClick={() => {
                  onPick(a.slug);
                  setOpen(false);
                }}
              >
                {a.name}
                {unitSuffix(a) ? <span className="rmo-unit">{unitSuffix(a)}</span> : null}
              </button>
            ))}
            {matches.length === 0 ? (
              <div className="riven-menu-empty">No matching stats</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results: price summary + ranked, graded, topbar-filterable auction table.
// ---------------------------------------------------------------------------
function Results({
  search,
  weapon,
  prefs,
  patch,
}: {
  search: ReturnType<typeof useRivenSearch>;
  weapon: RivenWeapon;
  prefs: RivenPrefs;
  patch: (p: Partial<RivenPrefs>) => void;
}) {
  const topbar = usePageSearch();
  const { test } = useMemo(() => compileQuery(topbar, rivensSchema), [topbar]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Per-stat value thresholds (client-side): a positive must roll at or above its
  // min; the negative's magnitude must be at or below its max (absent negative = ok).
  const passesThresholds = useMemo(() => {
    const entries = Object.entries(prefs.minValues)
      .map(([slug, raw]) => [slug, Number.parseFloat(raw)] as const)
      .filter(([, v]) => Number.isFinite(v));
    if (entries.length === 0) return () => true;
    const negSlug = prefs.negative;
    return (r: RivenResult) => {
      for (const [slug, threshold] of entries) {
        if (slug === negSlug) {
          const attr = r.attributes.find((a) => a.slug === slug && !a.positive);
          if (attr && Math.abs(attr.value) > threshold) return false;
        } else {
          const attr = r.attributes.find((a) => a.slug === slug && a.positive);
          if (!attr || attr.value < threshold) return false;
        }
      }
      return true;
    };
  }, [prefs.minValues, prefs.negative]);

  // Seller-presence filter: "online" keeps in-game OR online (anyone reachable now);
  // "ingame" keeps only in-game; "any" keeps all.
  const statusOk = useMemo(() => {
    const s = prefs.status;
    if (s === "any") return () => true;
    return (r: RivenResult) =>
      s === "ingame" ? r.owner_status === "ingame" : r.owner_status !== "offline";
  }, [prefs.status]);

  const data = search.data;
  const rows = useMemo(() => {
    let rs = (data?.results ?? []).filter(test).filter(passesThresholds).filter(statusOk);
    const dir = prefs.sortDir === "asc" ? 1 : -1;
    const num = (v: number | null | undefined) =>
      v == null
        ? prefs.sortDir === "asc"
          ? Number.POSITIVE_INFINITY
          : Number.NEGATIVE_INFINITY
        : v;
    rs = [...rs].sort((a, b) => {
      switch (prefs.sortKey) {
        case "price":
          return dir * (num(priceOf(a)) - num(priceOf(b)));
        case "grade":
          return dir * (num(a.grade) - num(b.grade));
        default:
          // match: tier asc, then matched desc, then price asc — the backend order.
          return (
            a.match_tier - b.match_tier ||
            b.matched_positives - a.matched_positives ||
            num(priceOf(a)) - num(priceOf(b))
          );
      }
    });
    return rs;
  }, [data, test, passesThresholds, statusOk, prefs.sortKey, prefs.sortDir]);

  const setSort = (key: SortKey) =>
    patch(
      prefs.sortKey === key
        ? { sortDir: prefs.sortDir === "asc" ? "desc" : "asc" }
        : { sortKey: key, sortDir: key === "price" || key === "match" ? "asc" : "desc" },
    );
  const colSort = { key: prefs.sortKey, dir: prefs.sortDir };

  const copy = async (r: RivenResult) => {
    if (await copyText(whisperLine(r))) {
      setCopiedId(r.id);
      setTimeout(() => setCopiedId((k) => (k === r.id ? null : k)), 1500);
    }
  };

  const summary = data?.summary;
  return (
    <>
      <div className="statband">
        <StatBox
          k="Cheapest"
          v={summary?.min == null ? "—" : fmt(summary.min)}
          unit={summary?.min == null ? undefined : "p"}
        />
        <StatBox
          k="Median"
          v={summary?.median == null ? "—" : fmt(summary.median)}
          unit={summary?.median == null ? undefined : "p"}
        />
        <StatBox k="Matches" v={fmt(summary?.count ?? 0)} />
        <StatBox k="Disposition" v={weapon.disposition.toFixed(2)} />
        <StatBox k="Results" v={fmt(rows.length)} />
      </div>
      {data && !data.graded ? (
        <div className="muted" style={{ padding: "4px 2px" }}>
          Grades unavailable for this weapon (no disposition/base data) — shown as “—”.
        </div>
      ) : null}

      <div className="tpanel">
        <table className="dtable riven-rtable">
          <thead>
            <tr>
              <SortTh<SortKey> label="Match" col="match" sort={colSort} onSort={setSort} />
              <th>Stats</th>
              <SortTh<SortKey> label="Grade" col="grade" sort={colSort} onSort={setSort} right />
              <SortTh<SortKey> label="Price" col="price" sort={colSort} onSort={setSort} right />
              <th>Seller</th>
              <th>Status</th>
              <th className="r">MR</th>
              <th className="r">Whisper</th>
            </tr>
          </thead>
          <tbody>
            {search.isLoading || search.isError || rows.length === 0 ? (
              <TableStatus
                span={8}
                loading={search.isLoading}
                error={search.isError}
                loadingText="Searching auctions…"
                errorText="Couldn't load auctions. Try again in a moment."
                emptyText="No auctions match. Try fewer stats."
              />
            ) : (
              rows.map((r) => {
                const price = priceOf(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <span className={clsx("chip", r.match_tier === 0 && "pos")}>
                        {TIER_LABEL[r.match_tier] ?? "—"}
                      </span>
                    </td>
                    <td>
                      <div className="riven-stats">
                        {r.attributes.map((a) => (
                          <span
                            key={a.slug}
                            className={clsx(
                              "riven-stat",
                              a.positive ? "pos" : "neg",
                              a.wanted && "want",
                            )}
                            title={a.name}
                          >
                            {a.positive ? "+" : ""}
                            {a.value}
                            {a.unit === "percent" ? "%" : a.unit === "seconds" ? "s" : ""} {a.name}
                            {a.grade != null ? (
                              <b className="muted"> {Math.round(a.grade)}%</b>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="r num">
                      {r.grade == null ? "—" : <GradePill grade={r.grade} />}
                    </td>
                    <td className="r num">
                      {price == null ? "—" : `${fmt(price)}p`}
                      {r.is_direct_sell ? null : <span className="muted"> bid</span>}
                    </td>
                    <td>{r.owner_name}</td>
                    <td>
                      <span className={clsx("mkt-dot", r.owner_status)} /> {r.owner_status}
                    </td>
                    <td className="r num">{r.mastery_level}</td>
                    <td className="r">
                      <button type="button" className="btn sm" onClick={() => copy(r)}>
                        {copiedId === r.id ? "Copied!" : "Copy whisper"}
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

function GradePill({ grade }: { grade: number }) {
  const cls = grade >= 80 ? "pos" : grade >= 55 ? "" : "neg";
  return <span className={clsx("num", cls)}>{Math.round(grade)}%</span>;
}
