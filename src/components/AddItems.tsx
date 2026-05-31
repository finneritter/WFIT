import { useMemo, useState } from "react";
import { useAddToInventory, useCatalog, useRemoveItem, useSetQty } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import type { CatalogRow } from "../lib/types";

const COLUMNS: { cat: string; label: string; grouped: boolean }[] = [
  { cat: "warframe", label: "Warframe", grouped: true },
  { cat: "weapon", label: "Weapon", grouped: true },
  { cat: "set", label: "Sets", grouped: false },
  { cat: "mod", label: "Mods", grouped: false },
  { cat: "arcane", label: "Arcanes", grouped: false },
];

function prettySet(setSlug: string): string {
  return setSlug
    .replace(/_set$/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Stepper({ slug, qty }: { slug: string; qty: number }) {
  const setQ = useSetQty();
  const remove = useRemoveItem();
  const change = (next: number) => {
    if (next <= 0) remove.mutate(slug);
    else setQ.mutate({ slug, qty: Math.min(99, next) });
  };
  return (
    <div className="qstep" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => change(qty - 1)}>
        −
      </button>
      <span className="qn">{qty}</span>
      <button type="button" onClick={() => change(qty + 1)}>
        +
      </button>
    </div>
  );
}

function Row({ row, leaf = false }: { row: CatalogRow; leaf?: boolean }) {
  const add = useAddToInventory();
  const remove = useRemoveItem();
  const owned = row.owned_qty > 0;
  const toggle = () => {
    if (owned) remove.mutate(row.slug);
    else add.mutate({ slug: row.slug });
  };
  return (
    <div className={clsx("crow", owned && "on", leaf && "leaf")} onClick={toggle}>
      <span className="cb">{owned ? "✓" : ""}</span>
      <span className="cn">{leaf ? row.part_type : row.display_name}</span>
      {owned ? (
        <Stepper slug={row.slug} qty={row.owned_qty} />
      ) : (
        <span className="cp">{row.median_plat == null ? "—" : `${fmt(row.median_plat)}p`}</span>
      )}
    </div>
  );
}

function GroupedColumn({ rows, filter }: { rows: CatalogRow[]; filter: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const map = new Map<string, CatalogRow[]>();
    for (const r of rows) {
      const key = r.set_slug ?? r.slug;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort((a, b) => prettySet(a[0]).localeCompare(prettySet(b[0])));
  }, [rows]);

  const q = filter.trim().toLowerCase();
  return (
    <>
      {groups.map(([setSlug, parts]) => {
        const name = prettySet(setSlug);
        const match =
          !q || name.toLowerCase().includes(q) || parts.some((p) => p.display_name.toLowerCase().includes(q));
        if (!match) return null;
        const ownedCount = parts.filter((p) => p.owned_qty > 0).length;
        const isOpen = open[setSlug] ?? !!q;
        return (
          <div className="agrp" key={setSlug}>
            <div
              className={clsx("agrp-h", ownedCount > 0 && "has")}
              onClick={() => setOpen((o) => ({ ...o, [setSlug]: !isOpen }))}
            >
              <span className="tw">{isOpen ? "▾" : "▸"}</span>
              <span className="gn">{name}</span>
              <span className="gc">
                {ownedCount}/{parts.length}
              </span>
            </div>
            {isOpen
              ? parts
                  .sort((a, b) => a.display_name.localeCompare(b.display_name))
                  .map((p) => <Row key={p.slug} row={p} leaf />)
              : null}
          </div>
        );
      })}
    </>
  );
}

function Column({ def, filter }: { def: (typeof COLUMNS)[number]; filter: string }) {
  const { data: rows = [], isLoading } = useCatalog(def.cat);
  const q = filter.trim().toLowerCase();
  const owned = rows.filter((r) => r.owned_qty > 0).length;

  return (
    <div className="acol">
      <div className="acol-h">
        <h4>{def.label}</h4>
        <span className="ct">
          {owned}/{rows.length}
        </span>
      </div>
      <div className="acol-b">
        {isLoading ? (
          <div className="acol-empty">Loading…</div>
        ) : def.grouped ? (
          <GroupedColumn rows={rows} filter={filter} />
        ) : (
          rows
            .filter((r) => !q || r.display_name.toLowerCase().includes(q))
            .map((r) => <Row key={r.slug} row={r} />)
        )}
      </div>
    </div>
  );
}

export function AddItems({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState("");
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>Add items</h2>
          <div className="search">
            <input
              autoFocus
              placeholder="Filter all columns…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-cols">
          {COLUMNS.map((def) => (
            <Column key={def.cat} def={def} filter={filter} />
          ))}
        </div>
        <div className="modal-f">
          <div className="info">Click a row to toggle owned; use the stepper for quantity.</div>
          <div className="sp" />
          <button type="button" className="btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
