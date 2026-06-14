import { useMemo, useState } from "react";
import { ItemTags } from "../components/ItemTags";
import { ListingForm } from "../components/ListingForm";
import { Glyph, ItemName, Scrim, StatBox, TableStatus, rowAction } from "../components/ui";
import {
  useInventory,
  useListings,
  useSearchCatalog,
  useWfmAccount,
  useWfmApplyImport,
  useWfmConnect,
  useWfmDeleteOrder,
  useWfmMarkSold,
  useWfmRepriceApply,
  useWfmSetSession,
  useWfmSetStatus,
  useWfmSignout,
  useWfmSync,
  useWfmUpdateOrder,
} from "../hooks/queries";
import { useEscape } from "../hooks/useEscape";
import { wfmFetchListings, wfmRepricePreview } from "../lib/api";
import { CATEGORY_LABELS, clsx, fmt } from "../lib/format";
import { usePageSearch } from "../lib/searchContext";
import { compileQuery } from "../lib/searchQuery";
import { listingsSchema } from "../lib/searchSchemas";
import type { ImportRow, InventoryRow, ListingRow, RepriceRow } from "../lib/types";

// UI status segment → warframe.market API status; "Offline" = invisible.
const STATUS_OPTS = [
  { api: "invisible", label: "Invisible", dot: "offline" },
  { api: "online", label: "Online", dot: "online" },
  { api: "ingame", label: "In Game", dot: "ingame" },
] as const;

/** A pickable row (shared by the owned list and the catalog fallback). */
function PickRow({
  slug,
  name,
  sub,
  plat,
  thumb,
  onPick,
}: {
  slug: string;
  name: string;
  sub: string;
  plat: number | null;
  thumb: string | null;
  onPick: (slug: string) => void;
}) {
  return (
    <button type="button" className="sr-row" onClick={() => onPick(slug)}>
      <Glyph name={name} plat={plat} thumb={thumb} />
      <span className="sr-i">
        <span className="sr-n">{name}</span>
        <span className="sr-s">{sub}</span>
      </span>
      <span className="sr-p num">{plat == null ? "—" : `${fmt(plat)}p`}</span>
    </button>
  );
}

/** Pick an item to list — your inventory first (filterable), with a catalog
 *  fallback so you can still list something you don't currently track. */
