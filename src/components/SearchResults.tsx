import { useListedSlugs, useSearchCatalog } from "../hooks/queries";
import { CATEGORY_LABELS, fmt } from "../lib/format";
import { ItemTags } from "./ItemTags";
import { Glyph } from "./ui";

// "ininv:" or "inv:" scopes the search to owned items; "all:" is the explicit
// whole-catalog mode (the topbar otherwise filters the current page).
const INV_PREFIX = /^in?inv:\s*/i;
const MODE_PREFIX = /^(all|in?inv):\s*/i;

/** Global command-palette search over the whole tradable catalog. Clicking a
 *  result opens the item drawer (works for owned and non-owned alike). */
export function SearchResults({
  query,
  onOpen,
}: {
  query: string;
  onOpen: (slug: string) => void;
}) {
  const ownedOnly = INV_PREFIX.test(query);
  const q = query.replace(MODE_PREFIX, "").trim();
  const { data = [], isFetching } = useSearchCatalog(q);
  const listed = useListedSlugs();
  const rows = ownedOnly ? data.filter((r) => r.owned_qty > 0) : data;

  if (q.length < 2) {
    return (
      <div className="search-results">
        <div className="sr-empty">
          Type to search all items… (prefix with "ininv:" for inventory)
        </div>
      </div>
    );
  }

  return (
    <div className="search-results">
      {rows.length === 0 ? (
        <div className="sr-empty">
          {isFetching ? "Searching…" : ownedOnly ? "Nothing you own matches." : "No items match."}
        </div>
      ) : (
        rows.map((r) => (
          <button key={r.slug} type="button" className="sr-row" onClick={() => onOpen(r.slug)}>
            <Glyph name={r.display_name} plat={r.median_plat} thumb={r.thumbnail_url} />
            <span className="sr-i">
              <span className="sr-n">
                {r.display_name}
                <ItemTags trend={r.trend} vaulted={r.is_vaulted} listed={listed.has(r.slug)} />
              </span>
              <span className="sr-s">
                {r.part_type} · {CATEGORY_LABELS[r.category]}
                {r.owned_qty > 0 ? ` · owned ×${r.owned_qty}` : ""}
                {r.on_watchlist ? " · watched" : ""}
              </span>
            </span>
            <span className="sr-p num">
              {r.median_plat == null ? "—" : `${fmt(r.median_plat)}p`}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
