import { useSummary } from "../hooks/queries";
import { fmt } from "../lib/format";
import { Icon } from "./Icon";

export type ScreenId =
  | "home"
  | "inventory"
  | "sets"
  | "trends"
  | "watchlist"
  | "buy"
  | "market"
  | "rivens"
  | "listings"
  | "ducats"
  | "arcanes"
  | "relics"
  | "rotation"
  | "account"
  | "sold"
  | "settings";

interface NavDef {
  id: ScreenId;
  label: string;
  icon: string;
}

// Grouped by workflow so the 12 screens read as a small set of intents rather
// than a flat list. A null `label` is an ungrouped lead item (Home).
const GROUPS: { label: string | null; items: NavDef[] }[] = [
  { label: null, items: [{ id: "home", label: "Home", icon: "home" }] },
  {
    label: "Portfolio",
    items: [
      { id: "inventory", label: "Inventory", icon: "inventory" },
      { id: "sets", label: "Sets", icon: "sets" },
      { id: "arcanes", label: "Arcanes", icon: "arcane" },
      { id: "relics", label: "Relics", icon: "box" },
      { id: "ducats", label: "Ducats", icon: "coin" },
    ],
  },
  {
    label: "Trading",
    items: [
      { id: "listings", label: "Listings", icon: "tag" },
      { id: "sold", label: "Sold History", icon: "history" },
      { id: "market", label: "Market", icon: "search" },
      { id: "rivens", label: "Riven Search", icon: "search" },
    ],
  },
  {
    label: "Planning",
    items: [
      { id: "watchlist", label: "Watchlist", icon: "watchlist" },
      { id: "buy", label: "Buy List", icon: "buy" },
      { id: "trends", label: "Trends", icon: "trends" },
    ],
  },
  {
    label: "World",
    items: [{ id: "rotation", label: "Rotation", icon: "timer" }],
  },
  {
    label: "Account",
    items: [{ id: "account", label: "Account", icon: "user" }],
  },
];

export function Sidebar({
  screen,
  onNavigate,
  onAdd,
  badges,
}: {
  screen: ScreenId;
  onNavigate: (id: ScreenId) => void;
  onAdd: () => void;
  badges: Partial<Record<ScreenId, number>>;
}) {
  const { data: summary } = useSummary();

  return (
    <aside className="sidebar">
      {/* Fixed-width inner column so content doesn't reflow while the width animates. */}
      <div className="sidebar-inner">
        {/* Top strip — Add items plus room for the floating collapse toggle
            (rendered in App); its border lines up with the topbar's. */}
        <div className="nav-top">
          <button type="button" className="nav-add" onClick={onAdd}>
            <Icon name="plus" /> Add items
          </button>
        </div>

        {GROUPS.map((g) => (
          <div className="nav-group" key={g.label ?? "home"}>
            {g.label ? <div className="nav-group-h">{g.label}</div> : null}
            {g.items.map((n) => (
              <button
                key={n.id}
                type="button"
                className="nav-item"
                aria-current={screen === n.id}
                onClick={() => onNavigate(n.id)}
              >
                <Icon name={n.icon} />
                {n.label}
                {badges[n.id] ? <span className="ct">{badges[n.id]}</span> : null}
              </button>
            ))}
          </div>
        ))}

        <div className="nav-sp" />

        <div className="qr">
          <div className="qr-h">Quick read</div>
          <div className="qr-row">
            <span>Hot parts</span>
            <b className="num">{fmt(summary?.hot_count ?? 0)}</b>
          </div>
          <div className="qr-row">
            <span>At watch target</span>
            <b className="num">{fmt(summary?.at_target_count ?? 0)}</b>
          </div>
          <div className="qr-row">
            <span>Sold · 7d</span>
            <b className="num">{fmt(summary?.sold_7d ?? 0)}p</b>
          </div>
        </div>

        <div className="nav-foot">
          <button
            type="button"
            className="nav-item"
            aria-current={screen === "settings"}
            onClick={() => onNavigate("settings")}
          >
            <Icon name="settings" />
            Settings
          </button>
        </div>
      </div>
    </aside>
  );
}
