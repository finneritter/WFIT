import { useMemo } from "react";
import { Countdown } from "../components/Countdown";
import { BlockStatus, ItemName, rowAction } from "../components/ui";
import { useToggleVendorCheck, useVendorBoard } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { vendorsSchema } from "../lib/searchSchemas";
import type { VendorIntelRow, VendorPanel } from "../lib/types";

// Each currency owns a color accent, a header label, and a short per-cell unit.
// The unit only renders in mixed-currency columns (Varzia: aya relics + regal-aya
// frames/packs — regal is the real-money currency, hence its own loud color).
const CURRENCY: Record<string, { cls: string; label: string; unit: string }> = {
  ducats: { cls: "ducat", label: "Ducats", unit: "dc" },
  aya: { cls: "aya", label: "Aya", unit: "aya" },
  regal_aya: { cls: "regal", label: "Regal Aya", unit: "regal" },
  steel_essence: { cls: "essence", label: "Essence", unit: "ess" },
};

/** Distinct row currencies, stable order (aya before regal). Falls back to the
 *  panel's primary currency when there's no stock to inspect (away vendors). */
function panelCurrencies(panel: VendorPanel): string[] {
  const seen = [...new Set(panel.rows.map((r) => r.currency))].filter((c) => CURRENCY[c]);
  return seen.length > 0 ? seen.sort() : [panel.currency];
}

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

  const cols = panels.map((panel) => ({
    panel,
    rows: panel.rows.filter(test),
    mixed: panelCurrencies(panel).length > 1,
  }));
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
          cols.map(({ panel, rows, mixed }, ci) => (
            <VendorCell
              key={`${panel.key}:${r}`}
              panel={panel}
              row={rows[r]}
              rowIndex={r}
              rowCount={rows.length}
              showUnit={mixed}
              last={ci === cols.length - 1}
              onOpen={onOpen}
            />
          )),
        )}
        {cols.map(({ panel, rows }, ci) => (
          <VendorFoot
            key={`${panel.key}:foot`}
            panel={panel}
            rows={rows}
            last={ci === cols.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

/** Sticky column footer: grabbed progress + what the rest would cost. Totals
 *  follow the topbar search — they describe the rows you can see. */
function VendorFoot({
  panel,
  rows,
  last,
}: {
  panel: VendorPanel;
  rows: VendorIntelRow[];
  last: boolean;
}) {
  const grabbed = rows.filter((r) => r.checked).length;
  // Remaining spend, grouped per currency — Varzia's aya + regal totals must not
  // be summed into one number (different currencies, one of them real-money).
  const remaining = new Map<string, number>();
  for (const r of rows) {
    if (r.checked || r.cost == null) continue;
    remaining.set(r.currency, (remaining.get(r.currency) ?? 0) + r.cost);
  }
  const parts = [...remaining.entries()]
    .filter(([c, sum]) => sum > 0 && CURRENCY[c])
    .sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className={clsx("vfoot", last && "lastcol")}>
      {rows.length > 0 ? (
        <>
          <span className="fgrab num">
            {grabbed}/{rows.length}
          </span>
          <span className="flbl">grabbed</span>
          {parts.map(([c, sum]) => {
            const cur = CURRENCY[c];
            return (
              <span key={c} className="fpart">
                <span className="fdot">·</span>
                <span className={clsx("fcost num", cur.cls)}>{fmt(sum)}</span>
                <span className="flbl">{cur.label.toLowerCase()}</span>
              </span>
            );
          })}
          {parts.length > 0 ? <span className="flbl">to go</span> : null}
        </>
      ) : null}
    </div>
  );
}

function VendorHead({ panel, last }: { panel: VendorPanel; last: boolean }) {
  const payLabels = panelCurrencies(panel)
    .map((c) => CURRENCY[c]?.label)
    .filter(Boolean);
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
        {payLabels.length > 0 ? (
          <>
            <span className="hdot">·</span>
            <span className="htl">pays {payLabels.join(" · ")}</span>
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
  showUnit,
  last,
  onOpen,
}: {
  panel: VendorPanel;
  row: VendorIntelRow | undefined;
  rowIndex: number;
  rowCount: number;
  showUnit: boolean;
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

  const cur = CURRENCY[row.currency] ?? CURRENCY[panel.currency];
  const owned = row.check_source === "owned";

  return (
    <div
      className={clsx(
        "vcell",
        row.checked && "checked",
        !panel.active && "away-col",
        last && "lastcol",
      )}
    >
      <div
        className={clsx("vcell-main", !row.slug && "static")}
        {...(row.slug ? rowAction(() => onOpen(row.slug as string)) : {})}
      >
        <ItemName
          name={row.item}
          plat={row.median_plat}
          thumb={row.thumbnail_url}
          tags={
            <>
              {row.good_deal ? <span className="itag itag-deal">DEAL</span> : null}
              {owned && row.owned_qty > 1 ? (
                <span className="itag itag-qty num">×{row.owned_qty}</span>
              ) : null}
            </>
          }
        />
      </div>
      <span className={clsx("vcost num", cur?.cls)}>
        {row.cost != null ? fmt(row.cost) : ""}
        {showUnit && row.cost != null && cur ? <span className="vunit">{cur.unit}</span> : null}
      </span>
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
