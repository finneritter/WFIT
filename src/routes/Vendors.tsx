import { useMemo } from "react";
import { Countdown } from "../components/Countdown";
import { BlockStatus, ItemName, rowAction } from "../components/ui";
import { useToggleVendorCheck, useVendorBoard } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { vendorsSchema } from "../lib/searchSchemas";
import type { VendorIntelRow, VendorPanel } from "../lib/types";

// Each currency owns a color accent + short label (shown once in the column header).
const CURRENCY: Record<string, { cls: string; label: string }> = {
  ducats: { cls: "ducat", label: "Ducats" },
  aya: { cls: "aya", label: "Aya" },
  steel_essence: { cls: "essence", label: "Essence" },
};

/**
 * The Vendors board: a full-width spreadsheet. Each vendor is a column that
 * stretches to fill the screen; items run down the column as `item · cost ·
 * grabbed-checkbox` rows, and empty cells keep drawing gridlines so the columns
 * stay aligned. Items you own auto-check; anything else is a manual tick. The
 * cost is what the vendor charges (currency named in the header); click an item
 * to open its market drawer.
 */
export function Vendors({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: panels, isLoading, isError } = useVendorBoard();
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, vendorsSchema), [search]);

  if (isLoading) return <BlockStatus text="Loading vendors…" />;
  if (isError || !panels)
    return (
      <BlockStatus error text="Couldn't reach the world-state. The rest of WFIT works offline." />
    );
  if (panels.length === 0) return <BlockStatus text="No vendors are active right now." />;

  const cols = panels.map((panel) => ({ panel, rows: panel.rows.filter(test) }));
  const bodyRows = Math.max(1, ...cols.map((c) => c.rows.length));

  return (
    <div className="vgrid-wrap">
      <div
        className="vgrid"
        style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
      >
        {cols.map(({ panel }, ci) => (
          <VendorHead key={panel.key} panel={panel} last={ci === cols.length - 1} />
        ))}
        {Array.from({ length: bodyRows }, (_, r) =>
          cols.map(({ panel, rows }, ci) => (
            <VendorCell
              key={`${panel.key}:${r}`}
              panel={panel}
              row={rows[r]}
              rowIndex={r}
              rowCount={rows.length}
              last={ci === cols.length - 1}
              onOpen={onOpen}
            />
          )),
        )}
      </div>
    </div>
  );
}

function VendorHead({ panel, last }: { panel: VendorPanel; last: boolean }) {
  const cur = CURRENCY[panel.currency];
  return (
    <div className={clsx("vhead", last && "lastcol")}>
      <div className="h1">
        <span className="hname">{panel.name}</span>
        <span className={clsx("hstatus", panel.active ? "live" : "away")}>
          {panel.active ? "● here" : "away"}
        </span>
      </div>
      <div className="hmeta">
        <span className="hcd num">
          <Countdown
            iso={panel.active ? panel.expiry : panel.activation}
            warnMs={12 * 3_600_000}
            soonMs={2 * 3_600_000}
          />
        </span>
        <span className="htl">{panel.active ? "until departure" : "until arrival"}</span>
        {(panel.location ?? panel.character) ? (
          <>
            <span className="hdot">·</span>
            <span className="hloc">{panel.location ?? panel.character}</span>
          </>
        ) : null}
        {cur ? (
          <>
            <span className="hdot">·</span>
            <span className="htl">pays {cur.label}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function VendorCell({
  panel,
  row,
  rowIndex,
  rowCount,
  last,
  onOpen,
}: {
  panel: VendorPanel;
  row: VendorIntelRow | undefined;
  rowIndex: number;
  rowCount: number;
  last: boolean;
  onOpen: (slug: string) => void;
}) {
  const toggle = useToggleVendorCheck();

  // Empty cell: keep the gridline, or show the away/no-stock note on the first row.
  if (!row) {
    const note =
      rowCount === 0 && rowIndex === 0
        ? panel.active
          ? "No stock listed."
          : "Stock shows on arrival."
        : null;
    return (
      <div className={clsx("vcell", "empty", last && "lastcol")}>
        {note ? <span className="awaynote">{note}</span> : null}
      </div>
    );
  }

  const cur = CURRENCY[panel.currency];
  const owned = row.check_source === "owned";

  return (
    <div className={clsx("vcell", row.checked && "checked", last && "lastcol")}>
      <div
        className={clsx("vcell-main", !row.slug && "static")}
        {...(row.slug ? rowAction(() => onOpen(row.slug as string)) : {})}
      >
        <ItemName name={row.item} plat={null} thumb={row.thumbnail_url} />
      </div>
      <span className={clsx("vcost num", cur?.cls)}>{row.cost != null ? fmt(row.cost) : ""}</span>
      <input
        type="checkbox"
        checked={row.checked}
        disabled={owned}
        title={
          owned
            ? `Owned ×${row.owned_qty}`
            : row.checked
              ? "Grabbed — click to clear"
              : "Mark grabbed"
        }
        onClick={(e) => e.stopPropagation()}
        onChange={() =>
          toggle.mutate({ vendorKey: panel.key, itemRef: row.item_ref, checked: !row.checked })
        }
      />
    </div>
  );
}
