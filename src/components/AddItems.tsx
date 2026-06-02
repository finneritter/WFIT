import { createContext, memo, useContext, useDeferredValue, useMemo, useState } from "react";
import {
  useAddToBuyList,
  useAddToInventory,
  useAddWatch,
  useCatalog,
  useRemoveBuy,
  useRemoveItem,
  useRemoveWatch,
  useSetBuyQty,
  useSetQty,
} from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import type { CatalogRow } from "../lib/types";

// Which list the picker adds to — follows the screen it was opened from.
export type AddTarget = "inventory" | "watchlist" | "buy";

const COLUMNS: { cat: string; label: string; grouped: boolean }[] = [
  { cat: "warframe", label: "Warframe", grouped: true },
  { cat: "weapon", label: "Weapon", grouped: true },
  { cat: "set", label: "Sets", grouped: false },
  { cat: "mod", label: "Mods", grouped: false },
  { cat: "arcane", label: "Arcanes", grouped: false },
];

const TITLE: Record<AddTarget, string> = {
  inventory: "Add items",
  watchlist: "Add to watchlist",
  buy: "Add to buy list",
};

// Mutations are hoisted to the modal and shared via context so the ~1.7k catalog
// rows don't each instantiate their own hooks. `target` selects which list.
interface ItemHandlers {
  target: AddTarget;
  add: (slug: string) => void;
  remove: (slug: string) => void;
  setQty: (slug: string, qty: number) => void;
}
const HandlersCtx = createContext<ItemHandlers | null>(null);
const useHandlers = () => useContext(HandlersCtx) as ItemHandlers;

