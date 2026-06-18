// Account screen: scan-populated Profile · Codex · Resources · Arsenal. Reads the
// persisted snapshot (works game-closed); a "Scan account" action refreshes it from
// the running client. Mirrors the tabbed Relics/Rotation idiom; Resources + Arsenal
// are listing tabs wired to the topbar search.
import { useMemo } from "react";
import type { ScreenId } from "../components/Sidebar";
import { Chip, Glyph, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useAccountArsenal,
  useAccountCodex,
  useAccountProfile,
  useAccountResources,
  useAccountScan,
  useGameScanStatus,
} from "../hooks/queries";
import { useColumnSort } from "../hooks/useTable";
import { clsx, fmt, fmtK, relativeDay, syncedAgo } from "../lib/format";
import { usePersistedJSON } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { arsenalSchema, resourcesSchema } from "../lib/searchSchemas";
import type { AccountProfile, GearRow, ResourceRow } from "../lib/types";

type OpenFn = (slug: string) => void;
type NavFn = (s: ScreenId) => void;

const TABS = [
  ["profile", "Profile"],
  ["codex", "Codex"],
  ["resources", "Resources"],
  ["arsenal", "Arsenal"],
] as const;
type TabId = (typeof TABS)[number][0];

const CAT_LABEL: Record<string, string> = {
  warframe: "Warframes",
  primary: "Primaries",
  secondary: "Secondaries",
  melee: "Melee",
  companion: "Companions",
  archwing: "Archwing",
  necramech: "Necramechs",
  amp: "Amps",
  special: "Special",
  railjack: "Railjack",
};
const ARSENAL_CATS = [
  "warframe",
  "primary",
  "secondary",
  "melee",
  "companion",
  "archwing",
  "necramech",
] as const;

export function Account({ onOpen, onNavigate }: { onOpen: OpenFn; onNavigate: NavFn }) {
  const [tab, setTab] = usePersistedJSON<TabId>("account.tab", "profile");
  const { data: profile } = useAccountProfile();
  const { data: status } = useGameScanStatus();
  const scan = useAccountScan();

  const hasData = profile?.has_data ?? false;
  const canScan = (status?.supported && status?.consented && status?.warframe_running) ?? false;

  return (
    <>
      <div className="statband">
        <StatBox
          k="Mastery Rank"
          v={hasData ? (profile?.mastery_rank ?? 0) : "—"}
          d="from the game scan"
          dcls="muted"
        />
        <StatBox
          k="Platinum"
          v={hasData ? fmt(profile?.platinum) : "—"}
          unit="p"
          d={`${fmt(profile?.credits)} credits`}
          dcls="muted"
        />
        <StatBox
          k="Endo"
          v={hasData ? fmt(profile?.endo) : "—"}
          d={`${fmt(profile?.regal_aya)} regal aya`}
          dcls="muted"
        />
        <StatBox
          k="Last scan"
          v={profile?.scanned_at ? syncedAgo(profile.scanned_at) : "never"}
          d={canScan ? "game detected" : "open the game to scan"}
          dcls="muted"
        />
      </div>

      <div className="rot-tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="chip"
          disabled={!canScan || scan.isPending}
          onClick={() => scan.mutate()}
          title={
            canScan
              ? "Scan the running game and refresh account data"
              : "Needs consent + a running game (Settings → Game inventory)"
          }
        >
          {scan.isPending ? "Scanning…" : "Scan account"}
        </button>
      </div>

      {scan.isError ? (
        <div className="meta" style={{ padding: "0 0 8px", color: "var(--bad, #c66)" }}>
          {(scan.error as Error)?.message ?? "Scan failed."}
        </div>
      ) : null}

      {!hasData && tab !== "profile" ? (
        <EmptyScan onNavigate={onNavigate} />
      ) : tab === "profile" ? (
        <ProfileTab profile={profile} onNavigate={onNavigate} />
      ) : tab === "codex" ? (
        <CodexTab />
      ) : tab === "resources" ? (
        <ResourcesTab onOpen={onOpen} />
      ) : (
        <ArsenalTab onOpen={onOpen} />
      )}
    </>
  );
}

function EmptyScan({ onNavigate }: { onNavigate: NavFn }) {
  return (
    <div className="empty">
      No account scan yet. Open Warframe and use <b>Scan account</b> above (enable the game
      inventory scan first in{" "}
      <button type="button" className="lnk" onClick={() => onNavigate("settings")}>
        Settings
      </button>
      ).
    </div>
  );
}

// --------------------------------------------------------------------------- Profile

