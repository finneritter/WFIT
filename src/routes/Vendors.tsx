import { useMemo } from "react";
import { Countdown } from "../components/Countdown";
import { BlockStatus, ItemName, rowAction } from "../components/ui";
import { useToggleVendorCheck, useVendorBoard } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { vendorsSchema } from "../lib/searchSchemas";
import type { VendorIntelRow, VendorPanel } from "../lib/types";

/**
 * The Vendors board: a horizontally-scrolling row of narrow vendor columns (Baro,
 * Varzia, Teshin), each headed by the vendor's name + arrival/departure countdown and
 * a slim check-off list of stock — item + a small plat value + a grabbed checkbox.
 * Items you own auto-check (from inventory / game-scan); anything else is a manual
 * tick. Click an item to open its market drawer.
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

  return (
    <div className="vboard-wrap">
      <div className="vboard">
        {panels.map((p) => (
          <VendorColumn key={p.key} panel={p} test={test} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function VendorColumn({
  panel,
  test,
  onOpen,
}: {
  panel: VendorPanel;
  test: (r: VendorIntelRow) => boolean;
  onOpen: (slug: string) => void;
}) {
  const toggle = useToggleVendorCheck();
  const rows = panel.rows.filter(test);

  return (
    <div className={clsx("vcol", panel.active && "on")}>
      <div className="vcol-h">
        <div className="vcol-top">
          <span className="vcol-title">{panel.name}</span>
          <span className={clsx("vcol-status", panel.active ? "live" : "away")}>
            {panel.active ? "● here" : "away"}
          </span>
        </div>
        <div className="vcol-meta">{panel.location ?? panel.character ?? ""}</div>
        <div className="vcol-timer num">
          <Countdown
            iso={panel.active ? panel.expiry : panel.activation}
            warnMs={12 * 3_600_000}
            soonMs={2 * 3_600_000}
          />
          <span className="tl">{panel.active ? "until departure" : "until arrival"}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="vcol-empty">
          {panel.rows.length === 0
            ? panel.active
              ? "No stock listed."
              : "Stock shows on arrival."
            : "Nothing matches."}
        </div>
      ) : (
        <table className="dtable vtbl">
          <tbody>
            {rows.map((r) => {
              const owned = r.check_source === "owned";
              return (
                <tr key={r.item_ref} className={clsx(r.checked && "checked")}>
                  <td className="chk">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      disabled={owned}
                      title={
                        owned
                          ? `Owned ×${r.owned_qty}`
                          : r.checked
                            ? "Grabbed — click to clear"
                            : "Mark grabbed"
                      }
                      onClick={(e) => e.stopPropagation()}
                      onChange={() =>
                        toggle.mutate({
                          vendorKey: panel.key,
                          itemRef: r.item_ref,
                          checked: !r.checked,
                        })
                      }
                    />
                    {r.median_plat != null ? (
                      <span className="vplat">{fmt(r.median_plat)}p</span>
                    ) : null}
                  </td>
                  <td {...(r.slug ? rowAction(() => onOpen(r.slug as string)) : {})}>
                    <ItemName name={r.item} plat={null} thumb={r.thumbnail_url} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