function NewListingModal({
  onPick,
  onClose,
}: {
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const { data: inv = [] } = useInventory();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  useEscape(onClose);

  // Owned items, filtered by the query, richest first (what you'd most likely sell).
  const owned = useMemo(() => {
    const worth = (r: InventoryRow) =>
      r.realizable_plat ?? r.value_plat ?? (r.median_plat ?? 0) * r.qty;
    const matches = query
      ? inv.filter(
          (r) =>
            r.display_name.toLowerCase().includes(query) ||
            r.part_type.toLowerCase().includes(query),
        )
      : inv;
    return [...matches].sort((a, b) => worth(b) - worth(a));
  }, [inv, query]);

  // Fallback: catalog matches you don't own, so non-tracked items stay listable.
  const { data: catalog = [] } = useSearchCatalog(query.length >= 2 ? q.trim() : "");
  const others = useMemo(() => {
    if (query.length < 2) return [];
    const ownedSlugs = new Set(inv.map((r) => r.slug));
    return catalog.filter((r) => !ownedSlugs.has(r.slug)).slice(0, 8);
  }, [catalog, inv, query]);

  const empty = owned.length === 0 && others.length === 0;

  return (
    <Scrim onClose={onClose}>
      <div className="modal np-modal">
        <div className="modal-h">
          <h2>New listing</h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="search" style={{ margin: 14 }}>
          <input
            autoFocus
            placeholder="Filter your inventory…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="np-list">
          {empty ? (
            <div className="sr-empty">
              {query ? "Nothing matches — try fewer letters." : "Your inventory is empty."}
            </div>
          ) : null}
          {owned.map((r) => (
            <PickRow
              key={r.slug}
              slug={r.slug}
              name={r.display_name}
              sub={`${r.part_type} · ${CATEGORY_LABELS[r.category]} · own ×${r.qty}`}
              plat={r.median_plat}
              thumb={r.thumbnail_url}
              onPick={onPick}
            />
          ))}
          {others.length ? <div className="np-divider">Not in your inventory</div> : null}
          {others.map((r) => (
            <PickRow
              key={r.slug}
              slug={r.slug}
              name={r.display_name}
              sub={`${r.part_type} · ${CATEGORY_LABELS[r.category]}`}
              plat={r.median_plat}
              thumb={r.thumbnail_url}
              onPick={onPick}
            />
          ))}
        </div>
      </div>
    </Scrim>
  );
}

/** Step 1 of 2: connect by public username (validated against warframe.market). */
function SignInCard() {
  const connect = useWfmConnect();
  const [username, setUsername] = useState("");

  const submit = () => {
    const u = username.trim();
    if (u && !connect.isPending) connect.mutate(u);
  };

  return (
    <div className="tpanel" style={{ maxWidth: 520 }}>
      <div className="tpanel-h">
        <h3>Connect warframe.market</h3>
        <span style={{ flex: 1 }} />
        <span className="muted">Step 1 of 2</span>
      </div>
      <div className="content" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Read-only. WFIT imports your <b>listings</b> (orders), not your in-game inventory —
          there's no DE inventory API. This first step needs only your public username.
        </p>
        <div className="search" style={{ marginBottom: 8 }}>
          <input
            autoFocus
            placeholder="warframe.market username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <button
          type="button"
          className="btn pri"
          disabled={!username.trim() || connect.isPending}
          onClick={submit}
        >
          {connect.isPending ? "Checking…" : "Next →"}
        </button>
        {connect.isError ? (
          <div className="conn-note" style={{ marginTop: 8 }}>
            {(connect.error as Error).message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Step 2 of 2 (optional): paste the JWT cookie to unlock invisible orders + management. */
function SessionCard({ onSkip }: { onSkip: () => void }) {
  const setSession = useWfmSetSession();
  const [jwt, setJwt] = useState("");

  const submit = () => {
    const t = jwt.trim();
    if (t && !setSession.isPending) setSession.mutate(t, { onSuccess: () => setJwt("") });
  };

  return (
    <div className="tpanel" style={{ marginBottom: 12, maxWidth: 560 }}>
      <div className="tpanel-h">
        <h3>Add a session token</h3>
        <span style={{ flex: 1 }} />
        <span className="muted">Step 2 of 2 · optional</span>
      </div>
      <div className="content" style={{ padding: 14 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          You're connected read-only. To see <b>invisible</b> orders and to create, edit, delete, or
          set the status of orders, paste your warframe.market <b>JWT</b> cookie. No password is
          ever entered — it's stored only in your OS keychain, never the database.
        </p>
        <div className="grp" style={{ paddingLeft: 0 }}>
          Where to find your JWT
        </div>
        <ol className="muted" style={{ margin: "4px 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>
            Open <b>warframe.market</b> in your browser and log in.
          </li>
          <li>
            Open DevTools (<b>F12</b>, or <b>⌘⌥I</b>) → <b>Application</b> (Chrome) / <b>Storage</b>{" "}
            (Firefox) tab.
          </li>
          <li>
            <b>Cookies</b> → <b>https://warframe.market</b>.
          </li>
          <li>
            Copy the value of the <b>JWT</b> cookie (a long string starting <code>eyJ…</code>).
          </li>
          <li>Paste it below.</li>
        </ol>
        <div className="search" style={{ marginBottom: 8 }}>
          <input
            placeholder="paste JWT (eyJ…)"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <div className="lf-actions">
          <button
            type="button"
            className="btn pri"
            disabled={!jwt.trim() || setSession.isPending}
            onClick={submit}
          >
            {setSession.isPending ? "Validating…" : "Finish"}
          </button>
          <button type="button" className="btn" onClick={onSkip} disabled={setSession.isPending}>
            Skip — stay read-only
          </button>
        </div>
        {setSession.isError ? (
          <div className="conn-note" style={{ marginTop: 8 }}>
            {(setSession.error as Error).message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ImportPanel({ rows, onClose }: { rows: ImportRow[]; onClose: () => void }) {
  const apply = useWfmApplyImport();
  const [sel, setSel] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.slug, r.listed_qty])),
  );
  return (
    <div className="tpanel" style={{ marginBottom: 12 }}>
      <div className="tpanel-h">
        <h3>Review import — listings, not inventory</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">Listed</th>
            <th className="r">Have now</th>
            <th className="r">Import qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slug}>
              <td>{r.display_name}</td>
              <td className="r">{r.listed_qty}</td>
              <td className="r">{r.current_qty}</td>
              <td className="r">
                <input
                  type="number"
                  style={{
                    width: 48,
                    background: "var(--panel)",
                    color: "var(--ink)",
                    border: "1px solid var(--line-2)",
                  }}
                  value={sel[r.slug] ?? 0}
                  onChange={(e) =>
                    setSel((s) => ({ ...s, [r.slug]: Number.parseInt(e.target.value, 10) || 0 }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-f">
        <div className="info">Merge keeps your larger manual counts.</div>
        <span className="sp" style={{ flex: 1 }} />
        <button
          type="button"
          className="btn pri"
          onClick={() =>
            apply.mutate(
              Object.entries(sel)
                .filter(([, q]) => q > 0)
                .map(([slug, qty]) => ({ slug, qty })),
              { onSuccess: onClose },
            )
          }
        >
          Import selected
        </button>
      </div>
    </div>
  );
}

/** Preview + confirm a bulk reprice to the recommended (best) price per listing. */
function RepricePanel({ rows, onClose }: { rows: RepriceRow[]; onClose: () => void }) {
  const apply = useWfmRepriceApply();
  const changes = rows.filter((r) => r.new_price !== r.current_price);
  return (
    <div className="tpanel" style={{ marginBottom: 12 }}>
      <div className="tpanel-h">
        <h3>Reprice to best — review changes</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className="x" onClick={onClose}>
          ✕
        </button>
      </div>
      <table className="dtable">
        <thead>
          <tr>
            <th>Item</th>
            <th className="r">Current</th>
            <th className="r">New</th>
            <th className="r">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed = r.new_price !== r.current_price;
            const delta = r.current_price == null ? null : r.new_price - r.current_price;
            return (
              <tr key={r.order_id} className={changed ? undefined : "row-hidden"}>
                <td>
                  <ItemName
                    name={r.display_name}
                    plat={r.new_price}
                    thumb={r.thumbnail_url}
                    sub={r.part_type}
                  />
                </td>
                <td className="r num">{fmt(r.current_price)}p</td>
                <td className="r num">{fmt(r.new_price)}p</td>
                <td className="r num">
                  {delta == null || delta === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={delta > 0 ? "pos" : "neg"}>
                      {delta > 0 ? "+" : ""}
                      {fmt(delta)}p
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="modal-f">
        <div className="info">
          {changes.length} will change · {rows.length - changes.length} unchanged
        </div>
        <span className="sp" style={{ flex: 1 }} />
        {apply.isError ? (
          <span className="muted neg" style={{ marginRight: 8 }}>
            {(apply.error as Error).message}
          </span>
        ) : null}
        <button type="button" className="btn" onClick={onClose} disabled={apply.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className="btn pri"
          disabled={changes.length === 0 || apply.isPending}
          onClick={() =>
            apply.mutate(
              changes.map((r) => ({
                order_id: r.order_id,
                platinum: r.new_price,
                quantity: r.qty,
                visible: r.visible,
              })),
              { onSuccess: onClose },
            )
          }
        >
          {apply.isPending
            ? "Applying…"
            : `Apply ${changes.length} change${changes.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

export function Listings({ onOpen }: { onOpen: (slug: string) => void }) {
  const { data: account } = useWfmAccount();
  const { data: listings = [], isLoading, isError } = useListings();
  const sync = useWfmSync();
  const signout = useWfmSignout();
  const setStatus = useWfmSetStatus();
  const update = useWfmUpdateOrder();
  const del = useWfmDeleteOrder();
  const markSold = useWfmMarkSold();
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [repriceRows, setRepriceRows] = useState<RepriceRow[] | null>(null);
  const [repricing, setRepricing] = useState(false);
  const [creating, setCreating] = useState<string | null>(null); // slug being created
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<ListingRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  // Topbar query filters the table only; the stat band reflects all listings.
  const search = usePageSearch();
  const { test } = useMemo(() => compileQuery(search, listingsSchema), [search]);
  const view = useMemo(() => listings.filter(test), [listings, test]);

  if (!account?.connected) return <SignInCard />;

  // An expired token is treated as "no usable session": writes are gated off and
  // the re-paste card surfaces, exactly like having no token.
  const expired = account.has_session && account.session_expired;
  const session = account.has_session && !account.session_expired;
  const expiresAt = account.session_expires_at ? new Date(account.session_expires_at) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000) : null;
  const expiringSoon = session && daysLeft != null && daysLeft <= 14;
  const writeHint = expired
    ? "Session expired — paste a fresh token to manage orders"
    : session
      ? undefined
      : "Add a session token to manage orders";
  const active = listings.length;
  const listedValue = listings.reduce((s, l) => s + (l.your_price ?? 0) * l.qty, 0);
  const atBest = listings.filter(
    (l) => l.market_low != null && (l.your_price ?? 0) <= l.market_low,
  ).length;
  const undercut = listings.filter(
    (l) => l.market_low != null && (l.your_price ?? 0) > l.market_low,
  ).length;
  const dot = STATUS_OPTS.find((o) => o.api === account.status)?.dot ?? "offline";

  const toggleVisible = (l: ListingRow) =>
    update.mutate({
      orderId: l.order_id,
      platinum: l.your_price ?? 1,
      quantity: l.qty,
      visible: !l.visible,
    });

  return (
    <>
      <div className="conn">
        <span className={clsx("cdot", dot)} />
        <span className="cinfo">
          <b>{account.username}</b>
          {expired ? " · session expired" : session ? " · session active" : " · public · read-only"}
          {session && expiresAt ? (
            <span className="muted"> · expires {expiresAt.toLocaleDateString()}</span>
          ) : null}
        </span>
        <span className="seg" title={writeHint}>
          {STATUS_OPTS.map((o) => (
            <button
              key={o.api}
              type="button"
              className="segb"
              aria-pressed={account.status === o.api}
              disabled={!session || setStatus.isPending}
              onClick={() => setStatus.mutate(o.api)}
            >
              {o.label}
            </button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        {!session && sessionDismissed ? (
          <button type="button" className="btn sm" onClick={() => setSessionDismissed(false)}>
            Add session token
          </button>
        ) : null}
        <button
          type="button"
          className="btn pri sm"
          disabled={!session}
          title={writeHint}
          onClick={() => setPicking(true)}
        >
          + New listing
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={!session || repricing || listings.length === 0}
          title={writeHint}
          onClick={async () => {
            setRepricing(true);
            try {
              setRepriceRows(await wfmRepricePreview());
            } finally {
              setRepricing(false);
            }
          }}
        >
          {repricing ? "Pricing…" : "Set best prices"}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
        >
          {sync.isPending ? "Syncing…" : "Sync"}
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={async () => setImportRows(await wfmFetchListings())}
        >
          Import
        </button>
        <button type="button" className="btn sm" onClick={() => signout.mutate()}>
          Disconnect
        </button>
      </div>

      {setStatus.isError ? (
        <div className="conn-note" style={{ marginBottom: 12 }}>
          Couldn't set status: {(setStatus.error as Error).message}
        </div>
      ) : null}

      {importRows ? <ImportPanel rows={importRows} onClose={() => setImportRows(null)} /> : null}

      {repriceRows ? (
        <RepricePanel rows={repriceRows} onClose={() => setRepriceRows(null)} />
      ) : null}

      {expired ? (
        <div className="conn-note" style={{ marginBottom: 12 }}>
          Your warframe.market session has expired
          {expiresAt ? ` (${expiresAt.toLocaleDateString()})` : ""}. Paste a fresh JWT below to keep
          creating, editing, and selling orders.
        </div>
      ) : expiringSoon ? (
        <div className="conn-note" style={{ marginBottom: 12 }}>
          Your warframe.market session expires in {daysLeft} day{daysLeft === 1 ? "" : "s"} (
          {expiresAt?.toLocaleDateString()}). Disconnect and reconnect to refresh it with a new JWT.
        </div>
      ) : null}

      {!session && !sessionDismissed ? (
        <SessionCard onSkip={() => setSessionDismissed(true)} />
      ) : null}

      <div className="statband">
        <StatBox k="Active listings" v={fmt(active)} />
        <StatBox k="Listed value" v={fmt(listedValue)} unit="p" />
        <StatBox k="At best price" v={fmt(atBest)} dcls="pos" />
        <StatBox k="Undercut" v={fmt(undercut)} dcls="neg" />
      </div>

      <div className="tpanel">
        <table className="dtable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Your price</th>
              <th className="r">Qty</th>
              <th className="r">Value</th>
              <th className="r">Market low</th>
              <th>vs market</th>
              <th className="r">Manage</th>
            </tr>
          </thead>
          <tbody>
            {isLoading || isError || view.length === 0 ? (
              <TableStatus
                span={7}
                loading={isLoading}
                error={isError}
                emptyText={
                  <>
                    No sell orders found. Hit <b>Sync</b> to refresh from warframe.market
                    {session ? (
                      <>
                        , or <b>+ New listing</b> to post one.
                      </>
                    ) : (
                      "."
                    )}
                  </>
                }
              />
            ) : (
              view.map((l) => {
                const yp = l.your_price ?? 0;
                const best = l.market_low != null && yp <= l.market_low;
                const over = l.market_low != null && yp > l.market_low ? yp - l.market_low : 0;
                const confirming = confirmId === l.order_id;
                return (
                  <tr
                    key={l.order_id}
                    {...rowAction(() => onOpen(l.slug))}
                    className={l.visible ? undefined : "row-hidden"}
                  >
                    <td>
                      <ItemName
                        name={l.display_name}
                        plat={l.your_price}
                        thumb={l.thumbnail_url}
                        sub={l.part_type}
                        tags={<ItemTags trend={l.trend} vaulted={l.is_vaulted} />}
                      />
                    </td>
                    <td className="r num">{fmt(l.your_price)}p</td>
                    <td className="r num">{l.qty}</td>
                    <td className="r num">{fmt(yp * l.qty)}p</td>
                    <td className="r num">{fmt(l.market_low)}p</td>
                    <td>
                      {!l.visible ? (
                        <span className="badge">hidden</span>
                      ) : l.market_low == null ? (
                        <span className="muted">—</span>
                      ) : best ? (
                        <span className="badge at">best</span>
                      ) : (
                        <span className="badge above">+{fmt(over)}p over</span>
                      )}
                    </td>
                    <td
                      className="r"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {!session ? (
                        <span className="muted">—</span>
                      ) : confirming ? (
                        <span className="lf-actions">
                          <button
                            type="button"
                            className="btn sm warn"
                            disabled={del.isPending}
                            onClick={() =>
                              del.mutate(l.order_id, { onSuccess: () => setConfirmId(null) })
                            }
                          >
                            {del.isPending ? "…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="lf-actions">
                          <button
                            type="button"
                            className="btn sm pos"
                            disabled={markSold.isPending}
                            title="Sold one — drops qty by 1 on warframe.market and logs the sale"
                            onClick={() => markSold.mutate(l.order_id)}
                          >
                            {markSold.isPending ? "…" : "Sold"}
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={update.isPending}
                            title={l.visible ? "Hide from buyers" : "Show to buyers"}
                            onClick={() => toggleVisible(l)}
                          >
                            {l.visible ? "Hide" : "Show"}
                          </button>
                          <button type="button" className="btn sm" onClick={() => setEditing(l)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn sm warn"
                            onClick={() => setConfirmId(l.order_id)}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {picking ? (
        <NewListingModal
          onClose={() => setPicking(false)}
          onPick={(slug) => {
            setPicking(false);
            setCreating(slug);
          }}
        />
      ) : null}
      {creating ? <ListingForm slug={creating} onClose={() => setCreating(null)} /> : null}
      {editing ? (
        <ListingForm
          slug={editing.slug}
          edit={{
            orderId: editing.order_id,
            price: editing.your_price,
            qty: editing.qty,
            visible: editing.visible,
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