function ProfileTab({ profile, onNavigate }: { profile?: AccountProfile; onNavigate: NavFn }) {
  if (!profile?.has_data) return <EmptyScan onNavigate={onNavigate} />;
  const p = profile;
  const mrPct = p.mr_needed > 0 ? Math.min(100, (p.mr_into_next / p.mr_needed) * 100) : 0;
  const starPct = p.nodes_total > 0 ? Math.min(100, (p.nodes_completed / p.nodes_total) * 100) : 0;

  return (
    <div className="rot-grid">
      <div className="tpanel">
        <div className="tpanel-h">Profile</div>
        <div className="dnm" style={{ padding: "8px 0" }}>
          <Glyph name={p.equipped_glyph_name ?? "Operator"} plat={null} />
          <div className="di">
            <span className="nm">{p.equipped_glyph_name ?? "Tenno"}</span>
            <span className="sub">
              MR {p.mastery_rank}
              {p.created ? ` · joined ${relativeDay(p.created)}` : ""}
            </span>
          </div>
        </div>
        <Bar
          label={`MR ${p.mastery_rank} → ${p.mastery_rank + 1}`}
          pct={mrPct}
          note={`${fmt(p.mr_into_next)} / ${fmt(p.mr_needed)}`}
        />
        <div className="kv">
          <Kv k="Total mastery" v={fmt(p.total_mastery_points)} />
          <Kv k="Trades left today" v={`${p.trades_remaining}`} />
          <Kv k="Gifts left" v={`${p.gifts_remaining}`} />
          {p.alignment ? <Kv k="Alignment" v={p.alignment} /> : null}
        </div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">Wealth</div>
        <div className="kv">
          <Kv k="Platinum" v={`${fmt(p.platinum)}p`} />
          <Kv k="Credits" v={fmt(p.credits)} />
          <Kv k="Endo" v={fmt(p.endo)} />
          <Kv k="Regal Aya" v={fmt(p.regal_aya)} />
          <Kv k="Daily focus" v={fmt(p.daily_focus)} />
          <Kv k="Total focus" v={fmtK(p.focus_xp)} />
          <Kv k="Login milestones" v={`${p.login_streak}`} />
        </div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">Star chart</div>
        <Bar
          label="Nodes cleared"
          pct={starPct}
          note={`${fmt(p.nodes_completed)} / ${fmt(p.nodes_total)}`}
        />
        <div className="kv">
          <Kv k="Total missions run" v={fmt(p.total_missions)} />
        </div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">Intrinsics</div>
        {p.intrinsics.length ? (
          <div className="kv">
            {p.intrinsics.map((i) => (
              <Kv key={i.skill_key} k={i.label} v={`${i.rank}`} />
            ))}
          </div>
        ) : (
          <div className="muted">No intrinsics scanned.</div>
        )}
      </div>

      <div className="tpanel" style={{ gridColumn: "1 / -1" }}>
        <div className="tpanel-h">Syndicate standing</div>
        {p.syndicates.length ? (
          <div className="kv kv--wide">
            {p.syndicates.map((s) => (
              <Kv
                key={s.tag}
                k={s.label}
                v={`${fmt(s.standing)}${s.title ? ` · ${s.title}` : ""}`}
              />
            ))}
          </div>
        ) : (
          <div className="muted">No syndicate standing scanned.</div>
        )}
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-k">{k}</span>
      <b className="kv-v num">{v}</b>
    </div>
  );
}

