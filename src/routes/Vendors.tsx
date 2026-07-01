import { useMemo, useState } from "react";
import { Countdown } from "../components/Countdown";
import { BlockStatus, Chip, ItemName, rowAction } from "../components/ui";
import { useClearVendorChecks, useToggleVendorCheck, useVendorBoard } from "../hooks/queries";
import { clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { vendorsSchema } from "../lib/searchSchemas";
import type { VendorIntelRow, VendorPanel } from "../lib/types";

// Each currency owns a color accent on its cost column (matches the Rotation tokens).
const CURRENCY: Record<string, { label: string; cls: string }> = {
  ducats: { label: "Ducats", cls: "v-ducat" },
  aya: { label: "Aya", cls: "v-aya" },
  steel_essence: { label: "Essence", cls: "v-essence" },
};

/**
 * The Vendors board: a horizontally-scrolling row of vendor columns (Baro, Varzia,
 * Teshin), each with its own countdown and a check-off spreadsheet of stock. Items
 * you own auto-check (from inventory / game-scan); anything else is a manual tick.
 */
export function Vendors({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: panels, isLoading, isError } = useVendorBoard();
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, vendorsSchema), [search]);
  const [hideChecked, setHideChecked] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);

  if (isLoading) return <BlockStatus text="Loading vendors…" />;
  if (isError || !panels)
    return (
      <BlockStatus error text="Couldn't reach the world-state. The rest of WFIT works offline." />
    );
  if (panels.length === 0) return <BlockStatus text="No vendors are active right now." />;

  return (
    <div className="vboard-wrap">
      <div className="filters">
        <Chip active={dealsOnly} onClick={() => setDealsOnly((v) => !v)}>
          Deals only
        </Chip>
        <Chip active={hideChecked} onClick={() => setHideChecked((v) => !v)}>
          Hide grabbed
        </Chip>
        <span className="sp" />
        <span className="hint">Owned items auto-check · tick the rest yourself</span>
      </div>
      <div className="vboard">
        {panels.map((p) => (
          <VendorColumn
            key={p.key}
            panel={p}
            test={test}
            hideChecked={hideChecked}
            dealsOnly={dealsOnly}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function VendorColumn({
  panel,
  test,
  hideChecked,
  dealsOnly,
  onOpen,
}: {
  panel: VendorPanel;
  test: (r: VendorIntelRow) => boolean;
  hideChecked: boolean;
  dealsOnly: boolean;
  onOpen: (slug: string) => void;
}) {
  const toggle = useToggleVendorCheck();
  const clear = useClearVendorChecks();
  const cur = CURRENCY[panel.currency] ?? { label: panel.currency, cls: "" };

  const rows = panel.rows.filter(
    (r) => test(r) && (!hideChecked || !r.checked) && (!dealsOnly || r.good_deal),
  );
  const gotCount = panel.rows.filter((r) => r.checked).length;

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
        <div className="vcol-btm">
          <div className="vcol-timer num">
            <Countdown
              iso={panel.active ? panel.expiry : panel.activation}
              warnMs={12 * 3_600_000}
              soonMs={2 * 3_600_000}
            />
            <span className="tl">{panel.active ? "until departure" : "until arrival"}</span>
          </div>
          <div className="vcol-got">
            <span className="num">
              {gotCount}/{panel.rows.length}
            </span>{" "}
            got
            {gotCount > 0 ? (
              <button type="button" className="lnk" onClick={() => clear.mutate(panel.key)}>
                Clear
              </button>
            ) : null}
          </div>
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
          <thead>
            <tr>
              <th className="chk" aria-label="grabbed" />
              <th>Item</th>
              <th className="r">Value</th>
              <th className="r">{cur.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const owned = r.check_source === "owned";
              return (
                <tr
                  key={r.item_ref}
                  className={clsx(r.checked && "checked", r.good_deal && "vdeal")}
                >
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
                  </td>
                  <td {...(r.slug ? rowAction(() => onOpen(r.slug as string)) : {})}>
                    <ItemName
                      name={r.item}
                      plat={r.median_plat}
                      thumb={r.thumbnail_url}
                      tags={
                        <>
                          {r.good_deal ? <span className="deal-tag">DEAL</span> : null}
                          {r.owned_qty > 0 ? (
                            <span className="owned-tag">OWNED ×{r.owned_qty}</span>
                          ) : null}
                        </>
                      }
                    />
                  </td>
                  <td className="r num">
                    {r.median_plat != null ? `${fmt(r.median_plat)}p` : "—"}
                  </td>
                  <td className={clsx("r num", cur.cls)}>{fmt(r.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
