import type { Trend } from "../lib/types";

/** The HOT / VAULT / LISTED badges, shared across every screen that lists items.
 *  Inline spans meant to sit next to an item name (inside the `.nm` span on the
 *  shared `.dtable`, or the search-result subtitle). HOT = price trending up;
 *  VAULT = no longer farmable; LISTED = you have an active warframe.market sell
 *  order. Renders nothing when none apply. The matching styles are the unscoped
 *  `.itag*` classes in theme.css — the Inventory grid/chip/list views keep their
 *  own bespoke markup. */
export function ItemTags({
  trend,
  vaulted,
  listed,
}: {
  trend?: Trend | null;
  vaulted?: boolean;
  listed?: boolean;
}) {
  const hot = trend === "up";
  if (!hot && !vaulted && !listed) return null;
  return (
    <>
      {hot ? <span className="itag itag-hot">▲ HOT</span> : null}
      {vaulted ? <span className="itag itag-vault">VAULT</span> : null}
      {listed ? <span className="itag itag-listed">LISTED</span> : null}
    </>
  );
}
