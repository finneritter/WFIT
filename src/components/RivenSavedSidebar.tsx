// Right-side collapsible panel for riven saved searches (Riven screen only).
// Mirrors the left nav's collapse. Each row loads a saved search into the form,
// expands a quick peek of its criteria, toggles per-search notifications, or
// deletes it. Notifications are filed by the backend riven watcher.
import { useMemo, useState } from "react";
import {
  useDeleteRivenSearch,
  useRivenAttributes,
  useRivenSearches,
  useSetRivenNotify,
} from "../hooks/queries";
import { clsx } from "../lib/format";
import type { RivenSavedSearch } from "../lib/types";
import { Icon } from "./Icon";

const POLARITY_LABEL: Record<string, string> = {
  madurai: "Madurai",
  vazarin: "Vazarin",
  naramon: "Naramon",
};

export function RivenSavedSidebar({ onLoad }: { onLoad: (id: number) => void }) {
  const saved = useRivenSearches();
  const attributes = useRivenAttributes();
  const deleteSaved = useDeleteRivenSearch();
  const setNotify = useSetRivenNotify();
  const [expanded, setExpanded] = useState<number | null>(null);

  const attrName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes.data ?? []) m.set(a.slug, a.name);
    return m;
  }, [attributes.data]);
  const name = (slug: string) => attrName.get(slug) ?? slug;

  const rows = saved.data ?? [];

  return (
    <aside className="rsidebar">
      <div className="rsidebar-inner">
        <div className="rsidebar-h">
          <span>Saved searches</span>
          <span className="muted">{rows.length}</span>
        </div>
        <div className="rsidebar-list">
          {rows.length === 0 ? (
            <div className="rsidebar-empty">
              No saved searches yet. Build a search, then ★ Save it.
            </div>
          ) : (
            rows.map((s) => (
              <SavedRow
                key={s.id}
                s={s}
                name={name}
                expanded={expanded === s.id}
                onToggleExpand={() => setExpanded((id) => (id === s.id ? null : s.id))}
                onLoad={() => onLoad(s.id)}
                onDelete={() => deleteSaved.mutate(s.id)}
                onToggleNotify={() => setNotify.mutate({ id: s.id, enabled: !s.notify })}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function SavedRow({
  s,
  name,
  expanded,
  onToggleExpand,
  onLoad,
  onDelete,
  onToggleNotify,
}: {
  s: RivenSavedSearch;
  name: (slug: string) => string;
  expanded: boolean;
  onToggleExpand: () => void;
  onLoad: () => void;
  onDelete: () => void;
  onToggleNotify: () => void;
}) {
  const val = (slug: string) => {
    const v = s.min_values?.[slug];
    return v == null ? "" : ` ≥${v}`;
  };
  return (
    <div className={clsx("rsaved", expanded && "open")}>
      <div className="rsaved-top">
        <button
          type="button"
          className="rsaved-exp"
          title={expanded ? "Hide details" : "Show details"}
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <Icon name="chevron-down" />
        </button>
        <button type="button" className="rsaved-load" title="Load this search" onClick={onLoad}>
          {s.label || s.weapon}
        </button>
        <button
          type="button"
          className={clsx("rsaved-bell", s.notify && "on")}
          title={s.notify ? "Notifications on — click to mute" : "Notify when a match appears"}
          aria-pressed={s.notify}
          onClick={onToggleNotify}
        >
          <Icon name="bell" />
        </button>
        <button type="button" className="rsaved-del" title="Delete" onClick={onDelete}>
          ✕
        </button>
      </div>
      {expanded ? (
        <div className="rsaved-peek">
          <div className="rsp-row">
            <span className="muted">Weapon</span>
            <span>{s.weapon}</span>
          </div>
          <div className="rsp-row">
            <span className="muted">Positives</span>
            <span className="pos">
              {s.positives.length ? s.positives.map((p) => `${name(p)}${val(p)}`).join(", ") : "—"}
            </span>
          </div>
          <div className="rsp-row">
            <span className="muted">Negative</span>
            <span className="neg">
              {s.negative ? `${name(s.negative)}${val(s.negative)}` : "any"}
            </span>
          </div>
          <div className="rsp-row">
            <span className="muted">Polarity</span>
            <span>{s.polarity ? (POLARITY_LABEL[s.polarity] ?? s.polarity) : "any"}</span>
          </div>
          <div className="rsp-row">
            <span className="muted">Max rolls / MR</span>
            <span>
              {s.re_rolls_max ?? "∞"} / {s.mastery_rank_max ?? "∞"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
