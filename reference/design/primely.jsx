const { useState } = React;

/* ============================== data ============================== */
const PROFILE = { name: "Tenno_Vex", mr: 27, syncedAgo: "2 min ago" };

const STATS = [
  { key: "plat",  label: "Total Platinum", value: 1240, unit: "p", delta: +11, note: "+138 p this week",   spark: "0,7 14,8 28,7 42,11 56,12 70,16 84,19" },
  { key: "duc",   label: "Total Ducats",   value: 3755, unit: "d", delta: +6,  note: "≈ 12 relics to spare", spark: "0,9 14,10 28,11 42,12 56,13 70,15 84,17" },
  { key: "parts", label: "Prime Parts",    value: 86,   unit: "",  delta: null, note: "14 trending · 5 sets ready", spark: "0,11 14,12 28,11 42,13 56,12 70,14 84,15" },
];

const PARTS = [
  { name: "Mesa Prime",    part: "Systems Blueprint", cat: "Warframe", plat: 45,  qty: 2, duc: 15,  d: +18, hot: true,  sold: false, spark: "0,5 14,7 28,6 42,12 56,13 70,17 84,20" },
  { name: "Saryn Prime",   part: "Set",               cat: "Warframe", plat: 130, qty: 1, duc: 0,   d: +9,  hot: true,  sold: false, spark: "0,9 14,11 28,10 42,13 56,14 70,18 84,19" },
  { name: "Wisp Prime",    part: "Chassis",           cat: "Warframe", plat: 20,  qty: 3, duc: 65,  d: -4,  hot: false, sold: false, spark: "0,15 14,16 28,14 42,12 56,13 70,11 84,10" },
  { name: "Octavia Prime", part: "Neuroptics",        cat: "Warframe", plat: 12,  qty: 1, duc: 45,  d: +22, hot: true,  sold: false, spark: "0,6 14,8 28,7 42,12 56,14 70,18 84,21" },
  { name: "Gauss Prime",   part: "Barrel",            cat: "Weapon",   plat: 8,   qty: 1, duc: 45,  d: -2,  hot: false, sold: false, spark: "0,11 14,12 28,10 42,13 56,11 70,12 84,11" },
  { name: "Khora Prime",   part: "Systems",           cat: "Warframe", plat: 15,  qty: 2, duc: 65,  d: +6,  hot: false, sold: false, spark: "0,10 14,9 28,11 42,10 56,12 70,13 84,15" },
  { name: "Volt Prime",    part: "Neuroptics",        cat: "Warframe", plat: 10,  qty: 4, duc: 45,  d: +3,  hot: false, sold: false, spark: "0,11 14,10 28,12 42,11 56,13 70,12 84,14" },
  { name: "Nova Prime",    part: "Chassis Blueprint", cat: "Warframe", plat: 6,   qty: 2, duc: 15,  d: +14, hot: true,  sold: false, spark: "0,8 14,9 28,10 42,12 56,13 70,17 84,19" },
];

const PORTFOLIO_SPARK = "0,7 14,8 28,7 42,11 56,12 70,16 84,19";

const SET_MOVERS = [
  { name: "Inaros Prime", sub: "Full set", plat: 180, d: +8,  spark: "0,10 14,11 28,12 42,13 56,14 70,17 84,18" },
  { name: "Wisp Prime",   sub: "Full set", plat: 165, d: -3,  spark: "0,16 14,15 28,16 42,14 56,13 70,12 84,11" },
  { name: "Khora Prime",  sub: "Full set", plat: 140, d: +2,  spark: "0,12 14,12 28,13 42,12 56,13 70,13 84,14" },
  { name: "Saryn Prime",  sub: "Full set", plat: 130, d: +9,  spark: "0,12 14,13 28,12 42,14 56,15 70,18 84,19" },
  { name: "Gauss Prime",  sub: "Full set", plat: 120, d: +4,  spark: "0,11 14,12 28,11 42,13 56,12 70,14 84,15" },
];
const MOD_MOVERS = [
  { name: "Primed Sure Footed", sub: "Mod · R10", plat: 60, d: +9,  spark: "0,12 14,13 28,14 42,15 56,16 70,17 84,18" },
  { name: "Primed Continuity",  sub: "Mod · R10", plat: 35, d: +14, spark: "0,8 14,9 28,10 42,11 56,13 70,15 84,18" },
  { name: "Primed Flow",        sub: "Mod · R10", plat: 28, d: +6,  spark: "0,10 14,11 28,10 42,12 56,13 70,14 84,15" },
  { name: "Galvanized Aptitude",sub: "Mod · R10", plat: 22, d: -5,  spark: "0,15 14,14 28,15 42,13 56,12 70,11 84,10" },
  { name: "Primed Pressure Pt", sub: "Mod · R10", plat: 18, d: +3,  spark: "0,11 14,11 28,12 42,11 56,12 70,12 84,13" },
];
const ARC_MOVERS = [
  { name: "Arcane Energize", sub: "Arcane · R5", plat: 140, d: +12, spark: "0,9 14,10 28,11 42,12 56,14 70,16 84,19" },
  { name: "Arcane Grace",    sub: "Arcane · R5", plat: 95,  d: +5,  spark: "0,11 14,12 28,11 42,13 56,14 70,15 84,16" },
  { name: "Arcane Avenger",  sub: "Arcane · R5", plat: 75,  d: +7,  spark: "0,10 14,11 28,12 42,13 56,14 70,15 84,17" },
  { name: "Arcane Guardian", sub: "Arcane · R5", plat: 30,  d: -4,  spark: "0,14 14,13 28,14 42,13 56,12 70,11 84,10" },
  { name: "Arcane Nullifier",sub: "Arcane · R5", plat: 12,  d: +1,  spark: "0,12 14,12 28,12 42,13 56,12 70,13 84,13" },
];
const CATEGORIES = {
  "Prime Parts": { value: 1240, delta: +11, sub: "Estimated platinum across your prime parts", spark: PORTFOLIO_SPARK },
  "Sets":        { value: 147,  delta: +6,  sub: "Average full prime-set value",               spark: "0,9 14,10 28,9 42,11 56,12 70,13 84,15", movers: SET_MOVERS },
  "Mods":        { value: 33,   delta: +8,  sub: "Average primed-mod value",                   spark: "0,8 14,9 28,10 42,9 56,12 70,14 84,16",  movers: MOD_MOVERS },
  "Arcanes":     { value: 70,   delta: +5,  sub: "Average arcane value",                       spark: "0,10 14,11 28,10 42,12 56,13 70,14 84,15", movers: ARC_MOVERS },
};

