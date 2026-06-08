import { useSummary } from "../hooks/queries";
import { fmt } from "../lib/format";
import { Icon } from "./Icon";

export type ScreenId =
  | "inventory"
  | "sets"
  | "trends"
  | "watchlist"
  | "buy"
  | "market"
  | "listings"
  | "ducats"
  | "arcanes"
  | "rotation"
  | "sold"
  | "settings";

interface NavDef {
  id: ScreenId;
  label: string;
  icon: string;
}

const NAV: NavDef[] = [
  { id: "inventory", label: "Inventory", icon: "inventory" },
  { id: "sets", label: "Sets", icon: "sets" },
  { id: "trends", label: "Trends", icon: "trends" },
  { id: "watchlist", label: "Watchlist", icon: "watchlist" },
  { id: "buy", label: "Buy List", icon: "buy" },
  { id: "market", label: "Market", icon: "search" },
  { id: "listings", label: "Listings", icon: "tag" },
  { id: "ducats", label: "Ducats", icon: "coin" },
  { id: "arcanes", label: "Arcanes", icon: "arcane" },
  { id: "rotation", label: "Rotation", icon: "timer" },
  { id: "sold", label: "Sold History", icon: "history" },
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

        {NAV.map((n) => (
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
