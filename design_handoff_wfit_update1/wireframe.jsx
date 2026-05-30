const { useState, useMemo } = React;

/* ============================== market sync ============================== */
const MARKET = { source: "warframe.market", syncedAgo: "2m ago", platform: "PC" };

/* ============================== data ==============================
   Built DIM-style: every prime FRAME/WEAPON explodes into its parts,
   so the grid fills with tiles like a real item manager. Each tile is
   one ownable thing with a platinum value, a 7d trend, qty, flags. */

const FRAMES = [
["Mesa", 50, true], ["Saryn", 46, true], ["Octavia", 40, true],
["Wisp", 34, false], ["Khora", 30, false], ["Volt", 18, false],
["Nova", 16, true], ["Baruuk", 38, false], ["Gauss", 28, false],
["Protea", 42, true], ["Dagath", 36, true], ["Gara", 20, false],
["Ember", 24, false], ["Nezha", 22, false], ["Rhino", 26, false],
["Loki", 32, false], ["Trinity", 14, false], ["Frost", 20, false],
["Mag", 12, false], ["Nyx", 16, false], ["Equinox", 44, true],
["Mirage", 30, false], ["Nidus", 48, true], ["Harrow", 40, false],
["Revenant", 34, false], ["Titania", 28, false]];

const WEAPONS = [
["Aksomati", 22, false], ["Nikana", 30, true], ["Pyrana", 26, false],
["Karyst", 12, false], ["Tatsu", 18, false], ["Fragor", 16, false],
["Boltor", 14, false], ["Soma", 20, false], ["Braton", 10, false],
["Vasto", 12, false], ["Lex", 16, false], ["Orthos", 18, false],
["Scindo", 14, false], ["Galatine", 24, true]];

const SETS = [
["Inaros Prime", 180, true], ["Wisp Prime", 165, false], ["Khora Prime", 140, false],
["Saryn Prime", 130, true], ["Gauss Prime", 120, false], ["Protea Prime", 145, true],
["Volt Prime", 90, false], ["Rhino Prime", 75, false], ["Nezha Prime", 70, false],
["Garuda Prime", 95, true], ["Ember Prime", 110, false], ["Loki Prime", 130, false],
["Frost Prime", 85, false], ["Mag Prime", 65, false], ["Nyx Prime", 70, false],
["Mirage Prime", 105, true], ["Equinox Prime", 125, false], ["Titania Prime", 90, false],
["Revenant Prime", 100, false], ["Nidus Prime", 135, true], ["Harrow Prime", 115, false]];

const MODS = [
["Primed Sure Footed", 60, true], ["Primed Continuity", 35, true], ["Primed Flow", 28, false],
["Galvanized Aptitude", 22, false], ["Primed Pressure Pt", 18, false], ["Primed Bane", 14, false],
["Primed Fury", 12, false], ["Stretch", 8, false], ["Primed Vigor", 45, true],
["Primed Reach", 40, false], ["Primed Point Blank", 30, false], ["Primed Target Cracker", 25, false],
["Primed Ravage", 38, false], ["Primed Shred", 42, true], ["Primed Fast Hands", 16, false],
["Primed Heavy Trauma", 20, false], ["Primed Chilling Grasp", 22, false]];

const ARCANES = [
["Arcane Energize", 140, true], ["Arcane Grace", 95, false], ["Arcane Avenger", 75, false],
["Arcane Guardian", 30, false], ["Arcane Nullifier", 12, false], ["Arcane Tanker", 16, false],
["Arcane Aegis", 22, false], ["Arcane Velocity", 55, true], ["Arcane Arachne", 14, false],
["Arcane Barrier", 65, false], ["Arcane Strike", 18, false], ["Arcane Fury", 24, false],
["Arcane Resistance", 10, false], ["Arcane Pulse", 12, false], ["Arcane Healing", 16, false],
["Arcane Acceleration", 28, false], ["Arcane Rage", 70, true]];


const WF_PARTS = ["Blueprint", "Neuroptics", "Chassis", "Systems"];
const WP_PARTS = ["Blueprint", "Barrel", "Receiver", "Stock"];
const DUC = [15, 45, 65, 45];
const PART_MULT = [0.32, 0.26, 0.20, 0.40];

// deterministic pseudo-random from a string seed
function seed(str) {let h = 0;for (let i = 0; i < str.length; i++) h = h * 31 + str.charCodeAt(i) >>> 0;return h;}
function genSpark(d) {
  // build a 7-point spark trending in the sign of d
  const dir = d >= 0 ? 1 : -1,mag = Math.min(8, Math.abs(d) / 3 + 2);
  const pts = [];let y = 10 - dir * mag * 0.5;
  for (let i = 0; i < 7; i++) {y += dir * (mag / 6) + (seed("s" + d + i) % 5 - 2) * 0.4;pts.push(`${i * 14},${Math.max(2, Math.min(20, y)).toFixed(1)}`);}
  return pts.join(" ");
}

function makePart(frame, base, fhot, part, i, cat) {
  const id = frame + " " + part;
  const s = seed(id);
  const plat = Math.max(5, Math.round(base * PART_MULT[i]));
  const d = s % 41 - 14; // -14..+26
  const qty = 1 + s % 4; // 1..4
  const listed = s % 5 === 0;
  const hot = fhot && i === 0; // headline part of a hot frame trends
  return { id, name: frame + " Prime", part, cat, plat, duc: DUC[i], qty, d, hot, listed, sold: false, spark: genSpark(d) };
}
function single(name, plat, hot, cat, partLabel) {
  const s = seed(name);
  const d = hot ? 8 + s % 16 : s % 31 - 12;
  return { id: name, name, part: partLabel, cat, plat, duc: 0, qty: 1 + s % 3, d, hot, listed: s % 4 === 0, sold: false, spark: genSpark(d) };
}

function buildCatalog() {
  const out = [];
  FRAMES.forEach(([f, b, h]) => WF_PARTS.forEach((p, i) => out.push(makePart(f, b, h, p, i, "Warframe"))));
  WEAPONS.forEach(([f, b, h]) => WP_PARTS.forEach((p, i) => out.push(makePart(f, b, h, p, i, "Weapon"))));
  SETS.forEach(([n, b, h]) => out.push(single(n, b, h, "Set", "Full set")));
  MODS.forEach(([n, b, h]) => out.push(single(n, b, h, "Mod", "Mod · R10")));
  ARCANES.forEach(([n, b, h]) => out.push(single(n, b, h, "Arcane", "Arcane · R5")));
  return out;
}
// full tradeable universe; the inventory is the subset the user owns
const CATALOG = buildCatalog();
function initialOwned() {return CATALOG.filter((c) => seed(c.id + "own") % 10 < 7).map((c) => ({ ...c }));}

// watchlist: parts you're tracking to buy, with a target buy price.
// target >= current price ⇒ "at target" (good time to buy).
const WATCH_SEED = [
["Inaros Prime", 1.06], ["Loki Prime", 0.85], ["Equinox Prime", 1.03], ["Primed Shred", 0.8],
["Arcane Energize", 0.9], ["Khora Blueprint", 1.12], ["Nikana Blueprint", 0.88], ["Mirage Prime", 0.94],
["Primed Reach", 1.04]];
function buildWatch() {
  return WATCH_SEED.map(([id, f]) => {const c = CATALOG.find((x) => x.id === id);return c ? { ...c, target: Math.round(c.plat * f) } : null;}).filter(Boolean);
}