const SOLD = [
  { name: "Inaros Prime",  part: "Set",        qty: 1, plat: 95, date: "May 28", buyer: "EidolonHunter" },
  { name: "Rhino Prime",   part: "Set",        qty: 1, plat: 75, date: "May 27", buyer: "void_runner" },
  { name: "Nidus Prime",   part: "Neuroptics", qty: 1, plat: 30, date: "May 26", buyer: "TennoTrader88" },
  { name: "Ember Prime",   part: "Blueprint",  qty: 2, plat: 36, date: "May 24", buyer: "ClemClone" },
  { name: "Loki Prime",    part: "Barrel",     qty: 2, plat: 28, date: "May 22", buyer: "OrokinScholar" },
  { name: "Trinity Prime", part: "Systems",    qty: 1, plat: 12, date: "May 21", buyer: "blink_dagger" },
  { name: "Banshee Prime", part: "Chassis",    qty: 3, plat: 27, date: "May 19", buyer: "sonicFractur" },
];

/* ============================== helpers ============================== */
const OpenPartContext = React.createContext(() => {});
const fmt = (n) => n.toLocaleString("en-US");

function useCountUp(target, dur = 1100) {
  const [n, setN] = useState(0);
  React.useEffect(() => {
    let raf; const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

function partToItem(p) {
  return { name: p.name, sub: `${p.part} · ${p.cat}`, plat: p.plat, d: p.d, qty: p.qty, duc: p.duc, spark: p.spark };
}

/* ============================== atoms ============================== */
function Icon({ name, size = 19 }) {
  const p = {
    dashboard: <React.Fragment><rect x="3" y="3" width="7" height="9" rx="1.6" /><rect x="14" y="3" width="7" height="5" rx="1.6" /><rect x="14" y="12" width="7" height="9" rx="1.6" /><rect x="3" y="16" width="7" height="5" rx="1.6" /></React.Fragment>,
    inventory: <React.Fragment><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></React.Fragment>,
    trends: <React.Fragment><path d="M4 4v16h16" /><path d="M7 14l4-5 3 3 5-7" /></React.Fragment>,
    history: <React.Fragment><circle cx="12" cy="12" r="8.2" /><path d="M12 8v4l3 2" /></React.Fragment>,
    watchlist: <React.Fragment><path d="M12 4l2.5 5 5.5.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.5-.7z" /></React.Fragment>,
    settings: <React.Fragment><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.5M12 18v2.5M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M19.8 7.5l-2.1 1.2M6.3 15.3l-2.1 1.2" /></React.Fragment>,
    search: <React.Fragment><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></React.Fragment>,
    bell: <React.Fragment><path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></React.Fragment>,
    plus: <path d="M12 5v14M5 12h14" />,
    sun: <React.Fragment><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M19.4 4.6l-1.7 1.7M6.3 17.7l-1.7 1.7" /></React.Fragment>,
    moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />,
  }[name];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}
      style={{ width: size, height: size, flex: "none", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
      {p}
    </svg>
  );
}

function Glyph({ name, size = 44, fontSize }) {
  const mono = name.replace(/ Prime.*/, "").slice(0, 2);
  return (
    <span className="glyph" style={{ width: size, height: size, fontSize: fontSize || size * 0.42 }}>{mono}</span>
  );
}

function Delta({ d, chip }) {
  const up = d >= 0;
  return (
    <span className={"delta " + (up ? "up" : "down") + (chip ? " delta-chip " + (up ? "up" : "down") : "")}>
      <span className="tri">{up ? "▲" : "▼"}</span>{Math.abs(d)}%
    </span>
  );
}

function Spark({ points, color, w = 84, h = 26 }) {
  const pts = points.split(" ").map((pr) => {
    const [x, y] = pr.split(",").map(Number);
    return `${(x / 84) * w},${h - (y / 21) * h}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible", flex: "none" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function smooth(arr) {
  if (arr.length < 2) return "";
  let d = `M${arr[0].x},${arr[0].y}`;
  for (let i = 1; i < arr.length; i++) {
    const mx = (arr[i - 1].x + arr[i].x) / 2, my = (arr[i - 1].y + arr[i].y) / 2;
    d += ` Q${arr[i - 1].x},${arr[i - 1].y} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  d += ` L${arr[arr.length - 1].x},${arr[arr.length - 1].y}`;
  return d;
}

function BigChart({ points, h = 220, k = 0 }) {
  const w = 680, padX = 16, top = 18, bot = h - 26;
  const arr = points.split(" ").map((pr) => {
    const [x, y] = pr.split(",").map(Number);
    return { x: padX + (x / 84) * (w - padX * 2), y: top + (1 - y / 21) * (bot - top) };
  });
  const line = smooth(arr);
  const area = line + ` L${arr[arr.length - 1].x},${h - 12} L${arr[0].x},${h - 12} Z`;
  const grid = [0, 1, 2, 3].map((i) => top + i * ((bot - top) / 3));
  return (
    <svg key={k} viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id={"ag" + k} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((y, i) => <line key={i} x1={padX} y1={y} x2={w - padX} y2={y} stroke="var(--border)" strokeWidth="1" />)}
      <path d={area} fill={`url(#ag${k})`} />
      <path className="chart-line draw" d={line} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {arr.map((p, i) => (
        <circle key={i} className="chart-dot" cx={p.x} cy={p.y} r="3.4" fill="var(--surface)" stroke="var(--accent-line)" strokeWidth="2" style={{ animationDelay: (0.5 + i * 0.07) + "s", transformOrigin: `${p.x}px ${p.y}px` }} />
      ))}
    </svg>
  );
}

/* ============================== profile + stats ============================== */
function SyncBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text-soft)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--pos)", boxShadow: "0 0 0 3px var(--pos-weak)" }}></span>
      Synced · {PROFILE.syncedAgo}
    </span>
  );
}

function HeaderBar() {
  const pv = useCountUp(1240);
  return (
    <div className="card reveal" style={{ padding: "15px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 15, minWidth: 0 }}>
        <Glyph name={PROFILE.name + " "} size={50} fontSize={20} />
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 21, lineHeight: 1.05 }}>{PROFILE.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--text-soft)", whiteSpace: "nowrap" }}>Mastery Rank {PROFILE.mr}</span>
            <SyncBadge />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">Portfolio value · 7d</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "flex-end", marginTop: 3 }}>
            <div className="display num" style={{ fontSize: 25 }}>{fmt(pv)}<span className="unit" style={{ fontSize: 15 }}> p</span></div>
            <Delta d={11} chip />
          </div>
        </div>
        <div style={{ flex: "none" }}><Spark points={PORTFOLIO_SPARK} color="var(--accent-line)" w={150} h={42} /></div>
      </div>
    </div>
  );
}