function prettySet(setSlug: string): string {
  return setSlug
    .replace(/_set$/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Part label = display name minus the set prefix, so the picker shows
 *  "Neuroptics Blueprint" / "Chassis Blueprint" instead of a generic "Blueprint". */
function partLabel(displayName: string, setName: string): string {
  return displayName.startsWith(`${setName} `)
    ? displayName.slice(setName.length + 1)
    : displayName;
}

/** Whether a row counts as "in the active list". */
function isActive(row: CatalogRow, target: AddTarget): boolean {
  if (target === "watchlist") return row.on_watchlist;
  if (target === "buy") return row.buy_qty > 0;
  return row.owned_qty > 0;
}

const Stepper = memo(function Stepper({ slug, qty }: { slug: string; qty: number }) {
  const h = useHandlers();
  const change = (next: number) => {
    if (next <= 0) h.remove(slug);
    else h.setQty(slug, Math.min(99, next));
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
});

const Row = memo(function Row({
  row,
  leaf = false,
  label,
}: {
  row: CatalogRow;
  leaf?: boolean;
  label?: string;
}) {
  const h = useHandlers();
  const active = isActive(row, h.target);
  // Watchlist membership is binary (no qty); inventory/buy use a qty stepper.
  const qty = h.target === "buy" ? row.buy_qty : row.owned_qty;
  const showStepper = active && h.target !== "watchlist";
  const toggle = () => (active ? h.remove(row.slug) : h.add(row.slug));
  return (
    <div className={clsx("crow", active && "on", leaf && "leaf")} onClick={toggle}>
      <span className="cb">{active ? "✓" : ""}</span>
      {row.thumbnail_url ? (
        <img className="crow-ic" src={row.thumbnail_url} alt="" loading="lazy" />
      ) : null}
      <span className="cn">{leaf ? (label ?? row.part_type) : row.display_name}</span>
      {showStepper ? (
        <Stepper slug={row.slug} qty={qty} />
      ) : (
        <span className="cp">{row.median_plat == null ? "—" : `${fmt(row.median_plat)}p`}</span>
      )}
    </div>
  );
});

function GroupedColumn({ rows, filter }: { rows: CatalogRow[]; filter: string }) {
  const h = useHandlers();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const map = new Map<string, CatalogRow[]>();
    for (const r of rows) {
      const key = r.set_slug ?? r.slug;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const parts of map.values())
      parts.sort((a, b) => a.display_name.localeCompare(b.display_name));
    return [...map.entries()].sort((a, b) => prettySet(a[0]).localeCompare(prettySet(b[0])));
  }, [rows]);

  const q = filter.trim().toLowerCase();
  return (
    <>
      {groups.map(([setSlug, parts]) => {
        const name = prettySet(setSlug);
        const match =
          !q ||
          name.toLowerCase().includes(q) ||
          parts.some((p) => p.display_name.toLowerCase().includes(q));
        if (!match) return null;
        const activeCount = parts.filter((p) => isActive(p, h.target)).length;
        const isOpen = open[setSlug] ?? !!q;
        return (
          <div className="agrp" key={setSlug}>
            <div
              className={clsx("agrp-h", activeCount > 0 && "has")}
              onClick={() => setOpen((o) => ({ ...o, [setSlug]: !isOpen }))}
            >
              <span className={clsx("tw", isOpen && "open")}>▸</span>
              <span className="gn">{name}</span>
              <span className="gc">
                {activeCount}/{parts.length}
              </span>
            </div>
            {isOpen
              ? parts.map((p) => (
                  <Row key={p.slug} row={p} leaf label={partLabel(p.display_name, name)} />
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}

function Column({ def, filter }: { def: (typeof COLUMNS)[number]; filter: string }) {
  const h = useHandlers();
  const { data: rows = [], isLoading } = useCatalog(def.cat);
  const q = filter.trim().toLowerCase();
  const active = rows.filter((r) => isActive(r, h.target)).length;

  return (
    <div className="acol">
      <div className="acol-h">
        <h4>{def.label}</h4>
        <span className="ct">
          {active}/{rows.length}
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

export function AddItems({
  onClose,
  target = "inventory",
}: {
  onClose: () => void;
  target?: AddTarget;
}) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);

  const invAdd = useAddToInventory();
  const invRemove = useRemoveItem();
  const invQty = useSetQty();
  const watchAdd = useAddWatch();
  const watchRemove = useRemoveWatch();
  const buyAdd = useAddToBuyList();
  const buyRemove = useRemoveBuy();
  const buyQty = useSetBuyQty();

  const handlers = useMemo<ItemHandlers>(() => {
    if (target === "watchlist")
      return {
        target,
        add: (slug) => watchAdd.mutate({ slug }),
        remove: (slug) => watchRemove.mutate(slug),
        setQty: () => {},
      };
    if (target === "buy")
      return {
        target,
        add: (slug) => buyAdd.mutate({ slug }),
        remove: (slug) => buyRemove.mutate(slug),
        setQty: (slug, qty) => buyQty.mutate({ slug, qty }),
      };
    return {
      target,
      add: (slug) => invAdd.mutate({ slug }),
      remove: (slug) => invRemove.mutate(slug),
      setQty: (slug, qty) => invQty.mutate({ slug, qty }),
    };
  }, [
    target,
    invAdd.mutate,
    invRemove.mutate,
    invQty.mutate,
    watchAdd.mutate,
    watchRemove.mutate,
    buyAdd.mutate,
    buyRemove.mutate,
    buyQty.mutate,
  ]);

  const info =
    target === "watchlist"
      ? "Click a row to add/remove it from your watchlist."
      : target === "buy"
        ? "Click a row to add it to the buy list; use the stepper for quantity."
        : "Click a row to toggle owned; use the stepper for quantity.";

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>{TITLE[target]}</h2>
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
        <HandlersCtx.Provider value={handlers}>
          <div className="modal-cols">
            {COLUMNS.map((def) => (
              <Column key={def.cat} def={def} filter={deferredFilter} />
            ))}
          </div>
        </HandlersCtx.Provider>
        <div className="modal-f">
          <div className="info">{info}</div>
          <div className="sp" />
          <button type="button" className="btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