function Bar({ label, pct, note }: { label: string; pct: number; note?: string }) {
  return (
    <div className="acc-bar">
      <div className="acc-bar-top">
        <span>{label}</span>
        {note ? <span className="muted num">{note}</span> : null}
      </div>
      <div className="acc-bar-track">
        <div className="acc-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Codex

function CodexTab() {
  const { data: codex } = useAccountCodex();
  if (!codex) return <div className="empty">Loading…</div>;
  const collPct = codex.total_items > 0 ? (codex.total_owned / codex.total_items) * 100 : 0;

  return (
    <div className="rot-grid">
      <div className="tpanel" style={{ gridColumn: "1 / -1" }}>
        <div className="tpanel-h">Collection</div>
        <Bar
          label="Owned of all masterable gear"
          pct={collPct}
          note={`${fmt(codex.total_owned)} / ${fmt(codex.total_items)} · ${fmt(codex.total_mastered)} mastered`}
        />
        <div className="muted" style={{ marginTop: 4 }}>
          {fmt(codex.total_mastery_points)} total mastery points
        </div>
      </div>

      {codex.categories.map((c) => {
        const pct = c.total > 0 ? (c.owned / c.total) * 100 : 0;
        return (
          <div className="tpanel" key={c.category}>
            <Bar
              label={CAT_LABEL[c.category] ?? c.category}
              pct={pct}
              note={`${c.owned} / ${c.total}`}
            />
            <div className="muted">{c.mastered} mastered</div>
          </div>
        );
      })}

      <div className="tpanel" style={{ gridColumn: "1 / -1" }}>
        <div className="tpanel-h">Cephalon Fragment / lore scans</div>
        {codex.lore_scans.length ? (
          <div className="kv kv--wide">
            {codex.lore_scans.map((l) => (
              <Kv key={l.display_name} k={l.display_name} v={`${l.scans}`} />
            ))}
          </div>
        ) : (
          <div className="muted">No lore scans found.</div>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Resources

function ResourcesTab({ onOpen }: { onOpen: OpenFn }) {
  const { data: rows = [], isLoading, isError } = useAccountResources();
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, resourcesSchema), [search]);
  const filtered = useMemo(() => rows.filter(test), [rows, test]);
  const { sort, cycle, apply } = useColumnSort<ResourceRow, "name" | "count">(
    "account.resources.sort",
    {
      name: (a, b) => a.display_name.localeCompare(b.display_name),
      count: (a, b) => a.count - b.count,
    },
    { key: "count", dir: "desc" },
  );
  const sorted = useMemo(() => apply(filtered), [filtered, apply]);

  return (
    <table className="dtable">
      <thead>
        <tr>
          <SortTh label="Resource" col="name" sort={sort} onSort={cycle} />
          <SortTh label="Count" col="count" sort={sort} onSort={cycle} right />
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <TableStatus
            span={2}
            loading={isLoading}
            error={isError}
            emptyText={
              rows.length === 0
                ? "No scan yet — scan from the Account tab."
                : "Nothing matches the filter."
            }
          />
        ) : (
          sorted.map((r) => (
            <tr
              key={r.unique_name}
              className={clsx(r.slug && "rowlink")}
              {...(r.slug ? rowAction(() => onOpen(r.slug as string)) : {})}
            >
              <td>
                <ItemName
                  name={r.display_name}
                  plat={null}
                  thumb={r.icon_url}
                  sub={r.kind === "resource" ? undefined : r.kind}
                />
              </td>
              <td className="r num">{fmt(r.count)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

// --------------------------------------------------------------------------- Arsenal

function ArsenalTab({ onOpen }: { onOpen: OpenFn }) {
  const { data: rows = [], isLoading, isError } = useAccountArsenal();
  const [cat, setCat] = usePersistedJSON<string>("account.arsenal.cat", "all");
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, arsenalSchema), [search]);
  const filtered = useMemo(
    () => rows.filter((r) => (cat === "all" || r.category === cat) && test(r)),
    [rows, cat, test],
  );
  const { sort, cycle, apply } = useColumnSort<GearRow, "name" | "rank">(
    "account.arsenal.sort",
    {
      name: (a, b) => a.display_name.localeCompare(b.display_name),
      rank: (a, b) => a.rank - b.rank,
    },
    { key: "name", dir: "asc" },
  );
  const sorted = useMemo(() => apply(filtered), [filtered, apply]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [rows]);

  return (
    <>
      <div className="filters">
        <Chip active={cat === "all"} onClick={() => setCat("all")} count={rows.length}>
          All
        </Chip>
        {ARSENAL_CATS.map((c) =>
          counts[c] ? (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)} count={counts[c]}>
              {CAT_LABEL[c]}
            </Chip>
          ) : null,
        )}
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <SortTh label="Item" col="name" sort={sort} onSort={cycle} />
            <th>Category</th>
            <SortTh label="Rank" col="rank" sort={sort} onSort={cycle} right />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <TableStatus
              span={3}
              loading={isLoading}
              error={isError}
              emptyText={
                rows.length === 0
                  ? "No scan yet — scan from the Account tab."
                  : "Nothing matches the filter."
              }
            />
          ) : (
            sorted.map((r) => (
              <tr
                key={`${r.category}:${r.unique_name}`}
                className={clsx(r.slug && "rowlink")}
                {...(r.slug ? rowAction(() => onOpen(r.slug as string)) : {})}
              >
                <td>
                  <ItemName
                    name={r.display_name}
                    plat={null}
                    thumb={r.icon_url}
                    tags={r.mastered ? <span className="tag tag-ok">mastered</span> : undefined}
                  />
                </td>
                <td className="muted">{CAT_LABEL[r.category] ?? r.category}</td>
                <td className="r num">
                  {r.rank}
                  <span className="muted">/{r.max_rank}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