function StatCard({ s, i }) {
  const n = useCountUp(s.value);
  const up = s.delta == null || s.delta >= 0;
  return (
    <div className="card reveal lift" style={{ padding: "15px 18px", animationDelay: (0.08 + i * 0.07) + "s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="stat-label">{s.label}</div>
        {s.delta != null ? <Delta d={s.delta} chip /> : null}
      </div>
      <div className="stat-value num" style={{ fontSize: 33, marginTop: 8 }}>{fmt(n)}{s.unit ? <span className="unit" style={{ fontSize: 18 }}> {s.unit}</span> : null}</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 9, gap: 10 }}>
        <div className="stat-sub">{s.note}</div>
        <Spark points={s.spark} color={up ? "var(--pos)" : "var(--neg)"} w={76} h={26} />
      </div>
    </div>
  );
}

/* ============================== rows / tables ============================== */
function TrendRow({ p, cols, onSold, showDelta }) {
  const open = React.useContext(OpenPartContext);
  return (
    <div className={"trow hoverable" + (p.sold ? " is-sold" : "")} style={{ gridTemplateColumns: cols }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
        <Glyph name={p.name} size={32} />
        <div style={{ minWidth: 0 }}>
          <div className="row-name link-name" onClick={() => open(p)}>{p.name}</div>
          <div className="row-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{p.part}</span>{p.hot && !p.sold ? <span className="pill-hot">↑ Hot</span> : null}
          </div>
        </div>
      </div>
      <div className="num plat" style={{ fontSize: 16 }}>{p.plat}<span className="unit"> p</span></div>
      <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>×{p.qty}</div>
      <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>{p.duc > 0 ? p.duc + " d" : "—"}</div>
      {showDelta ? <div><Delta d={p.d} chip /></div> : null}
      <div style={{ textAlign: "right" }}>
        <button className="btn-sold" onClick={() => onSold()}>{p.sold ? "✓ Sold" : "Mark sold"}</button>
      </div>
    </div>
  );
}

/* ============================== dashboard (layout A) ============================== */
function DashboardScreen({ parts, onSold }) {
  const open = React.useContext(OpenPartContext);
  const cols = "minmax(0,1.5fr) 90px 84px 52px 78px 84px 116px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <HeaderBar />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
        {STATS.map((s, i) => <StatCard key={s.key} s={s} i={i} />)}
      </div>
      <div className="card reveal" style={{ padding: "16px 20px 8px", animationDelay: ".26s" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="sec-title">Trending in your inventory</div>
            <div style={{ fontSize: 13, color: "var(--text-soft)", marginTop: 2 }}>Sorted by market demand · tap a part for price history</div>
          </div>
          <span className="pill-hot" style={{ fontSize: 12 }}>{parts.filter((p) => !p.sold).length} active</span>
        </div>
        <div className="thead" style={{ gridTemplateColumns: cols }}>
          <div>Prime Part</div><div>Plat</div><div>7d</div><div>Qty</div><div>Ducats</div><div>Trend</div><div style={{ textAlign: "right" }}>Inventory</div>
        </div>
        {parts.map((p, i) => (
          <div key={i} className={"trow hoverable" + (p.sold ? " is-sold" : "")} style={{ gridTemplateColumns: cols }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
              <Glyph name={p.name} size={34} />
              <div style={{ minWidth: 0 }}>
                <div className="row-name link-name" onClick={() => open(p)}>{p.name}</div>
                <div className="row-sub" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{p.part}</span>{p.hot && !p.sold ? <span className="pill-hot">↑ Hot</span> : null}
                </div>
              </div>
            </div>
            <div className="num plat" style={{ fontSize: 16 }}>{p.plat}<span className="unit"> p</span></div>
            <div><Delta d={p.d} /></div>
            <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>×{p.qty}</div>
            <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>{p.duc > 0 ? p.duc + " d" : "—"}</div>
            <div><Spark points={p.spark} color={p.d >= 0 ? "var(--pos)" : "var(--neg)"} w={70} h={24} /></div>
            <div style={{ textAlign: "right" }}>
              <button className="btn-sold" onClick={() => onSold(i)}>{p.sold ? "✓ Sold" : "Mark sold"}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== search ============================== */
function partText(p) {
  return (p.name + " " + (p.part || p.sub || "") + " " + (p.cat || "")).toLowerCase();
}

function SearchInput({ query, setQuery, placeholder, autoFocus, style }) {
  return (
    <label className="search" style={style}>
      <Icon name="search" size={17} />
      <input className="search-field" value={query} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)} />
      {query ? <button type="button" className="search-clear" aria-label="Clear" onMouseDown={(e) => { e.preventDefault(); setQuery(""); }}>✕</button> : null}
    </label>
  );
}

function PartSearch({ pool, query, setQuery, onPick, placeholder, autoFocus }) {
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const q = query.trim().toLowerCase();
  const matches = q ? pool.filter((p) => partText(p).includes(q)).slice(0, 6) : [];
  const show = focus && q.length > 0;
  React.useEffect(() => { setHi(0); }, [query]);
  const onKey = (e) => {
    if (!show) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter" && matches[hi]) { e.preventDefault(); onPick(matches[hi]); }
    else if (e.key === "Escape") { e.target.blur(); }
  };
  return (
    <div className="search-wrap">
      <label className="search" style={{ width: "100%" }}>
        <Icon name="search" size={17} />
        <input className="search-field" value={query} placeholder={placeholder} autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)} onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)} onKeyDown={onKey} />
        {query ? <button type="button" className="search-clear" aria-label="Clear" onMouseDown={(e) => { e.preventDefault(); setQuery(""); }}>✕</button> : null}
      </label>
      {show ? (
        <div className="search-pop">
          {matches.length === 0 ? (
            <div className="so-empty">No parts match “{query.trim()}”.</div>
          ) : matches.map((p, i) => (
            <button key={i} type="button" className={"search-opt" + (i === hi ? " active" : "")}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); onPick(p); }}>
              <Glyph name={p.name} size={28} fontSize={12} />
              <span style={{ minWidth: 0 }}>
                <span className="so-name">{p.name}</span>
                <span className="so-sub" style={{ display: "block" }}>{p.part || p.sub}{p.cat ? " · " + p.cat : ""}</span>
              </span>
              <span className="so-plat num">{p.plat} p</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ============================== inventory ============================== */
const CATS = ["All", "Warframe", "Weapon", "Hot", "Sold"];
function InventoryScreen({ parts, onSold }) {
  const open = React.useContext(OpenPartContext);
  const [cat, setCat] = useState("All");
  const [query, setQuery] = useState("");
  const cols = "minmax(0,1fr) 90px 56px 78px 92px 116px";
  const q = query.trim().toLowerCase();
  const shown = parts.filter((p) => {
    const catOk = cat === "All" ? true : cat === "Hot" ? p.hot : cat === "Sold" ? p.sold : p.cat === cat;
    return catOk && (!q || partText(p).includes(q));
  });
  return (
    <div>
      <div className="reveal" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <PartSearch pool={parts} query={query} setQuery={setQuery} onPick={(p) => open(p)} placeholder="Search your prime parts…" />
        {CATS.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        <div className="chip" style={{ color: "var(--text)" }}>Sort: Plat ▾</div>
      </div>
      <div className="card reveal" style={{ padding: "16px 20px 8px", animationDelay: ".08s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div className="sec-title">Full inventory</div>
          <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>{shown.length} of {parts.length} parts</div>
        </div>
        <div className="thead" style={{ gridTemplateColumns: cols }}>
          <div>Prime Part</div><div>Plat</div><div>Qty</div><div>Ducats</div><div>7d</div><div style={{ textAlign: "right" }}>Inventory</div>
        </div>
        {shown.length === 0 ? (
          <div className="so-empty" style={{ padding: "34px 0" }}>No parts match your search.</div>
        ) : shown.map((p, i) => {
          const idx = parts.indexOf(p);
          return (
            <div key={i} className={"trow hoverable" + (p.sold ? " is-sold" : "")} style={{ gridTemplateColumns: cols }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                <Glyph name={p.name} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div className="row-name link-name" onClick={() => open(p)}>{p.name}</div>
                  <div className="row-sub">{p.part} · {p.cat}</div>
                </div>
              </div>
              <div className="num plat" style={{ fontSize: 16 }}>{p.plat}<span className="unit"> p</span></div>
              <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>×{p.qty}</div>
              <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>{p.duc > 0 ? p.duc : "—"}</div>
              <div><Delta d={p.d} /></div>
              <div style={{ textAlign: "right" }}>
                <button className="btn-sold" onClick={() => onSold(idx)}>{p.sold ? "✓ Sold" : "Mark sold"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== trends ============================== */
function TrendsScreen({ parts }) {
  const open = React.useContext(OpenPartContext);
  const [tf, setTf] = useState("7d");
  const [cat, setCat] = useState("Prime Parts");
  const meta = CATEGORIES[cat];
  const idx = useCountUp(meta.value);
  const movers = cat === "Prime Parts" ? [...parts].sort((a, b) => b.d - a.d).map(partToItem) : meta.movers;
  return (
    <div>
      <div className="reveal" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontSize: 13.5, color: "var(--text-soft)", fontWeight: 600 }}>Show</span>
        {Object.keys(CATEGORIES).map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 352px", gap: 22, alignItems: "start" }}>
        <div className="card reveal" style={{ padding: "18px 20px", animationDelay: ".06s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="eyebrow">{cat} · market index</div>
              <div style={{ fontSize: 13.5, color: "var(--text-soft)", marginTop: 4 }}>{meta.sub}</div>
            </div>
            <div className="seg">
              {["24h", "7d", "30d", "90d"].map((t) => <button key={t} aria-pressed={tf === t} onClick={() => setTf(t)}>{t}</button>)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "16px 0 10px" }}>
            <div className="display num" style={{ fontSize: 46 }}>{fmt(idx)}<span className="unit" style={{ fontSize: 22 }}> p</span></div>
            <Delta d={meta.delta} chip />
            <span style={{ fontSize: 13.5, color: "var(--text-soft)" }}>vs last {tf}</span>
          </div>
          <BigChart points={meta.spark} h={232} k={cat.length + tf.length} />
        </div>
        <div className="card reveal" style={{ padding: "16px 18px 8px", animationDelay: ".14s" }}>
          <div className="sec-title" style={{ fontSize: 19 }}>Top movers</div>
          <div style={{ fontSize: 12.5, color: "var(--text-faint)", margin: "3px 0 8px" }}>Tap an item for price history</div>
          {movers.map((p, i) => (
            <div key={i} className="trow hoverable link-name" onClick={() => open(p)} style={{ gridTemplateColumns: "1fr auto auto", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row-name" style={{ fontSize: 14.5 }}>{p.name}</div>
                <div className="num plat" style={{ fontSize: 13.5 }}>{p.plat} p</div>
              </div>
              <Spark points={p.spark} color={p.d >= 0 ? "var(--pos)" : "var(--neg)"} />
              <div style={{ width: 56, textAlign: "right" }}><Delta d={p.d} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================== sold history ============================== */
function SoldHistoryScreen() {
  const [tf, setTf] = useState("All time");
  const totalPlat = SOLD.reduce((a, s) => a + s.plat, 0);
  const totalItems = SOLD.reduce((a, s) => a + s.qty, 0);
  const best = SOLD.reduce((m, s) => s.plat > m.plat ? s : m, SOLD[0]);
  const earned = useCountUp(totalPlat);
  const HSTATS = [
    { label: "Platinum earned", value: fmt(earned), unit: "p", sub: "across all sales", accent: true },
    { label: "Items sold", value: totalItems, sub: `${SOLD.length} sales` },
    { label: "Best sale", value: best.plat, unit: "p", sub: best.name },
  ];
  const cols = "minmax(0,1fr) 104px 56px 132px 84px";
  return (
    <div>
      <div className="reveal" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
        <div className="seg">{["7d", "30d", "All time"].map((t) => <button key={t} aria-pressed={tf === t} onClick={() => setTf(t)}>{t}</button>)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 16 }}>
        {HSTATS.map((s, i) => (
          <div key={i} className="card reveal lift card-h" style={{ animationDelay: (0.05 + i * 0.06) + "s" }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value num" style={{ fontSize: 34, marginTop: 6, color: s.accent ? "var(--accent-ink)" : "var(--text)" }}>{s.value}{s.unit ? <span className="unit" style={{ fontSize: 18 }}> {s.unit}</span> : null}</div>
            <div className="stat-sub" style={{ marginTop: 5 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="card reveal" style={{ padding: "16px 20px 8px", animationDelay: ".22s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div className="sec-title">Sale history</div>
          <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>{SOLD.length} sales · {tf}</div>
        </div>
        <div className="thead" style={{ gridTemplateColumns: cols }}>
          <div>Prime Part</div><div>Sold for</div><div>Qty</div><div>Buyer</div><div style={{ textAlign: "right" }}>Date</div>
        </div>
        {SOLD.map((s, i) => (
          <div key={i} className="trow" style={{ gridTemplateColumns: cols }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
              <Glyph name={s.name} size={32} />
              <div style={{ minWidth: 0 }}>
                <div className="row-name">{s.name}</div>
                <div className="row-sub">{s.part}</div>
              </div>
            </div>
            <div className="num" style={{ fontSize: 16, fontWeight: 700, color: "var(--pos)" }}>+{s.plat}<span className="unit"> p</span></div>
            <div className="num" style={{ fontSize: 15, color: "var(--text-soft)" }}>×{s.qty}</div>
            <div style={{ fontSize: 14.5, color: "var(--text-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.buyer}</div>
            <div style={{ fontSize: 14.5, color: "var(--text-soft)", textAlign: "right" }}>{s.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================== watchlist ============================== */
/* ============================== add a part to inventory: catalog ============================== */
const CATALOG = [
  { name: "Mesa Prime",     part: "Systems Blueprint", cat: "Warframe", plat: 45,  duc: 15, d: +18, spark: "0,5 14,7 28,6 42,12 56,13 70,17 84,20" },
  { name: "Saryn Prime",    part: "Chassis",           cat: "Warframe", plat: 28,  duc: 65, d: +9,  spark: "0,9 14,11 28,10 42,13 56,14 70,18 84,19" },
  { name: "Rhino Prime",    part: "Set",               cat: "Warframe", plat: 75,  duc: 0,  d: +3,  spark: "0,11 14,12 28,11 42,13 56,12 70,14 84,15" },
  { name: "Nidus Prime",    part: "Neuroptics",        cat: "Warframe", plat: 30,  duc: 45, d: +7,  spark: "0,10 14,11 28,12 42,13 56,14 70,15 84,17" },
  { name: "Ember Prime",    part: "Blueprint",         cat: "Warframe", plat: 18,  duc: 15, d: -2,  spark: "0,13 14,12 28,13 42,12 56,11 70,12 84,11" },
  { name: "Loki Prime",     part: "Barrel",            cat: "Weapon",   plat: 14,  duc: 45, d: +1,  spark: "0,12 14,12 28,12 42,13 56,12 70,13 84,13" },
  { name: "Trinity Prime",  part: "Systems",           cat: "Warframe", plat: 12,  duc: 65, d: +4,  spark: "0,11 14,12 28,11 42,12 56,13 70,14 84,15" },
  { name: "Banshee Prime",  part: "Chassis",           cat: "Warframe", plat: 9,   duc: 65, d: -3,  spark: "0,14 14,13 28,14 42,13 56,12 70,11 84,10" },
  { name: "Volt Prime",     part: "Set",               cat: "Warframe", plat: 90,  duc: 0,  d: +6,  spark: "0,10 14,11 28,12 42,12 56,14 70,15 84,16" },
  { name: "Nova Prime",     part: "Systems",           cat: "Warframe", plat: 16,  duc: 65, d: +5,  spark: "0,9 14,10 28,11 42,12 56,13 70,14 84,15" },
  { name: "Vauban Prime",   part: "Blueprint",         cat: "Warframe", plat: 22,  duc: 15, d: -1,  spark: "0,12 14,12 28,11 42,12 56,12 70,11 84,12" },
  { name: "Garuda Prime",   part: "Talons Blueprint",  cat: "Weapon",   plat: 20,  duc: 15, d: +9,  spark: "0,9 14,10 28,11 42,12 56,14 70,16 84,18" },
  { name: "Baruuk Prime",   part: "Neuroptics",        cat: "Warframe", plat: 40,  duc: 45, d: +6,  spark: "0,11 14,12 28,11 42,13 56,13 70,14 84,15" },
  { name: "Gara Prime",     part: "Chassis",           cat: "Warframe", plat: 11,  duc: 65, d: +2,  spark: "0,11 14,11 28,12 42,11 56,12 70,12 84,13" },
  { name: "Protea Prime",   part: "Set",               cat: "Warframe", plat: 145, duc: 0,  d: +12, spark: "0,8 14,9 28,10 42,12 56,14 70,17 84,20" },
  { name: "Dagath Prime",   part: "Neuroptics",        cat: "Warframe", plat: 35,  duc: 45, d: +15, spark: "0,7 14,8 28,10 42,11 56,13 70,16 84,19" },
];

const WATCHLIST_INIT = [
  { name: "Ash Prime",      sub: "Set",        plat: 110, target: 90,  alert: true,  d: +5,  spark: "0,13 14,12 28,13 42,11 56,12 70,10 84,11" },
  { name: "Equinox Prime",  sub: "Set",        plat: 120, target: 100, alert: true,  d: -6,  spark: "0,16 14,15 28,16 42,14 56,13 70,12 84,11" },
  { name: "Nezha Prime",    sub: "Set",        plat: 70,  target: 55,  alert: false, d: +2,  spark: "0,11 14,12 28,11 42,12 56,11 70,12 84,12" },
  { name: "Vauban Prime",   sub: "Systems",    plat: 35,  target: 30,  alert: true,  d: -3,  spark: "0,14 14,13 28,14 42,12 56,13 70,11 84,10" },
  { name: "Titania Prime",  sub: "Blueprint",  plat: 18,  target: 20,  alert: true,  d: -8,  spark: "0,17 14,15 28,16 42,13 56,12 70,10 84,9" },
];
const CANDIDATES = [
  { name: "Mirage Prime",  sub: "Set",        plat: 85, d: +4,  spark: "0,10 14,11 28,12 42,13 56,14 70,15 84,16" },
  { name: "Garuda Prime",  sub: "Set",        plat: 95, d: +9,  spark: "0,9 14,10 28,11 42,12 56,14 70,16 84,18" },
  { name: "Zephyr Prime",  sub: "Set",        plat: 60, d: -2,  spark: "0,13 14,12 28,13 42,12 56,11 70,12 84,11" },
  { name: "Baruuk Prime",  sub: "Neuroptics", plat: 40, d: +6,  spark: "0,11 14,12 28,11 42,13 56,13 70,14 84,15" },
  { name: "Limbo Prime",   sub: "Systems",    plat: 25, d: +1,  spark: "0,12 14,12 28,12 42,13 56,12 70,13 84,13" },
  { name: "Atlas Prime",   sub: "Chassis",    plat: 30, d: -4,  spark: "0,15 14,14 28,15 42,13 56,12 70,11 84,10" },
];

function AddWatchModal({ taken, onAdd, onClose }) {
  const open = React.useContext(OpenPartContext);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const avail = CANDIDATES.filter((c) => !taken.includes(c.name) && (!query || partText(c).includes(query)));
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="display" style={{ fontSize: 22 }}>Add to watchlist</div>
            <div style={{ fontSize: 13.5, color: "var(--text-soft)", marginTop: 2 }}>Track a part and get alerted when it hits your target price</div>
          </div>
          <button className="x-btn" onClick={onClose}>✕</button>
        </div>
        <SearchInput query={q} setQuery={setQ} placeholder="Search prime parts to track…" autoFocus style={{ margin: "16px 0 12px" }} />
        <div style={{ maxHeight: 320, overflow: "auto", margin: "0 -4px" }}>
          {avail.length === 0 ? (
            <div className="so-empty" style={{ padding: "28px 0" }}>{query ? `No parts match “${q.trim()}”.` : "Everything's already on your watchlist."}</div>
          ) : avail.map((c, i) => (
            <div key={i} className="trow" style={{ gridTemplateColumns: "1fr auto auto", gap: 12, cursor: "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Glyph name={c.name} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div className="row-name link-name" onClick={() => open(c)}>{c.name}</div>
                  <div className="row-sub">{c.sub}</div>
                </div>
              </div>
              <div className="num plat" style={{ fontSize: 15, alignSelf: "center" }}>{c.plat} p</div>
              <button className="btn btn-primary" style={{ padding: "7px 14px" }} onClick={() => onAdd(c)}>+ Add</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const WL_FILTERS = ["All", "At target", "Watching"];
function WatchlistScreen({ watch, setWatch }) {
  const open = React.useContext(OpenPartContext);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("All");
  const cols = "minmax(0,1.5fr) 92px 150px minmax(0,150px) 44px 40px";

  const atTarget = (w) => w.plat <= w.target;
  const shown = watch.filter((w) => filter === "All" ? true : filter === "At target" ? atTarget(w) : !atTarget(w));

  const setTarget = (name, dv) => setWatch((p) => p.map((w) => w.name === name ? { ...w, target: Math.max(1, w.target + dv) } : w));
  const toggleAlert = (name) => setWatch((p) => p.map((w) => w.name === name ? { ...w, alert: !w.alert } : w));
  const remove = (name) => setWatch((p) => p.filter((w) => w.name !== name));
  const add = (c) => { setWatch((p) => [...p, { ...c, target: Math.round(c.plat * 0.85), alert: true }]); };

  return (
    <div>
      <div className="reveal" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="seg">{WL_FILTERS.map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add to watchlist</button>
      </div>

      <div className="card reveal" style={{ padding: "16px 20px 8px", animationDelay: ".06s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div className="sec-title">Tracked parts</div>
          <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>{watch.filter(atTarget).length} at target · {watch.length} tracked</div>
        </div>
        {shown.length === 0 ? (
          <div className="empty">
            <Glyph name="W " size={56} fontSize={22} />
            <div>
              <div className="display" style={{ fontSize: 20 }}>{watch.length === 0 ? "Nothing tracked yet" : "No parts match this filter"}</div>
              <div style={{ color: "var(--text-soft)", fontSize: 14, marginTop: 4 }}>Add a part to get alerted when it drops to your target price.</div>
            </div>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add to watchlist</button>
          </div>
        ) : (
          <React.Fragment>
            <div className="thead" style={{ gridTemplateColumns: cols }}>
              <div>Prime Part</div><div>Current</div><div>Target</div><div>Status</div><div>Alert</div><div></div>
            </div>
            {shown.map((w, i) => {
              const hit = atTarget(w);
              const diff = w.plat - w.target;
              return (
                <div key={w.name} className="trow hoverable" style={{ gridTemplateColumns: cols }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
                    <Glyph name={w.name} size={34} />
                    <div style={{ minWidth: 0 }}>
                      <div className="row-name link-name" onClick={() => open(w)}>{w.name}</div>
                      <div className="row-sub">{w.sub}</div>
                    </div>
                  </div>
                  <div className="num plat" style={{ fontSize: 16 }}>{w.plat}<span className="unit"> p</span></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button className="step" onClick={() => setTarget(w.name, -5)}>−</button>
                    <span className="target-num">{w.target}<span className="unit" style={{ fontWeight: 400, fontSize: 12 }}> p</span></span>
                    <button className="step" onClick={() => setTarget(w.name, +5)}>+</button>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {hit
                      ? <span className="delta up" style={{ fontWeight: 700 }}>✓ At target — buy now</span>
                      : <span style={{ fontSize: 13.5, color: "var(--text-soft)" }}><b className="num" style={{ color: "var(--text)" }}>{diff} p</b> to go</span>}
                  </div>
                  <button className={"icon-btn" + (w.alert ? " on" : "")} title={w.alert ? "Alert on" : "Alert off"} onClick={() => toggleAlert(w.name)}><Icon name="bell" size={16} /></button>
                  <button className="icon-btn" title="Remove" onClick={() => remove(w.name)} style={{ border: "none", background: "transparent", fontSize: 16 }}>✕</button>
                </div>
              );
            })}
          </React.Fragment>
        )}
      </div>

      {adding ? <AddWatchModal taken={watch.map((w) => w.name)} onAdd={add} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/* ============================== list a part ============================== */
/* ============================== add a part to inventory ============================== */
function AddPartModal({ parts, onClose, onAdd }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState(1);
  const [done, setDone] = useState(false);
  const query = q.trim().toLowerCase();
  const list = query ? CATALOG.filter((p) => partText(p).includes(query)) : CATALOG;

  const ownedQty = (p) => { const m = parts.find((x) => x.name === p.name && x.part === p.part); return m ? m.qty : 0; };
  const choose = (p) => { setPick(p); setQty(1); setQ(""); };
  const already = pick ? ownedQty(pick) : 0;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        {done ? (
          <div className="empty" style={{ padding: "30px 10px 14px" }}>
            <span className="glyph" style={{ width: 60, height: 60, fontSize: 28 }}>✓</span>
            <div>
              <div className="display" style={{ fontSize: 23 }}>Added to inventory</div>
              <div style={{ color: "var(--text-soft)", fontSize: 14, marginTop: 5, lineHeight: 1.5 }}>
                {qty}× <b style={{ color: "var(--text)" }}>{pick.name}</b> {pick.part} added to your inventory{already > 0 ? ` (now ×${already + qty})` : ""}.
              </div>
            </div>
            <div style={{ display: "flex", gap: 11 }}>
              <button className="btn" onClick={() => { setDone(false); setPick(null); }}>Add another</button>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <React.Fragment>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="display" style={{ fontSize: 22 }}>Add a part to inventory</div>
                <div style={{ fontSize: 13.5, color: "var(--text-soft)", marginTop: 2 }}>{pick ? "How many do you own?" : "Search the prime catalog and add what you've got"}</div>
              </div>
              <button className="x-btn" onClick={onClose}>✕</button>
            </div>

            {!pick ? (
              <React.Fragment>
                <div style={{ margin: "16px 0 4px" }}>
                  <PartSearch pool={CATALOG} query={q} setQuery={setQ} onPick={choose} placeholder="Search prime parts…" autoFocus />
                </div>
                <div className="field-label" style={{ marginTop: 14 }}>Prime catalog</div>
                <div style={{ maxHeight: 296, overflow: "auto", margin: "0 -4px" }}>
                  {list.length === 0 ? (
                    <div className="so-empty" style={{ padding: "24px 0" }}>No parts match “{q.trim()}”.</div>
                  ) : list.map((p, i) => {
                    const own = ownedQty(p);
                    return (
                      <button key={i} type="button" className="search-opt" onClick={() => choose(p)} style={{ gridTemplateColumns: "auto 1fr auto auto", padding: "9px" }}>
                        <Glyph name={p.name} size={32} />
                        <span style={{ minWidth: 0 }}>
                          <span className="so-name">{p.name}</span>
                          <span className="so-sub" style={{ display: "block" }}>{p.part} · {p.cat}</span>
                        </span>
                        {own > 0 ? <span className="pill-hot" style={{ fontSize: 11 }}>owned ×{own}</span> : <span></span>}
                        <span className="so-plat num">{p.plat} p</span>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div className="picked" style={{ marginTop: 16 }}>
                  <Glyph name={pick.name} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-name">{pick.name}</div>
                    <div className="row-sub">{pick.part} · {pick.cat} · market {pick.plat} p{already > 0 ? ` · already own ×${already}` : ""}</div>
                  </div>
                  <button className="btn" style={{ padding: "6px 12px" }} onClick={() => setPick(null)}>Change</button>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, marginTop: 18, flexWrap: "wrap" }}>
                  <div>
                    <label className="field-label">Quantity you own</label>
                    <div className="num-input" style={{ width: 150 }}>
                      <button className="step" onClick={() => setQty((v) => Math.max(1, v - 1))}>−</button>
                      <input type="number" value={qty} min="1" onChange={(e) => setQty(Math.max(1, Math.round(+e.target.value) || 1))} />
                      <button className="step" onClick={() => setQty((v) => v + 1)}>+</button>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="field-label" style={{ marginBottom: 3 }}>Inventory value added</div>
                    <div className="display num" style={{ fontSize: 24, color: "var(--accent-ink)" }}>{(pick.plat * qty).toLocaleString()}<span className="unit" style={{ fontSize: 15 }}> p</span></div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 11, marginTop: 20, justifyContent: "flex-end" }}>
                  <button className="btn" onClick={onClose}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => { if (onAdd) onAdd(pick, qty); setDone(true); }}>Add {qty}× to inventory</button>
                </div>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}


function StubScreen({ title, lines }) {
  return (
    <div className="card reveal card-h" style={{ padding: "70px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <Glyph name="W " size={64} fontSize={26} />
      <div className="display" style={{ fontSize: 26 }}>{title}</div>
      <div style={{ color: "var(--text-soft)", fontSize: 15, maxWidth: 440, lineHeight: 1.5 }}>{lines}</div>
    </div>
  );
}

/* ============================== item detail ============================== */
function ItemDetail({ item, onClose }) {
  const [tf, setTf] = useState("7d");
  if (!item) return null;
  const owned = typeof item.qty === "number";
  const sub = item.sub || (item.part ? item.part + (item.cat ? " · " + item.cat : "") : "");
  const low = Math.round(item.plat * 0.82), high = Math.round(item.plat * 1.15);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 15 }}>
          <Glyph name={item.name} size={52} fontSize={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="display" style={{ fontSize: 25, lineHeight: 1.1 }}>{item.name}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-soft)", marginTop: 2 }}>{sub}</div>
          </div>
          <button className="x-btn" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 13, margin: "20px 0 3px" }}>
          <div className="display num" style={{ fontSize: 46, color: "var(--accent-ink)" }}>{item.plat}<span className="unit" style={{ fontSize: 22 }}> p</span></div>
          <Delta d={item.d} chip />
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-soft)" }}>Current platinum value · {tf} change</div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 6px", flexWrap: "wrap", gap: 10 }}>
          <div className="eyebrow">Price history</div>
          <div className="seg">{["24h", "7d", "30d", "90d"].map((t) => <button key={t} aria-pressed={tf === t} onClick={() => setTf(t)}>{t}</button>)}</div>
        </div>
        <BigChart points={item.spark} h={196} k={item.name.length + tf.length} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 18 }}>
          {[["7d range", `${low}–${high} p`], ["Ducat value", item.duc ? `${item.duc} d` : "—"], ["You own", owned ? `×${item.qty}` : "—"]].map((c, i) => (
            <div key={i} className="tile"><div className="k">{c[0]}</div><div className="v num">{c[1]}</div></div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 11, marginTop: 20, flexWrap: "wrap" }}>
          {owned
            ? <button className="btn">Mark sold</button>
            : <button className="btn btn-primary">+ Add to inventory</button>}
          <button className="btn">+ Add to watchlist</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== sidebar ============================== */
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "inventory", label: "Inventory", icon: "inventory", badge: "86" },
  { id: "trends",    label: "Trends",    icon: "trends" },
  { id: "history",   label: "Sold History", icon: "history" },
  { id: "watchlist", label: "Watchlist", icon: "watchlist", badge: "5" },
];
const TITLES = {
  dashboard: ["Dashboard", "Overview of your account"],
  inventory: ["Inventory", "Every prime part you own"],
  trends:    ["Trends & Analytics", "Market movement over time"],
  history:   ["Sold History", "What you've sold and earned"],
  watchlist: ["Watchlist", "Parts you're tracking"],
};

function Sidebar({ screen, setScreen, theme, toggleTheme, watchCount, onList }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">P</span>
        <h1>Primely<span className="dot">.</span></h1>
      </div>
      <button className="nav-cta" onClick={onList}>+ Add a part</button>
      <div className="grp-label">Menu</div>
      {NAV.map((n) => {
        const badge = n.id === "watchlist" ? String(watchCount) : n.badge;
        return (
        <button key={n.id} className="nav-item" aria-current={screen === n.id} onClick={() => setScreen(n.id)}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
          {badge ? <span className="badge">{badge}</span> : null}
        </button>
        );
      })}
      <div className="nav-spacer"></div>
      <div className="nav-foot">
        <button className="theme-toggle" onClick={toggleTheme}>
          <span className="knob"><Icon name={theme === "dark" ? "moon" : "sun"} size={15} /></span>
          <span>{theme === "dark" ? "Dark" : "Light"} mode</span>
        </button>
        <button className="nav-item"><Icon name="settings" /><span>Settings</span></button>
        <div className="me">
          <Glyph name={PROFILE.name + " "} size={30} fontSize={12} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{PROFILE.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>MR {PROFILE.mr}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ============================== accent theming ============================== */
/* ============================== accent + font theming ============================== */
const FONTS = {
  Grotesk:   ["'Space Grotesk', system-ui, sans-serif", "'Hanken Grotesk', system-ui, sans-serif"],
  Editorial: ["'Newsreader', Georgia, serif",           "'Hanken Grotesk', system-ui, sans-serif"],
  Clean:     ["'Hanken Grotesk', system-ui, sans-serif", "'Hanken Grotesk', system-ui, sans-serif"],
};
function applyFont(key) {
  const f = FONTS[key] || FONTS.Grotesk;
  document.documentElement.style.setProperty("--font-display", f[0]);
  document.documentElement.style.setProperty("--font-sans", f[1]);
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function rgba(h, al) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${al})`; }
function applyAccent(base, theme) {
  const root = document.documentElement.style;
  const accent = theme === "dark" ? mix(base, "#ffffff", 0.30) : base;
  root.setProperty("--accent", accent);
  root.setProperty("--accent-line", accent);
  root.setProperty("--accent-ink", theme === "dark" ? mix(base, "#ffffff", 0.5) : mix(base, "#000000", 0.12));
  root.setProperty("--accent-weak", rgba(accent, theme === "dark" ? 0.15 : 0.10));
  root.setProperty("--glow", theme === "dark" ? `0 0 22px ${rgba(accent, 0.32)}` : "0 0 0 rgba(0,0,0,0)");
}

/* ============================== app ============================== */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#0d9488",
  "font": "Grotesk",
  "defaultTheme": "light"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [theme, setTheme] = useState(() => localStorage.getItem("primely-theme") || t.defaultTheme || "light");
  const [screen, setScreen] = useState("dashboard");
  const [parts, setParts] = useState(PARTS);
  const [watch, setWatch] = useState(WATCHLIST_INIT);
  const [selected, setSelected] = useState(null);
  const [listing, setListing] = useState(false);

  const onSold = (i) => setParts((prev) => prev.map((p, idx) => idx === i ? { ...p, sold: !p.sold } : p));

  const onAddPart = (item, qty) => setParts((prev) => {
    const i = prev.findIndex((p) => p.name === item.name && p.part === item.part);
    if (i >= 0) return prev.map((p, idx) => idx === i ? { ...p, qty: p.qty + qty, sold: false } : p);
    return [...prev, { name: item.name, part: item.part, cat: item.cat, plat: item.plat, qty, duc: item.duc || 0, d: item.d || 0, hot: false, sold: false, spark: item.spark }];
  });

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("primely-theme", theme);
    applyAccent(t.accent, theme);
  }, [theme, t.accent]);

  React.useEffect(() => { applyFont(t.font); }, [t.font]);

  React.useEffect(() => {
    const el = document.documentElement; el.classList.remove("revealed");
    const id = setTimeout(() => el.classList.add("revealed"), 1500);
    return () => clearTimeout(id);
  }, [screen]);

  const [title, sub] = TITLES[screen];

  return (
    <OpenPartContext.Provider value={setSelected}>
      <div className="shell">
        <Sidebar screen={screen} setScreen={setScreen} theme={theme} toggleTheme={() => setTheme((x) => x === "dark" ? "light" : "dark")} watchCount={watch.length} onList={() => setListing(true)} />
        <div className="main">
          <header className="topbar">
            <div>
              <h2 className="page-h" key={screen}>{title}</h2>
              <div className="page-sub">{sub}</div>
            </div>
          </header>
          <main className="content" key={screen}>
            {screen === "dashboard" && <DashboardScreen parts={parts} onSold={onSold} />}
            {screen === "inventory" && <InventoryScreen parts={parts} onSold={onSold} />}
            {screen === "trends" && <TrendsScreen parts={parts} />}
            {screen === "history" && <SoldHistoryScreen />}
            {screen === "watchlist" && <WatchlistScreen watch={watch} setWatch={setWatch} />}
          </main>
        </div>

        <TweaksPanel title="Tweaks">
          <TweakSection label="Theme" />
          <TweakRadio label="Mode" value={theme} options={["light", "dark"]} onChange={(v) => setTheme(v)} />
          <TweakColor label="Accent" value={t.accent}
            options={["#0d9488", "#4f46e5", "#7c3aed", "#059669"]}
            onChange={(v) => setTweak("accent", v)} />
          <TweakSection label="Typeface" />
          <TweakRadio label="Font" value={t.font} options={["Grotesk", "Editorial", "Clean"]} onChange={(v) => setTweak("font", v)} />
        </TweaksPanel>

        <ItemDetail item={selected} onClose={() => setSelected(null)} />
        {listing ? <AddPartModal parts={parts} onClose={() => setListing(false)} onAdd={onAddPart} /> : null}
      </div>
    </OpenPartContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