// sold ledger — historical realized sales, newest by daysAgo.
const SALES = [
{ name: "Saryn Prime", part: "Full set", cat: "Set", qty: 1, plat: 132, daysAgo: 1 },
{ name: "Mesa Prime", part: "Blueprint", cat: "Warframe", qty: 1, plat: 18, daysAgo: 1 },
{ name: "Arcane Energize", part: "Arcane · R5", cat: "Arcane", qty: 1, plat: 138, daysAgo: 2 },
{ name: "Wisp Prime", part: "Neuroptics", cat: "Warframe", qty: 2, plat: 14, daysAgo: 3 },
{ name: "Primed Continuity", part: "Mod · R10", cat: "Mod", qty: 1, plat: 34, daysAgo: 4 },
{ name: "Gauss Prime", part: "Full set", cat: "Set", qty: 1, plat: 118, daysAgo: 6 },
{ name: "Nikana Prime", part: "Blueprint", cat: "Weapon", qty: 1, plat: 30, daysAgo: 8 },
{ name: "Khora Prime", part: "Chassis", cat: "Warframe", qty: 3, plat: 9, daysAgo: 9 },
{ name: "Protea Prime", part: "Full set", cat: "Set", qty: 1, plat: 142, daysAgo: 11 },
{ name: "Arcane Velocity", part: "Arcane · R5", cat: "Arcane", qty: 1, plat: 52, daysAgo: 13 },
{ name: "Primed Flow", part: "Mod · R10", cat: "Mod", qty: 2, plat: 26, daysAgo: 15 },
{ name: "Volt Prime", part: "Systems", cat: "Warframe", qty: 1, plat: 16, daysAgo: 18 }];
const relDate = (d) => d === 0 ? "today" : d === 1 ? "yesterday" : d + "d ago";

const SECTIONS = [
{ id: "Warframe", label: "Warframe Parts", letter: "W" },
{ id: "Weapon", label: "Weapon Parts", letter: "G" },
{ id: "Set", label: "Full Sets", letter: "S" },
{ id: "Mod", label: "Primed Mods", letter: "M" },
{ id: "Arcane", label: "Arcanes", letter: "A" }];


function tier(plat) {return plat >= 120 ? "exotic" : plat >= 45 ? "legend" : plat >= 15 ? "rare" : "basic";}
const fmt = (n) => n.toLocaleString("en-US");
const initials = (name) => name.replace(/ Prime.*/, "").replace(/^(Primed|Arcane|Galvanized)\s*/, "").trim().slice(0, 2).toUpperCase();

