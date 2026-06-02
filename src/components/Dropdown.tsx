// Compact toolbar dropdown — shared by the Inventory Category / Sort / View
// selectors. Button shows [icon] [current label] ▾; opens a menu of options with a
// ✓ on the active one; closes on outside click or select. (Spec §4.6.)
import { useEffect, useState } from "react";
import { clsx } from "../lib/format";
import { Icon } from "./Icon";

/** Option tuple: [value, label, optionalIconName]. */
export type DropdownOption = readonly [string, string, string?];

export function Dropdown({
  icon,
  value,
  options,
  onChange,
  align = "left",
  title,
}: {
  icon?: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const cur = options.find((o) => o[0] === value) ?? options[0];
  const btnIcon = cur[2] ?? icon; // per-option icon (View) wins, else the static prop

  return (
    // stopPropagation on the buttons keeps the opening click from reaching the
    // window outside-click listener (React flushes the effect mid-dispatch).
    <div className="viewsel">
      <button
        type="button"
        className="viewbtn"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {btnIcon ? <Icon name={btnIcon} /> : null}
        <b>{cur[1]}</b>
        <span className="cv">▾</span>
      </button>
      {open ? (
        <div className={clsx("viewmenu", align === "right" && "r")}>
          {options.map(([k, label, ic]) => (
            <button
              key={k}
              type="button"
              className={clsx("viewopt", k === value && "on")}
              onClick={(e) => {
                e.stopPropagation();
                onChange(k);
                setOpen(false);
              }}
            >
              {ic ? <Icon name={ic} /> : null}
              <span>{label}</span>
              {k === value ? <span className="ck">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
