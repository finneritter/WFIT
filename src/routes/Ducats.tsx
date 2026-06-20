import { useMemo } from "react";
import { ItemTags } from "../components/ItemTags";
import { Chip, ItemName, SortTh, StatBox, TableStatus, rowAction } from "../components/ui";
import { useDucats, useListedSlugs } from "../hooks/queries";
import { useColumnSort, usePaged } from "../hooks/useTable";
import { clsx, fmt } from "../lib/format";
import { usePersisted } from "../lib/persist";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { ducatsSchema } from "../lib/searchSchemas";
import type { DucatRow } from "../lib/types";

const TRASH_PLAT = 8; // the "trash-tier" cutoff used in the stat band
const HIGH_DP = 10; // d/p at/above which dissolving clearly beats selling

type DucatCol = "name" | "qty" | "plat" | "ducats" | "dp";
const DUCAT_CMP: Record<DucatCol, (a: DucatRow, b: DucatRow) => number> = {
  name: (a, b) => a.display_name.localeCompare(b.display_name),
  qty: (a, b) => a.qty - b.qty,
  plat: (a, b) => (a.median_plat ?? 0) - (b.median_plat ?? 0),
  ducats: (a, b) => a.ducats - b.ducats,
  dp: (a, b) => (a.ducats_per_plat ?? 0) - (b.ducats_per_plat ?? 0),
};

export function Ducats({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: rows = [], isLoading, isError } = useDucats();
  const listed = useListedSlugs();
  const search = usePageSearch();
  const [highDp, setHighDp] = usePersisted<"1" | "0">("wfit-duc-highdp", "0");
  const [trash, setTrash] = usePersisted<"1" | "0">("wfit-duc-trash", "0");
  const [vaulted, setVaulted] = usePersisted<"1" | "0">("wfit-duc-vault", "0");
  const { sort, cycle, apply } = useColumnSort<DucatRow, DucatCol>("wfit-duc-sort", DUCAT_CMP, {
    key: "dp",
    dir: "desc",
  });

  const stats = useMemo(() => {
    const invDucats = rows.reduce((s, r) => s + r.ducats * r.qty, 0);
    const trashRows = rows.filter((r) => (r.median_plat ?? 0) <= TRASH_PLAT);
    const trashDucats = trashRows.reduce((s, r) => s + r.ducats * r.qty, 0);
    const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.ducats, 0) / rows.length) : 0;
    return { invDucats, trashDucats, trashCount: trashRows.length, avg };
  }, [rows]);

  const { test } = useMemo(() => compileQuery(search, ducatsSchema), [search]);
  const view = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (highDp === "1" && (r.ducats_per_plat ?? 0) < HIGH_DP) return false;
      if (trash === "1" && (r.median_plat ?? 0) > TRASH_PLAT) return false;
      if (vaulted === "1" && !r.is_vaulted) return false;
      return test(r);
    });
    return apply(filtered);
  }, [rows, highDp, trash, vaulted, test, apply]);
  const { visible, hasMore, shown, total, more } = usePaged(
    view,
    60,
    `${highDp}|${trash}|${vaulted}|${search}|${sort ? sort.key + sort.dir : ""}`,
  );

  return (
    <>
      <div className="statband">
        <StatBox k="Inventory ducats" v={fmt(stats.invDucats)} unit="d" />
        <StatBox k="Trash-tier ducats" v={fmt(stats.trashDucats)} unit="d" />
        <StatBox k="Trash candidates" v={fmt(stats.trashCount)} />
        <StatBox k="Avg ducats/part" v={fmt(stats.avg)} unit="d" />
      </div>

      <div className="mkt-filters">
        <Chip active={highDp === "1"} onClick={() => setHighDp(highDp === "1" ? "0" : "1")}>
          d/p ≥ {HIGH_DP}
        </Chip>
        <Chip active={trash === "1"} onClick={() => setTrash(trash === "1" ? "0" : "1")}>
          Trash ≤ {TRASH_PLAT}p
        </Chip>
        <Chip active={vaulted === "1"} onClick={() => setVaulted(vaulted === "1" ? "0" : "1")}>
          Vaulted
        </Chip>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Best ducat value</h3>
        </div>
        <table className="dtable">
          <thead>
            <tr>
              <SortTh<DucatCol> label="Part" col="name" sort={sort} onSort={cycle} />
              <SortTh<DucatCol> label="Qty" col="qty" sort={sort} onSort={cycle} right />
              <SortTh<DucatCol> label="Plat" col="plat" sort={sort} onSort={cycle} right />
              <SortTh<DucatCol> label="Ducats" col="ducats" sort={sort} onSort={cycle} right />
              <SortTh<DucatCol> label="d/p" col="dp" sort={sort} onSort={cycle} right />
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || visible.length === 0 ? (
              <TableStatus
                span={6}
                loading={isLoading}
                error={isError}
                emptyText="Own some prime parts to see ducat efficiency."
              />
            ) : (
              visible.map((r) => (
                <tr key={r.slug} {...rowAction(() => onOpen(r.slug))}>
                  <td>
                    <ItemName
                      name={r.display_name}
                      plat={r.median_plat}
                      thumb={r.thumbnail_url}
                      sub={r.part_type}
                      tags={
                        <ItemTags
                          trend={r.trend}
                          vaulted={r.is_vaulted}
                          listed={listed.has(r.slug)}
                        />
                      }
                    />
                  </td>
                  <td className="r num">×{fmt(r.qty)}</td>
                  <td className="r">{fmt(r.median_plat)}p</td>
                  <td className="r">{fmt(r.ducats)}d</td>
                  <td className="r num">
                    {r.ducats_per_plat == null ? "—" : r.ducats_per_plat.toFixed(1)}
                  </td>
                  <td>
                    <span className={clsx("badge", r.verdict === "ducat" && "at")}>
                      {r.verdict === "ducat" ? "ducat it" : "sell for plat"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {hasMore ? (
          <button type="button" className="btn load-more" onClick={more}>
            Showing {shown} of {fmt(total)} — load more
          </button>
        ) : null}
      </div>
    </>
  );
}