/* ============================== icons ============================== */
function Icon({ name, size = 15 }) {
  const p = {
    inventory: <React.Fragment><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></React.Fragment>,
    trends: <React.Fragment><path d="M4 4v16h16" /><path d="M7 14l4-5 3 3 5-7" /></React.Fragment>,
    history: <React.Fragment><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></React.Fragment>,
    watchlist: <path d="M12 4l2.5 5 5.5.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.5-.7z" />,
    settings: <React.Fragment><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></React.Fragment>,
    search: <React.Fragment><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></React.Fragment>,
    refresh: <React.Fragment><path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" /><path d="M20 4v4h-4M4 20v-4h4" /></React.Fragment>,
    coin: <React.Fragment><circle cx="12" cy="12" r="8" /><path d="M9 12h6M12 9v6" /></React.Fragment>,
    box: <React.Fragment><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 9h16" /></React.Fragment>,
    tag: <React.Fragment><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8" cy="8" r="1.4" /></React.Fragment>,
    sold: <React.Fragment><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 7v10l8 4 8-4V7" /></React.Fragment>,
    sets: <React.Fragment><rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" /><rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" /></React.Fragment>,
    buy: <React.Fragment><path d="M4 4h2l2 12h10l2-8H7" /><circle cx="9" cy="20" r="1.2" /><circle cx="18" cy="20" r="1.2" /></React.Fragment>,
    timer: <React.Fragment><circle cx="12" cy="13" r="8" /><path d="M12 13V9" /><path d="M9.5 2h5" /></React.Fragment>
  }[name];
  return <svg viewBox="0 0 24 24" width={size} height={size} style={{ width: size, height: size, flex: "none", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>{p}</svg>;
}

/* ============================== tile ============================== */
function Tile({ it, onOpen }) {
  const t = tier(it.plat);
  const tr = it.d > 1 ? "up" : it.d < -1 ? "down" : "flat";
  return (
    <div className={"tile t-" + t + (it.sold ? " sold" : "")} title={`${it.name} — ${it.part}\n${it.plat} p · ${it.d >= 0 ? "+" : ""}${it.d}% 7d · ×${it.qty}`} onClick={() => onOpen(it)}>
      <span className="ct-tl">{it.hot ? "▲" : ""}</span>
      {it.qty > 1 ? <span className="qty">×{it.qty}</span> : null}
      <span className="glyph">{initials(it.name)}</span>
      <span className={"trend " + tr}></span>
      <span className="vbar"><span className="pl">{it.plat}p</span></span>
    </div>);

}

/* ============================== section ============================== */
function Section({ sec, items, onOpen }) {
  const [open, setOpen] = useState(true);
  const tot = items.reduce((a, x) => a + x.plat * x.qty, 0);
  return (
    <div className="section">
      <div className="sec-h" onClick={() => setOpen((o) => !o)}>
        <span className="tw">{open ? "▾" : "▸"}</span>
        <h2>{sec.label}</h2>
        <span className="ct">{items.length}</span>
        <span className="tot">stack value <b>{fmt(tot)} p</b></span>
      </div>
      {open ?
      items.length === 0 ?
      <div className="empty">No parts match.</div> :
      <div className="grid">{items.map((it) => <Tile key={it.id} it={it} onOpen={onOpen} />)}</div> :
      null}
    </div>);

}

/* ============================== big chart ============================== */
function BigChart({ points, h = 150 }) {
  const w = 392,padX = 8,top = 10,bot = h - 18;
  const arr = points.split(" ").map((pr) => {const [x, y] = pr.split(",").map(Number);return { x: padX + x / 84 * (w - padX * 2), y: top + (1 - y / 21) * (bot - top) };});
  const line = arr.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = line + ` L${arr[arr.length - 1].x.toFixed(1)},${bot} L${arr[0].x.toFixed(1)},${bot} Z`;
  const grid = [0, 1, 2, 3].map((i) => top + i * ((bot - top) / 3));
  return (
    <svg viewBox={`0 0 ${w} ${h}`}>
      {grid.map((y, i) => <line key={i} x1={padX} y1={y} x2={w - padX} y2={y} stroke="var(--line)" strokeWidth="1" />)}
      <path d={area} fill="var(--accent)" opacity="0.12" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {arr.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.6" fill="var(--bg-2)" stroke="var(--accent)" strokeWidth="1.6" />)}
    </svg>);

}

/* ============================== detail drawer ============================== */
function Drawer({ it, onClose, onLogSale, onAddWatch, onAddBuy, onListMarket, watched, owned, listed }) {
  const [tf, setTf] = useState("7d");
  if (!it) return null;
  const t = tier(it.plat);
  const low = Math.round(it.plat * 0.82),high = Math.round(it.plat * 1.15);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-h">
          <span className={"ph tile t-" + t} style={{ cursor: "default" }}><span className="glyph">{initials(it.name)}</span></span>
          <div style={{ minWidth: 0 }}>
            <div className="nm">{it.name}</div>
            <div className="sub">{it.part} · {it.cat}</div>
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="price-row">
          <div className="big">{it.plat}<span className="u"> p</span></div>
          <div className={"num " + (it.d >= 0 ? "pos" : "neg")} style={{ fontSize: 14 }}>{it.d >= 0 ? "▲" : "▼"} {Math.abs(it.d)}%</div>
        </div>
        <div className="price-sub">current platinum value · {tf} change</div>
        <div className="chart">
          <div className="chart-tf">{["24h", "7d", "30d", "90d"].map((x) => <button key={x} className="chip" aria-pressed={tf === x} onClick={() => setTf(x)}>{x}</button>)}</div>
          <BigChart points={it.spark} />
        </div>
        <div className="dgrid">
          <div className="cell"><div className="k">You own</div><div className="v">×{it.qty}</div></div>
          <div className="cell"><div className="k">Ducat value</div><div className="v">{it.duc > 0 ? it.duc + " d" : "—"}</div></div>
          <div className="cell"><div className="k">7d range</div><div className="v">{low}–{high} p</div></div>
          <div className="cell"><div className="k">Stack value</div><div className="v">{fmt(it.plat * it.qty)} p</div></div>
        </div>
        <div className="drawer-actions">
          {owned ?
          <button className="btn pri" onClick={() => onLogSale(it)}>Sell 1 · {it.plat}p</button> :
          <button className="btn pri" onClick={() => onAddBuy(it)}>Add to buy list</button>}
          {owned ? <button className="btn" disabled={listed} onClick={() => onListMarket(it)}>{listed ? "Listed" : "List on market"}</button> : null}
          <button className="btn" disabled={watched} onClick={() => onAddWatch(it)}>{watched ? "On watchlist" : "Add to watchlist"}</button>
        </div>
      </div>
    </div>);

}

/* ============================== sidebar ============================== */
const NAV = [
{ id: "inventory", label: "Inventory", icon: "inventory" },
{ id: "sets", label: "Sets", icon: "sets" },
{ id: "trends", label: "Trends", icon: "trends" },
{ id: "watchlist", label: "Watchlist", icon: "watchlist" },
{ id: "buy", label: "Buy List", icon: "buy" },
{ id: "listings", label: "Listings", icon: "tag" },
{ id: "ducats", label: "Ducats", icon: "coin" },
{ id: "rotation", label: "Rotation", icon: "timer" },
{ id: "history", label: "Sold History", icon: "history" }];

function Sidebar({ screen, setScreen, counts, onAdd }) {
  return (
    <aside className="sidebar">
      <div className="brand"><b>WFIT</b><span className="sub">item tracker</span></div>
      <div className="syncbar">
        <span className="dot"></span>
        <span className="src">{MARKET.source}</span>
        <span className="ago">{MARKET.syncedAgo}</span>
      </div>
      <button className="nav-add" onClick={onAdd}>+ Add items</button>
      {NAV.map((n) =>
      <button key={n.id} className="nav-item" aria-current={screen === n.id} onClick={() => setScreen(n.id)}>
          <Icon name={n.icon} /><span>{n.label}</span>
          {counts[n.id] != null ? <span className="ct">{counts[n.id]}</span> : null}
        </button>
      )}
      <div className="qr">
        <div className="qr-h">Quick read</div>
        <div className="qr-row"><span>Hot parts</span><b>{counts.hot}</b></div>
        <div className="qr-row"><span>At watch target</span><b>2</b></div>
        <div className="qr-row"><span>Sold · 7d</span><b>6 · 248 p</b></div>
      </div>
      <div className="nav-sp"></div>
      <div className="nav-foot">
        <button className="nav-item"><Icon name="settings" /><span>Settings</span></button>
      </div>
    </aside>);

}

/* ============================== stat band (small boxes) ============================== */
function StatBand({ items }) {
  const plat = items.reduce((a, x) => a + x.plat * x.qty, 0);
  const duc = items.reduce((a, x) => a + x.duc * x.qty, 0);
  const parts = items.reduce((a, x) => a + x.qty, 0);
  const distinct = new Set(items.map((x) => x.id)).size;
  const hot = items.filter((x) => x.hot).length;
  const wAvg = items.reduce((a, x) => a + x.d * x.plat, 0) / (items.reduce((a, x) => a + x.plat, 0) || 1);
  const Box = (k, v, u, cls) =>
  <div className="statbox"><div className="k">{k}</div><div className={"v num" + (cls ? " " + cls : "")}>{v}{u ? <span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> {u}</span> : null}</div></div>;

  return (
    <div className="statband">
      {Box("Total Platinum", fmt(plat), "p")}
      {Box("Total Ducats", fmt(duc), "d")}
      {Box("Parts", parts, distinct + " distinct")}
      {Box("Portfolio 7d", (wAvg >= 0 ? "+" : "") + wAvg.toFixed(1) + "%", "", wAvg >= 0 ? "pos" : "neg")}
      {Box("Hot", hot, "trending")}
      {Box("Sold · 7d", "248", "p · 6")}
    </div>);

}

/* ============================== inventory screen ============================== */
const FILTERS = ["All", "Hot", "Warframe", "Weapon", "Set", "Mod", "Arcane"];
const SORTS = ["Value ▾", "Value ▴", "Trend ▾", "Name"];

function Inventory({ items, onOpen }) {
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("Value ▾");
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const match = (it) => {
    if (query && !(it.name + " " + it.part + " " + it.cat).toLowerCase().includes(query)) return false;
    if (filter === "All") return true;
    if (filter === "Hot") return it.hot;
    return it.cat === filter;
  };
  const sorter = (a, b) =>
  sort === "Value ▾" ? b.plat - a.plat :
  sort === "Value ▴" ? a.plat - b.plat :
  sort === "Trend ▾" ? b.d - a.d :
  a.name.localeCompare(b.name) || a.part.localeCompare(b.part);

  return (
    <React.Fragment>
      <div className="filters">
        <div className="search" style={{ maxWidth: 300 }}>
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter parts… set:saryn, is:hot, plat>40" />
        </div>
        {FILTERS.map((f) => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
        <div className="sp"></div>
        <span className="sortlbl">sort</span>
        {SORTS.map((s) => <button key={s} className="chip" aria-pressed={sort === s} onClick={() => setSort(s)}>{s}</button>)}
      </div>

      {SECTIONS.map((sec) => {
        if (filter !== "All" && filter !== "Hot" && filter !== sec.id) return null;
        const list = items.filter((it) => it.cat === sec.id && match(it)).sort(sorter);
        if (list.length === 0 && (filter === "Hot" || query)) return null;
        return <Section key={sec.id} sec={sec} items={list} onOpen={onOpen} />;
      })}

      <div className="legend">
        <span className="sw"><span className="box" style={{ background: "var(--t-exotic)" }}></span>≥120 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-legend)" }}></span>45–119 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-rare)" }}></span>15–44 p</span>
        <span className="sw"><span className="box" style={{ background: "var(--t-basic)" }}></span>&lt;15 p</span>
        <span className="sw">▲ hot · bottom bar = 7d trend · ×n owned</span>
      </div>
    </React.Fragment>);

}

/* ============================== trends screen ============================== */
const TF = { "24h": 0.35, "7d": 1, "30d": 2.1, "90d": 3.4 };
const CAT_SHORT = { Warframe: "Warframe", Weapon: "Weapon", Set: "Sets", Mod: "Mods", Arcane: "Arcanes" };
const vol = (it) => 30 + seed(it.id + "vol") % 220; // synthetic daily order count
const adjD = (it, f) => Math.round(it.d * f);

function MiniSpark({ points, color, w = 74, h = 24 }) {
  const padX = 2, top = 3, bot = h - 3;
  const arr = points.split(" ").map((pr) => {const [x, y] = pr.split(",").map(Number);return { x: padX + x / 84 * (w - padX * 2), y: top + (1 - y / 21) * (bot - top) };});
  const line = arr.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}><path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MoverRow({ rank, it, f, onOpen }) {
  const d = adjD(it, f), up = d >= 0;
  return (
    <button className="mrow mover" onClick={() => onOpen(it)}>
      <span className="rk">{rank}</span>
      <span className={"gl t-" + tier(it.plat)}>{initials(it.name)}</span>
      <span className="mi"><span className="mn">{it.name}</span><span className="ms">{it.part} · {it.cat}</span></span>
      <MiniSpark points={it.spark} color={up ? "var(--pos)" : "var(--neg)"} />
      <span className="mp">{it.plat}p</span>
      <span className={"md " + (up ? "pos" : "neg")}>{up ? "+" : ""}{d}%</span>
    </button>);
}

function VolRow({ rank, it, maxVol, onOpen }) {
  const v = vol(it);
  return (
    <button className="mrow vol" onClick={() => onOpen(it)}>
      <span className="rk">{rank}</span>
      <span className={"gl t-" + tier(it.plat)}>{initials(it.name)}</span>
      <span className="mi"><span className="mn">{it.name}</span><span className="ms">{it.part} · {it.plat}p</span></span>
      <span className="vbar2"><i style={{ width: v / maxVol * 100 + "%" }}></i></span>
      <span className="vnum">{v}/d</span>
    </button>);
}

function ImpactRow({ it, f, onOpen }) {
  const d = adjD(it, f);
  const imp = Math.round(it.qty * it.plat * d / 100);
  const up = imp >= 0;
  return (
    <button className="mrow imp" onClick={() => onOpen(it)}>
      <span className={"gl t-" + tier(it.plat)}>{initials(it.name)}</span>
      <span className="mi"><span className="mn">{it.name}</span><span className="ms">{it.part} · ×{it.qty} owned</span></span>
      <span className="own">{it.plat}p</span>
      <span className={"impv " + (up ? "pos" : "neg")}>{up ? "+" : ""}{imp}p</span>
    </button>);
}

function Trends({ items, onOpen }) {
  const [tf, setTf] = useState("7d");
  const f = TF[tf];

  const m = useMemo(() => {
    const totPlat = items.reduce((a, x) => a + x.plat, 0) || 1;
    const wAvg = items.reduce((a, x) => a + x.d * x.plat, 0) / totPlat;
    const byD = [...items].sort((a, b) => b.d - a.d);
    const gainers = byD.slice(0, 7);
    const losers = [...byD].reverse().slice(0, 7);
    const traded = [...items].sort((a, b) => vol(b) - vol(a)).slice(0, 7);
    const maxVol = vol(traded[0]);
    const advancers = items.filter((x) => x.d > 1).length;
    const decliners = items.filter((x) => x.d < -1).length;
    const flat = items.length - advancers - decliners;
    const totVol = items.reduce((a, x) => a + vol(x), 0);
    const cats = SECTIONS.map((s) => {
      const xs = items.filter((i) => i.cat === s.id);
      const avg = xs.length ? xs.reduce((a, x) => a + x.d, 0) / xs.length : 0;
      return { id: s.id, label: CAT_SHORT[s.id], avg, n: xs.length };
    });
    const maxAbs = Math.max(8, ...cats.map((c) => Math.abs(c.avg)));
    const moving = [...items].sort((a, b) => Math.abs(b.qty * b.plat * b.d) - Math.abs(a.qty * a.plat * a.d)).slice(0, 6);
    return { wAvg, gainers, losers, traded, maxVol, advancers, decliners, flat, totVol, cats, maxAbs, moving };
  }, [items]);

  const idxChg = m.wAvg * f;
  const idxLevel = 1000 * (1 + idxChg / 100);
  const up = idxChg >= 0;
  const idxSpark = genSpark(Math.round(idxChg) || 1);

  return (
    <React.Fragment>
      <div className="tf-row">
        <span className="lbl">timeframe</span>
        {Object.keys(TF).map((x) => <button key={x} className="chip" aria-pressed={tf === x} onClick={() => setTf(x)}>{x}</button>)}
        <div className="sp"></div>
        <span className="note">warframe.market · PC · synced {MARKET.syncedAgo}</span>
      </div>

      <div className="tgrid trow-idx">
        <div className="tpanel">
          <div className="tpanel-h"><h3>Prime Market Index</h3><span className="meta">{items.length} items tracked</span></div>
          <div className="idx">
            <span className="lvl num">{idxLevel.toFixed(1)}</span>
            <span className={"chg " + (up ? "pos" : "neg")}>{up ? "▲" : "▼"} {Math.abs(idxChg).toFixed(2)}% · {tf}</span>
          </div>
          <div className="idx-sub">
            <span><b className="up">{m.advancers}</b> advancing</span>
            <span><b className="dn">{m.decliners}</b> declining</span>
            <span><b>{m.flat}</b> flat</span>
            <span><b>{fmt(m.totVol)}</b> orders/day</span>
          </div>
          <div className="idx-chart"><BigChart points={idxSpark} h={120} /></div>
        </div>

        <div className="tpanel">
          <div className="tpanel-h"><h3>Category heat</h3><span className="meta">{tf} avg</span></div>
          {m.cats.map((c) => {
            const a = c.avg * f;
            const w = Math.min(50, Math.abs(a) / (m.maxAbs * f) * 50);
            const pos = a >= 0;
            return (
              <div className="heatrow" key={c.id}>
                <span className="hc">{c.label} <small>{c.n}</small></span>
                <span className="heatbar">
                  <span className="zero"></span>
                  <i style={pos ? { left: "50%", width: w + "%", background: "var(--pos)" } : { right: "50%", width: w + "%", background: "var(--neg)" }}></i>
                </span>
                <span className={"hv " + (pos ? "pos" : "neg")}>{pos ? "+" : ""}{a.toFixed(1)}%</span>
              </div>);
          })}
        </div>
      </div>

      <div className="tgrid trow2">
        <div className="tpanel">
          <div className="tpanel-h"><h3>Top gainers</h3><span className="meta">{tf}</span></div>
          {m.gainers.map((it, i) => <MoverRow key={it.id} rank={i + 1} it={it} f={f} onOpen={onOpen} />)}
        </div>
        <div className="tpanel">
          <div className="tpanel-h"><h3>Top losers</h3><span className="meta">{tf}</span></div>
          {m.losers.map((it, i) => <MoverRow key={it.id} rank={i + 1} it={it} f={f} onOpen={onOpen} />)}
        </div>
      </div>

      <div className="tgrid trow2">
        <div className="tpanel">
          <div className="tpanel-h"><h3>Most traded</h3><span className="meta">orders / day</span></div>
          {m.traded.map((it, i) => <VolRow key={it.id} rank={i + 1} it={it} maxVol={m.maxVol} onOpen={onOpen} />)}
        </div>
        <div className="tpanel">
          <div className="tpanel-h"><h3>Your inventory in motion</h3><span className="meta">value impact · {tf}</span></div>
          {m.moving.map((it) => <ImpactRow key={it.id} it={it} f={f} onOpen={onOpen} />)}
        </div>
      </div>
    </React.Fragment>);
}

function Stub({ title, sub }) {
  return <div className="empty" style={{ border: "1px dashed var(--line-2)", padding: "44px", textAlign: "center" }}><div style={{ fontSize: 16, fontWeight: 700, color: "var(--soft)" }}>{title}</div><div style={{ marginTop: 6 }}>{sub}</div></div>;
}

/* ============================== watchlist screen ============================== */
function Watchlist({ watch, onRemove, onOpen, onBuy }) {
  const [sort, setSort] = useState("status");
  const rows = [...watch].map((w) => ({ ...w, gap: Math.round((w.plat - w.target) / w.target * 100), at: w.plat <= w.target }));
  rows.sort((a, b) =>
  sort === "status" ? Number(b.at) - Number(a.at) || a.gap - b.gap :
  sort === "value" ? b.plat - a.plat :
  sort === "trend" ? b.d - a.d :
  a.name.localeCompare(b.name));
  const atN = rows.filter((r) => r.at).length;
  const spend = rows.filter((r) => r.at).reduce((s, r) => s + r.plat, 0);

  return (
    <React.Fragment>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="statbox"><div className="k">Watching</div><div className="v num">{rows.length}</div></div>
        <div className="statbox"><div className="k">At buy target</div><div className="v num pos">{atN}</div></div>
        <div className="statbox"><div className="k">Buy-now spend</div><div className="v num">{fmt(spend)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Avg gap to target</div><div className="v num">{rows.length ? Math.round(rows.reduce((s, r) => s + Math.max(0, r.gap), 0) / rows.length) : 0}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> %</span></div></div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Watchlist</h3>
          <span className="meta" style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "var(--faint)" }}>sort</span>
            {["status", "value", "trend", "name"].map((s) => <button key={s} className="chip" aria-pressed={sort === s} onClick={() => setSort(s)}>{s}</button>)}
          </span>
        </div>
        <table className="dtable">
          <thead><tr>
            <th>Item</th><th className="r">Price</th><th className="r">7d</th><th className="r">Target</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan="6"><div className="acol-empty">Nothing on your watchlist yet — open any item and "Add to watchlist".</div></td></tr> :
            rows.map((r) => {
              const up = r.d >= 0;
              return (
                <tr key={r.id} onClick={() => onOpen(r)}>
                  <td><div className="dnm"><span className={"gl t-" + tier(r.plat)}>{initials(r.name)}</span><span className="di"><span className="nm">{r.name}</span><span className="sub">{r.part}</span></span></div></td>
                  <td className="r num">{r.plat}p</td>
                  <td className={"r num " + (up ? "pos" : "neg")}>{up ? "+" : ""}{r.d}%</td>
                  <td className="r num">{r.target}p</td>
                  <td>{r.at ? <span className="badge at">at target</span> : <span className="badge above num">+{r.gap}% to go</span>}</td>
                  <td className="r"><div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}><button className="btn sm" onClick={(e) => {e.stopPropagation();onBuy(r);}}>+ buy</button><button className="rm" title="Remove" onClick={(e) => {e.stopPropagation();onRemove(r.id);}}>✕</button></div></td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
    </React.Fragment>);
}

/* ============================== sold history screen ============================== */
function SoldHistory({ sales, onUndo }) {
  const total = sales.reduce((s, x) => s + x.plat * x.qty, 0);
  const e7 = sales.filter((x) => x.daysAgo <= 7).reduce((s, x) => s + x.plat * x.qty, 0);
  const e30 = sales.filter((x) => x.daysAgo <= 30).reduce((s, x) => s + x.plat * x.qty, 0);
  const count = sales.reduce((s, x) => s + x.qty, 0);
  const best = sales.reduce((m, x) => Math.max(m, x.plat * x.qty), 0);
  const avg = sales.length ? Math.round(total / sales.length) : 0;

  return (
    <React.Fragment>
      <div className="statband" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <div className="statbox"><div className="k">Earned · 7d</div><div className="v num pos">{fmt(e7)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Earned · 30d</div><div className="v num">{fmt(e30)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Units sold</div><div className="v num">{count}</div></div>
        <div className="statbox"><div className="k">Avg sale</div><div className="v num">{avg}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Best sale</div><div className="v num">{best}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h"><h3>Sold history</h3><span className="meta">{sales.length} sales</span></div>
        <table className="dtable">
          <thead><tr>
            <th>When</th><th>Item</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Total</th><th></th>
          </tr></thead>
          <tbody>
            {sales.length === 0 ? <tr><td colSpan="6"><div className="acol-empty">No sales logged yet — open an owned item and "Sell 1".</div></td></tr> :
            sales.map((x, i) => (
              <tr key={i}>
                <td className="when">{relDate(x.daysAgo)}</td>
                <td><div className="dnm"><span className={"gl t-" + tier(x.plat)}>{initials(x.name)}</span><span className="di"><span className="nm">{x.name}</span><span className="sub">{x.part}</span></span></div></td>
                <td className="r num">×{x.qty}</td>
                <td className="r num">{x.plat}p</td>
                <td className="r num" style={{ fontWeight: 600 }}>{fmt(x.plat * x.qty)}p</td>
                <td className="r">{x.daysAgo === 0 ? <button className="rm" title="Undo" onClick={() => onUndo(i)}>↺</button> : null}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </React.Fragment>);
}

/* ============================== sets / buy / ducats data ============================== */
const PART_ABBR = { Blueprint: "BP", Neuroptics: "NEU", Chassis: "CHA", Systems: "SYS", Barrel: "BAR", Receiver: "REC", Stock: "STK" };
const abbr = (part) => PART_ABBR[part] || part.slice(0, 3).toUpperCase();

function buildSetProgress(items) {
  const owned = {};
  items.forEach((x) => owned[x.id] = x.qty);
  const parents = {};
  CATALOG.forEach((c) => {
    if (c.cat === "Warframe" || c.cat === "Weapon") {(parents[c.name] = parents[c.name] || { name: c.name, cat: c.cat, parts: [] }).parts.push(c);}
  });
  return Object.values(parents).map((p) => {
    const parts = p.parts.map((pt) => ({ ...pt, owned: (owned[pt.id] || 0) > 0, q: owned[pt.id] || 0 }));
    const ownedN = parts.filter((x) => x.owned).length;
    const missing = parts.filter((x) => !x.owned);
    const partsValue = parts.reduce((s, x) => s + x.plat, 0);
    const missingCost = missing.reduce((s, x) => s + x.plat, 0);
    const setItem = CATALOG.find((c) => c.cat === "Set" && c.name === p.name);
    const setPrice = setItem ? setItem.plat : partsValue;
    return { name: p.name, cat: p.cat, parts, ownedN, total: parts.length, missing, partsValue, missingCost, setPrice, complete: ownedN === parts.length, pct: Math.round(ownedN / parts.length * 100) };
  });
}

const BARO = { daysUntil: 5, relay: "Larunda Relay · Mercury", lastSeen: "9d ago" };
// live world-state (would come from a worldstate feed, e.g. warframestat.us)
const CYCLES = [
{ place: "Cetus", state: "Night", ends: "22m" },
{ place: "Orb Vallis", state: "Warm", ends: "4m" },
{ place: "Cambion Drift", state: "Fass", ends: "22m" },
{ place: "Duviri", state: "Joy", ends: "1h 40m" }];
const FISSURES = [
{ tier: "Lith", mission: "Capture", node: "Hepit · Void", left: "38m", sp: false },
{ tier: "Lith", mission: "Exterminate", node: "Everest · Earth", left: "12m", sp: true },
{ tier: "Meso", mission: "Survival", node: "Ukko · Void", left: "1h 12m", sp: false },
{ tier: "Meso", mission: "Defense", node: "Io · Jupiter", left: "46m", sp: false },
{ tier: "Neo", mission: "Defense", node: "Sechura · Pluto", left: "22m", sp: true },
{ tier: "Neo", mission: "Capture", node: "Aphrodite · Venus", left: "58m", sp: false },
{ tier: "Axi", mission: "Exterminate", node: "Xini · Eris", left: "55m", sp: false },
{ tier: "Axi", mission: "Interception", node: "Cinxia · Ceres", left: "31m", sp: true },
{ tier: "Requiem", mission: "Disruption", node: "Kelpie · Sedna", left: "1h 04m", sp: false }];
const BUY_SEED = [["Khora Blueprint", 1], ["Loki Prime", 1], ["Primed Reach", 2]];
function buildBuy() {return BUY_SEED.map(([id, q]) => {const c = CATALOG.find((x) => x.id === id);return c ? { ...c, buyQty: q } : null;}).filter(Boolean);}

// warframe.market connected account + your live sell orders
const ACCOUNT = { ingameName: "Tenno_Vex", reputation: 412 };
const LISTING_SEED = ["Inaros Prime", "Saryn Prime", "Primed Sure Footed", "Arcane Energize", "Mesa Blueprint", "Wisp Prime", "Khora Prime", "Nikana Blueprint"];
function buildListings() {
  return LISTING_SEED.map((id) => {
    const c = CATALOG.find((x) => x.id === id);if (!c) return null;
    const s = seed(id + "lst");
    const marketLow = Math.max(1, Math.round(c.plat * (0.84 + s % 16 / 100)));
    const over = s % 3 === 0;
    const price = over ? Math.round(marketLow * (1.05 + s % 12 / 100)) : marketLow;
    return { ...c, price, qty: 1 + s % 3, marketLow, sellers: 4 + s % 24, updated: relDate(s % 6) };
  }).filter(Boolean);
}
function listRank(l) {return l.price <= l.marketLow ? 1 : Math.min(l.sellers, 1 + Math.ceil((l.price - l.marketLow) / Math.max(1, Math.round(l.marketLow * 0.06))));}

/* ============================== sets / completion screen ============================== */
function SetsScreen({ progress, onOpen, onBuyMissing }) {
  const [filter, setFilter] = useState("all");
  const complete = progress.filter((s) => s.complete).length;
  const oneAway = progress.filter((s) => !s.complete && s.missing.length === 1).length;
  const completableValue = progress.filter((s) => s.complete).reduce((a, s) => a + s.setPrice, 0);
  const avgPct = progress.length ? Math.round(progress.reduce((a, s) => a + s.pct, 0) / progress.length) : 0;

  const rows = progress.filter((s) =>
  filter === "complete" ? s.complete :
  filter === "almost" ? !s.complete && s.missing.length <= 2 :
  filter === "progress" ? !s.complete : true).
  sort((a, b) => b.complete - a.complete || a.missing.length - b.missing.length || b.setPrice - a.setPrice);

  return (
    <React.Fragment>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="statbox"><div className="k">Complete sets</div><div className="v num pos">{complete}</div></div>
        <div className="statbox"><div className="k">One part away</div><div className="v num">{oneAway}</div></div>
        <div className="statbox"><div className="k">Completable value</div><div className="v num">{fmt(completableValue)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Avg completion</div><div className="v num">{avgPct}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> %</span></div></div>
      </div>

      <div className="filters">
        {[["all", "All"], ["complete", "Complete"], ["almost", "Almost done"], ["progress", "In progress"]].map(([k, l]) =>
        <button key={k} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
      </div>

      <div className="tpanel">
        <div className="tpanel-h"><h3>Set completion</h3><span className="meta">{rows.length} sets · build parts → full sets</span></div>
        {rows.map((s) =>
        <div className="setrow" key={s.name}>
            <div className="set-main">
              <div className="snm">{s.name}</div>
              <div className="ssub">{s.cat} · {s.ownedN}/{s.total} parts</div>
              <div className={"set-bar" + (s.complete ? " done" : "")}><i style={{ width: s.pct + "%" }}></i></div>
            </div>
            <div className="pchips">
              {s.parts.map((p) =>
            <div key={p.id} className={"pchip " + (p.owned ? "have" : "miss")} title={p.part + " · " + p.plat + "p" + (p.owned ? " · owned" : " · click to add to buy list")} onClick={p.owned ? () => onOpen(p) : () => onBuyMissing([p])}>
                  <span className="pa">{abbr(p.part)}</span>
                  {p.owned ? <span className="ck">✓</span> : <span className="pp">{p.plat}p</span>}
                </div>)}
            </div>
            <div className="set-act">
              {s.complete ?
            <React.Fragment><div className="sv num">{s.setPrice}p</div><div className="sx">full-set value</div></React.Fragment> :
            <React.Fragment>
                  <button className="btn sm" onClick={() => onBuyMissing(s.missing)}>Buy {s.missing.length} missing</button>
                  <div className="sx">+{s.missingCost}p to complete</div>
                </React.Fragment>}
            </div>
          </div>)}
      </div>
    </React.Fragment>);
}

/* ============================== buy list screen ============================== */
function BuyList({ buy, budget, setBudget, onSetQty, onRemove, onPurchase, onPurchaseAll, onClear }) {
  const total = buy.reduce((s, x) => s + x.plat * x.buyQty, 0);
  const units = buy.reduce((s, x) => s + x.buyQty, 0);
  const remaining = budget - total;

  return (
    <React.Fragment>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="statbox"><div className="k">Items</div><div className="v num">{buy.length}</div></div>
        <div className="statbox"><div className="k">Units</div><div className="v num">{units}</div></div>
        <div className="statbox"><div className="k">Total cost</div><div className="v num">{fmt(total)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">Remaining budget</div><div className={"v num " + (remaining < 0 ? "neg" : "pos")}>{fmt(remaining)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h">
          <h3>Buy list</h3>
          <span className="meta" style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--faint)" }}>budget</span>
            <span className="budget"><input type="number" value={budget} min="0" step="50" onChange={(e) => setBudget(Math.max(0, +e.target.value || 0))} /><span className="u">p</span></span>
            {buy.length ? <button className="btn sm" onClick={onPurchaseAll}>Purchase all → inventory</button> : null}
            {buy.length ? <button className="btn sm" onClick={onClear}>Clear</button> : null}
          </span>
        </div>
        <table className="dtable">
          <thead><tr><th>Item</th><th className="r">Unit</th><th>Qty</th><th className="r">Line</th><th></th></tr></thead>
          <tbody>
            {buy.length === 0 ? <tr><td colSpan="5"><div className="acol-empty">Buy list is empty — add missing parts from Sets, or items from your Watchlist.</div></td></tr> :
            buy.map((x) =>
            <tr key={x.id}>
                <td><div className="dnm"><span className={"gl t-" + tier(x.plat)}>{initials(x.name)}</span><span className="di"><span className="nm">{x.name}</span><span className="sub">{x.part}</span></span></div></td>
                <td className="r num">{x.plat}p</td>
                <td><span className="qstep" onClick={(e) => e.stopPropagation()}><button onClick={() => onSetQty(x.id, x.buyQty - 1)}>−</button><span className="qn">{x.buyQty}</span><button onClick={() => onSetQty(x.id, Math.min(99, x.buyQty + 1))}>+</button></span></td>
                <td className="r num" style={{ fontWeight: 600 }}>{fmt(x.plat * x.buyQty)}p</td>
                <td className="r"><div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}><button className="btn sm" onClick={() => onPurchase(x)}>Bought</button><button className="rm" title="Remove" onClick={() => onRemove(x.id)}>✕</button></div></td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </React.Fragment>);
}

/* ============================== ducats screen ============================== */
function Ducats({ items, onOpen }) {
  const parts = items.filter((x) => x.duc > 0);
  const totalDuc = parts.reduce((s, x) => s + x.duc * x.qty, 0);
  const trash = parts.filter((x) => x.plat <= 8);
  const trashDuc = trash.reduce((s, x) => s + x.duc * x.qty, 0);
  const avgDuc = parts.length ? Math.round(totalDuc / parts.reduce((s, x) => s + x.qty, 0)) : 0;
  const ranked = [...parts].sort((a, b) => b.duc / b.plat - a.duc / a.plat || b.qty - a.qty || b.duc - a.duc).slice(0, 12);

  return (
    <React.Fragment>
      <div className="statband" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="statbox"><div className="k">Inventory ducats</div><div className="v num">{fmt(totalDuc)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> d</span></div></div>
        <div className="statbox"><div className="k">Trash-tier ducats</div><div className="v num">{fmt(trashDuc)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> d</span></div></div>
        <div className="statbox"><div className="k">Trash candidates</div><div className="v num">{trash.length}</div></div>
        <div className="statbox"><div className="k">Avg ducats / part</div><div className="v num">{avgDuc}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> d</span></div></div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h"><h3>Best ducat value</h3><span className="meta">low plat · high ducats — best to convert</span></div>
        <table className="dtable">
          <thead><tr><th>Part</th><th className="r">Plat</th><th className="r">Ducats</th><th className="r">d / p</th><th>Verdict</th></tr></thead>
          <tbody>
            {ranked.map((x) => {
              const eff = x.duc / x.plat;
              const trashIt = x.plat <= 8 || eff >= 5;
              return (
                <tr key={x.id} onClick={() => onOpen(x)}>
                  <td><div className="dnm"><span className={"gl t-" + tier(x.plat)}>{initials(x.name)}</span><span className="di"><span className="nm">{x.name}</span><span className="sub">{x.part} · ×{x.qty}</span></span></div></td>
                  <td className="r num">{x.plat}p</td>
                  <td className="r num">{x.duc}d</td>
                  <td className="r num">{eff.toFixed(1)}</td>
                  <td>{trashIt ? <span className="badge at">ducat it</span> : <span className="badge above">sell for plat</span>}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
    </React.Fragment>);
}

/* ============================== listings screen (warframe.market) ============================== */
function Listings({ listings, status, setStatus, onSetPrice, onMatch, onRemove, onOpen }) {
  const listedVal = listings.reduce((s, l) => s + l.price * l.qty, 0);
  const best = listings.filter((l) => l.price <= l.marketLow).length;
  const undercut = listings.length - best;
  const STATUSES = [["offline", "Offline"], ["online", "Online"], ["ingame", "In Game"]];
  return (
    <React.Fragment>
      <div className="conn">
        <span className={"cdot " + status}></span>
        <div className="cinfo">Connected to <b>warframe.market</b> as <b>{ACCOUNT.ingameName}</b><span className="crep"> · rep {ACCOUNT.reputation}</span></div>
        <div className="seg">{STATUSES.map(([k, l]) => <button key={k} className="segb" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <button className="btn sm">Sync now</button>
      </div>
      {status === "offline" ? <div className="conn-note">You're offline — your listings are hidden from buyers until you go Online or In Game.</div> : null}

      <div className="statband" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="statbox"><div className="k">Active listings</div><div className="v num">{listings.length}</div></div>
        <div className="statbox"><div className="k">Listed value</div><div className="v num">{fmt(listedVal)}<span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 400 }}> p</span></div></div>
        <div className="statbox"><div className="k">At best price</div><div className="v num pos">{best}</div></div>
        <div className="statbox"><div className="k">Undercut</div><div className={"v num " + (undercut ? "neg" : "")}>{undercut}</div></div>
      </div>

      <div className="tpanel">
        <div className="tpanel-h"><h3>Your listings</h3><span className="meta">live sell orders · warframe.market</span></div>
        <table className="dtable">
          <thead><tr><th>Item</th><th>Your price</th><th className="r">Qty</th><th className="r">Market low</th><th className="r">Rank</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {listings.length === 0 ? <tr><td colSpan="7"><div className="acol-empty">No active listings — open an owned item and "List on market".</div></td></tr> :
            listings.map((l) => {
              const beat = l.price <= l.marketLow;
              return (
                <tr key={l.id}>
                  <td onClick={() => onOpen(l)}><div className="dnm"><span className={"gl t-" + tier(l.plat)}>{initials(l.name)}</span><span className="di"><span className="nm">{l.name}</span><span className="sub">{l.part} · upd {l.updated}</span></span></div></td>
                  <td><span className="qstep" onClick={(e) => e.stopPropagation()}><button onClick={() => onSetPrice(l.id, l.price - 1)}>−</button><span className="qn" style={{ minWidth: 40 }}>{l.price}p</span><button onClick={() => onSetPrice(l.id, l.price + 1)}>+</button></span></td>
                  <td className="r num">×{l.qty}</td>
                  <td className="r num">{l.marketLow}p</td>
                  <td className="r num">#{listRank(l)}/{l.sellers}</td>
                  <td>{beat ? <span className="badge at">best price</span> : <span className="badge above num">+{l.price - l.marketLow}p over</span>}</td>
                  <td className="r"><div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>{beat ? null : <button className="btn sm" onClick={() => onMatch(l.id)}>Match</button>}<button className="rm" title="Remove listing" onClick={() => onRemove(l.id)}>✕</button></div></td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
    </React.Fragment>);
}

/* ============================== rotation screen (live world-state) ============================== */
const FTIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem"];
function Rotation() {
  const [tier, setTier] = useState("All");
  const [sp, setSp] = useState(false);
  const rows = FISSURES.filter((f) => (tier === "All" || f.tier === tier) && (!sp || f.sp));
  return (
    <React.Fragment>
      <div className="cyclebar">
        {CYCLES.map((c) =>
        <div className="cyc" key={c.place}>
            <div className="cyc-st">{c.state}</div>
            <div className="cyc-pl">{c.place}</div>
            <div className="cyc-end">{c.ends} left</div>
          </div>)}
      </div>

      <div className="tgrid trow-idx">
        <div className="tpanel">
          <div className="tpanel-h"><h3>Void Fissures</h3><span className="meta">{rows.length} active</span></div>
          <div className="filters" style={{ margin: 0, padding: "7px 12px", borderBottom: "1px solid var(--line)" }}>
            {["All", ...FTIERS].map((t) => <button key={t} className="chip" aria-pressed={tier === t} onClick={() => setTier(t)}>{t}</button>)}
            <div className="sp"></div>
            <button className="chip" aria-pressed={sp} onClick={() => setSp((v) => !v)}>Steel Path</button>
          </div>
          <table className="dtable">
            <thead><tr><th>Tier</th><th>Mission</th><th>Location</th><th></th><th className="r">Time left</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan="5"><div className="acol-empty">No fissures match.</div></td></tr> :
              rows.map((f, i) =>
              <tr key={i}>
                  <td><span className={"ftier t-" + f.tier.toLowerCase()}>{f.tier}</span></td>
                  <td className="num" style={{ fontWeight: 600, fontFamily: "var(--sans)" }}>{f.mission}</td>
                  <td style={{ color: "var(--soft)" }}>{f.node}</td>
                  <td>{f.sp ? <span className="badge sp">Steel Path</span> : null}</td>
                  <td className="r when">{f.left}</td>
                </tr>)}
            </tbody>
          </table>
        </div>

        <div className="tpanel">
          <div className="tpanel-h"><h3>Baro Ki'Teer</h3><span className="meta">void trader</span></div>
          <div className="baro">
            <div className="baro-cd"><span className="num">{BARO.daysUntil}d</span><span className="bl">until arrival</span></div>
            <div className="baro-meta">
              <div>Next: <b>{BARO.relay}</b></div>
              <div className="muted">Last seen {BARO.lastSeen} · trades ducats + credits</div>
            </div>
          </div>
          <div className="baro-note">Baro's stock isn't published until he arrives — check back when the countdown hits zero to see what he's brought.</div>
        </div>
      </div>
    </React.Fragment>);
}

/* ============================== add-items modal ============================== */
function QtyRow({ it, qn, onSetQty, label }) {
  const on = qn > 0;
  return (
    <div className={"crow" + (label === it.part ? " leaf" : "") + (on ? " on" : "")} onClick={() => onSetQty(it, on ? 0 : 1)}>
      <span className="cb">{on ? "✓" : ""}</span>
      <span className="cn">{label}{on ? null : <small> {it.plat}p</small>}</span>
      {on ?
      <span className="qstep" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onSetQty(it, qn - 1)}>−</button>
          <span className="qn">{qn}</span>
          <button onClick={() => onSetQty(it, Math.min(99, qn + 1))}>+</button>
        </span> :
      null}
    </div>);
}

function AddItems({ ownedMap, onSetQty, onAddAll, onClearAll, onClose }) {
  const [q, setQ] = useState("");
  const [exp, setExp] = useState(() => new Set());
  const query = q.trim().toLowerCase();
  const ownedCount = Object.values(ownedMap).filter((n) => n > 0).length;
  const toggleExp = (k) => setExp((s) => {const n = new Set(s);n.has(k) ? n.delete(k) : n.add(k);return n;});

  const groupsFor = (catId) => {
    const items = CATALOG.filter((c) => c.cat === catId);
    if (catId === "Warframe" || catId === "Weapon") {
      const map = {};
      items.forEach((it) => {(map[it.name] = map[it.name] || { name: it.name, key: catId + "|" + it.name, parts: [] }).parts.push(it);});
      return Object.values(map);
    }
    return items.map((it) => ({ name: it.name, key: it.id, parts: [it], single: true }));
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <h2>Add items</h2>
          <div className="search" style={{ maxWidth: 340 }}>
            <Icon name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="search all parts, sets, mods, arcanes…" />
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-cols">
          {SECTIONS.map((s) => {
            let groups = groupsFor(s.id);
            if (query) {
              groups = groups.map((g) => {
                const nameMatch = g.name.toLowerCase().includes(query);
                const parts = nameMatch ? g.parts : g.parts.filter((p) => (p.name + " " + p.part).toLowerCase().includes(query));
                return { ...g, parts, _hit: nameMatch || parts.length > 0 };
              }).filter((g) => g._hit);
            }
            const total = CATALOG.filter((c) => c.cat === s.id).length;
            const ownedN = CATALOG.filter((c) => c.cat === s.id && ownedMap[c.id] > 0).length;
            const allOwned = ownedN === total;
            return (
              <div className="acol" key={s.id}>
                <div className="acol-h">
                  <h4>{CAT_SHORT[s.id]}</h4>
                  <span className="ct">{ownedN}/{total}</span>
                  <button className="all" onClick={() => allOwned ? onClearAll(s.id) : onAddAll(s.id)}>{allOwned ? "clear" : "+ all"}</button>
                </div>
                <div className="acol-b">
                  {groups.length === 0 ? <div className="acol-empty">no matches</div> :
                  groups.map((g) => {
                    if (g.single) {
                      const it = g.parts[0];
                      return <QtyRow key={g.key} it={it} qn={ownedMap[it.id] || 0} onSetQty={onSetQty} label={it.name} />;
                    }
                    const open = query ? true : exp.has(g.key);
                    const ownedParts = g.parts.filter((p) => ownedMap[p.id] > 0).length;
                    return (
                      <div className="agrp" key={g.key}>
                        <div className={"agrp-h" + (ownedParts ? " has" : "")} onClick={() => toggleExp(g.key)}>
                          <span className="tw">{open ? "▾" : "▸"}</span>
                          <span className="gn">{g.name}</span>
                          <span className="gc">{ownedParts}/{g.parts.length}</span>
                        </div>
                        {open && g.parts.map((it) => <QtyRow key={it.id} it={it} qn={ownedMap[it.id] || 0} onSetQty={onSetQty} label={it.part} />)}
                      </div>);
                  })}
                </div>
              </div>);
          })}
        </div>
        <div className="modal-f">
          <span className="info"><b className="num">{ownedCount}</b> items in inventory · <b className="num">{CATALOG.length}</b> in catalog</span>
          <div className="sp"></div>
          <button className="btn pri" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>);
}

/* ============================== app ============================== */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dense": false,
  "flatDeltas": false,
  "accent": "#cfd2d8"
} /*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = useState("inventory");
  const [items, setItems] = useState(initialOwned);
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [watch, setWatch] = useState(buildWatch);
  const [sales, setSales] = useState(SALES);
  const [buy, setBuy] = useState(buildBuy);
  const [budget, setBudget] = useState(500);
  const [listings, setListings] = useState(buildListings);
  const [mktStatus, setMktStatus] = useState("online");

  React.useEffect(() => {
    document.body.classList.toggle("dense", !!t.dense);
    document.body.classList.toggle("flat-deltas", !!t.flatDeltas);
    document.documentElement.style.setProperty("--accent", t.accent);
  }, [t.dense, t.flatDeltas, t.accent]);

  const selLive = sel ? items.find((x) => x.id === sel.id) || sel : null;

  const ownedMap = useMemo(() => {const m = {};items.forEach((x) => m[x.id] = x.qty);return m;}, [items]);
  const setQty = (cat, qn) => setItems((p) => {
    const i = p.findIndex((x) => x.id === cat.id);
    if (qn <= 0) return p.filter((x) => x.id !== cat.id);
    if (i < 0) return [...p, { ...cat, qty: qn, sold: false }];
    return p.map((x) => x.id === cat.id ? { ...x, qty: qn } : x);
  });
  const addAllCat = (catId) => setItems((p) => {
    const have = new Set(p.map((x) => x.id));
    const add = CATALOG.filter((c) => c.cat === catId && !have.has(c.id)).map((c) => ({ ...c, qty: 1, sold: false }));
    return [...p, ...add];
  });
  const clearAllCat = (catId) => setItems((p) => p.filter((x) => x.cat !== catId));

  const watchedIds = useMemo(() => new Set(watch.map((w) => w.id)), [watch]);
  const addWatch = (it) => setWatch((w) => w.some((x) => x.id === it.id) ? w : [...w, { ...it, target: Math.round(it.plat * 0.9) }]);
  const removeWatch = (id) => setWatch((w) => w.filter((x) => x.id !== id));
  const logSale = (it) => {
    setSales((s) => [{ name: it.name, part: it.part, cat: it.cat, qty: 1, plat: it.plat, daysAgo: 0 }, ...s]);
    setItems((p) => {const cur = p.find((x) => x.id === it.id);if (!cur) return p;return cur.qty <= 1 ? p.filter((x) => x.id !== it.id) : p.map((x) => x.id === it.id ? { ...x, qty: x.qty - 1 } : x);});
  };
  const undoSale = (i) => setSales((s) => s.filter((_, idx) => idx !== i));

  const setsProg = useMemo(() => buildSetProgress(items), [items]);
  const addBuyMany = (list) => setBuy((b) => {
    const map = new Map(b.map((x) => [x.id, { ...x }]));
    list.forEach((it) => {if (map.has(it.id)) map.get(it.id).buyQty += 1;else map.set(it.id, { ...it, buyQty: 1 });});
    return [...map.values()];
  });
  const setBuyQty = (id, qn) => setBuy((b) => qn <= 0 ? b.filter((x) => x.id !== id) : b.map((x) => x.id === id ? { ...x, buyQty: qn } : x));
  const removeBuy = (id) => setBuy((b) => b.filter((x) => x.id !== id));
  const clearBuy = () => setBuy([]);
  const addToInv = (list) => setItems((p) => {
    const map = new Map(p.map((x) => [x.id, { ...x }]));
    list.forEach((it) => {if (map.has(it.id)) map.get(it.id).qty += it.buyQty;else map.set(it.id, { ...it, qty: it.buyQty, sold: false });});
    return [...map.values()];
  });
  const purchaseOne = (it) => {addToInv([it]);removeBuy(it.id);};
  const purchaseAll = () => {addToInv(buy);setBuy([]);};

  const listedIds = useMemo(() => new Set(listings.map((l) => l.id)), [listings]);
  const setListPrice = (id, p) => setListings((ls) => ls.map((l) => l.id === id ? { ...l, price: Math.max(1, p), updated: "just now" } : l));
  const matchListing = (id) => setListings((ls) => ls.map((l) => l.id === id ? { ...l, price: l.marketLow, updated: "just now" } : l));
  const removeListing = (id) => setListings((ls) => ls.filter((l) => l.id !== id));
  const listOnMarket = (it) => setListings((ls) => {
    if (ls.some((l) => l.id === it.id)) return ls;
    const s = seed(it.id + "lst");
    const marketLow = Math.max(1, Math.round(it.plat * (0.84 + s % 16 / 100)));
    return [...ls, { ...it, price: it.plat, qty: 1, marketLow, sellers: 4 + s % 24, updated: "just now" }];
  });

  const counts = useMemo(() => ({
    inventory: new Set(items.map((x) => x.id)).size,
    watchlist: watch.length,
    buy: buy.length,
    listings: listings.length,
    sets: setsProg.filter((s) => !s.complete && s.missing.length === 1).length,
    hot: items.filter((x) => x.hot).length
  }), [items, watch, buy, listings, setsProg]);

  const screenLabel = (NAV.find((n) => n.id === screen) || {}).label || "";

  return (
    <div className="shell">
      <Sidebar screen={screen} setScreen={setScreen} counts={counts} onAdd={() => setAdding(true)} />
      <div className="main">
        <div className="topbar">
          <div className="screen-title">{screenLabel}</div>
          <div className="search">
            <Icon name="search" size={14} />
            <input placeholder="Search part / set / mod, is:hot, plat>40, sort:trend …" />
          </div>
          <button className="icon-btn" title="Refresh"><Icon name="refresh" /></button>
        </div>
        <div className="content">
          {screen === "inventory" && <React.Fragment><StatBand items={items} /><Inventory items={items} onOpen={setSel} /></React.Fragment>}
          {screen === "sets" && <SetsScreen progress={setsProg} onOpen={setSel} onBuyMissing={addBuyMany} />}
          {screen === "trends" && <Trends items={items} onOpen={setSel} />}
          {screen === "watchlist" && <Watchlist watch={watch} onRemove={removeWatch} onOpen={setSel} onBuy={(it) => addBuyMany([it])} />}
          {screen === "buy" && <BuyList buy={buy} budget={budget} setBudget={setBudget} onSetQty={setBuyQty} onRemove={removeBuy} onPurchase={purchaseOne} onPurchaseAll={purchaseAll} onClear={clearBuy} />}
          {screen === "listings" && <Listings listings={listings} status={mktStatus} setStatus={setMktStatus} onSetPrice={setListPrice} onMatch={matchListing} onRemove={removeListing} onOpen={setSel} />}
          {screen === "ducats" && <Ducats items={items} onOpen={setSel} />}
          {screen === "rotation" && <Rotation />}
          {screen === "history" && <SoldHistory sales={sales} onUndo={undoSale} />}
        </div>
      </div>

      <Drawer it={selLive} onClose={() => setSel(null)} onLogSale={logSale} onAddWatch={addWatch} onAddBuy={(it) => addBuyMany([it])} onListMarket={listOnMarket} watched={selLive ? watchedIds.has(selLive.id) : false} owned={selLive ? (ownedMap[selLive.id] || 0) > 0 : false} listed={selLive ? listedIds.has(selLive.id) : false} />
      {adding ? <AddItems ownedMap={ownedMap} onSetQty={setQty} onAddAll={addAllCat} onClearAll={clearAllCat} onClose={() => setAdding(false)} /> : null}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Density" />
        <TweakToggle label="Compact tiles" value={t.dense} onChange={(v) => setTweak("dense", v)} />
        <TweakSection label="Display" />
        <TweakToggle label="Mute trend colors" value={t.flatDeltas} onChange={(v) => setTweak("flatDeltas", v)} />
        <TweakColor label="Accent" value={t.accent} options={["#cfd2d8", "#f0883e", "#4f9dde", "#5fc27e"]} onChange={(v) => setTweak("accent", v)} />
      </TweaksPanel>
    </div>);

}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);