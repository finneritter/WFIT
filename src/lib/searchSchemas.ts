// Per-screen search schemas: which is:-flags, keyword fields, and numeric fields
// the topbar query can use on each page. Pure data over the row types — these
// drive both the compiled predicate (compileQuery) and the autocomplete.
import type { ScreenId } from "../components/Sidebar";
import type { AnySearchSchema, FieldDef, SearchSchema } from "./searchQuery";
import type {
  BuyRow,
  CatalogRow,
  CrackPlanRow,
  DucatRow,
  GearRow,
  InventoryRow,
  ListingRow,
  OwnedArcane,
  RecommendationRow,
  RelicRow,
  ResourceRow,
  RivenResult,
  SaleRow,
  SetRow,
  TrendRow,
  VendorIntelRow,
  WatchRow,
} from "./types";

const CATEGORIES = ["warframe", "weapon", "set", "mod", "arcane"] as const;
const TRENDS = ["up", "down", "flat"] as const;
const RARITIES = ["common", "uncommon", "rare", "legendary"] as const;
const SOURCES = ["manual", "wfm_import", "de_scan"] as const;

// Whole days since an RFC3339 timestamp; null for collapsed-set rows (no date).
const daysSince = (iso: string): number | null =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

// `cat:`/`category:` alias share one FieldDef object — the autocomplete dedupes
// by object identity so only `cat:` is suggested.
function catField<Row>(get: (r: Row) => string | null | undefined): FieldDef<Row> {
  return { kind: "enum", get, values: CATEGORIES, hint: "item category" };
}
function trendField<Row>(get: (r: Row) => string | null | undefined): FieldDef<Row> {
  return { kind: "enum", get, values: TRENDS, hint: "price direction" };
}

export const inventorySchema: SearchSchema<InventoryRow> = (() => {
  const cat = catField<InventoryRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
      hot: { test: (r) => r.trend === "up", hint: "trending up" },
      excluded: { test: (r) => r.excluded, hint: "excluded from portfolio value" },
      scanned: { test: (r) => r.source === "de_scan", hint: "imported from the game" },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      trend: trendField((r) => r.trend),
      source: {
        kind: "enum",
        get: (r) => r.source || null,
        values: SOURCES,
        hint: "how it was added",
      },
      held: { kind: "number", get: (r) => daysSince(r.first_added_at), hint: "days held" },
      rarity: { kind: "enum", get: (r) => r.mod_rarity, values: RARITIES, hint: "mod rarity" },
      confidence: {
        kind: "enum",
        get: (r) => r.confidence,
        values: ["high", "medium", "low"],
        hint: "value confidence",
      },
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      qty: { kind: "number", get: (r) => r.qty, hint: "owned quantity" },
      ducat: { kind: "number", get: (r) => r.ducats, hint: "ducats per unit" },
      delta: { kind: "number", get: (r) => r.delta_7d, hint: "7d % move" },
      volume: { kind: "number", get: (r) => r.volume_7d, hint: "7d trade volume" },
      value: {
        kind: "number",
        get: (r) => r.realizable_plat ?? r.value_plat ?? (r.median_plat ?? 0) * r.qty,
        hint: "stack value (plat)",
      },
    },
  };
})();

const marketDper = (r: CatalogRow): number | null =>
  r.ducats != null && r.median_plat ? r.ducats / r.median_plat : null;

export const marketSchema: SearchSchema<CatalogRow> = (() => {
  const cat = catField<CatalogRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
      owned: { test: (r) => r.owned_qty > 0, hint: "in your inventory" },
      watched: { test: (r) => r.on_watchlist, hint: "on your watchlist" },
      inbuy: { test: (r) => r.buy_qty > 0, hint: "on your buy list" },
      hot: { test: (r) => r.trend === "up", hint: "trending up" },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      trend: trendField((r) => r.trend),
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      ducat: { kind: "number", get: (r) => r.ducats, hint: "ducats per unit" },
      dp: { kind: "number", get: marketDper, hint: "ducats per plat" },
      qty: { kind: "number", get: (r) => r.owned_qty, hint: "owned quantity" },
      delta: { kind: "number", get: (r) => r.delta_7d, hint: "7d % move" },
      volume: { kind: "number", get: (r) => r.volume_7d, hint: "7d trade volume" },
    },
  };
})();

export const watchlistSchema: SearchSchema<WatchRow> = (() => {
  const cat = catField<WatchRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
      hot: { test: (r) => r.trend === "up", hint: "trending up" },
      attarget: {
        test: (r) =>
          r.target_plat != null && r.median_plat != null && r.median_plat <= r.target_plat,
        hint: "price at/below your target",
      },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      trend: trendField((r) => r.trend),
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      delta: { kind: "number", get: (r) => r.delta_7d, hint: "7d % move" },
      target: { kind: "number", get: (r) => r.target_plat, hint: "your buy target (plat)" },
    },
  };
})();

export const buySchema: SearchSchema<BuyRow> = (() => {
  const cat = catField<BuyRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
      hot: { test: (r) => r.trend === "up", hint: "trending up" },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      trend: trendField((r) => r.trend),
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      qty: { kind: "number", get: (r) => r.buy_qty, hint: "quantity to buy" },
      total: {
        kind: "number",
        get: (r) => (r.median_plat ?? 0) * r.buy_qty,
        hint: "line total (plat)",
      },
    },
  };
})();

export const setsSchema: SearchSchema<SetRow> = (() => {
  const cat = catField<SetRow>((r) => r.category);
  return {
    text: (r) => `${r.set_name} ${r.category}`,
    is: {
      complete: { test: (r) => r.complete, hint: "all parts owned" },
    },
    fields: {
      cat,
      category: cat,
      missing: {
        kind: "number",
        get: (r) => r.total_parts - r.owned_parts,
        hint: "parts still missing",
      },
      owned: { kind: "number", get: (r) => r.owned_parts, hint: "parts owned" },
      value: { kind: "number", get: (r) => r.set_value, hint: "full-set value (plat)" },
      tocomplete: { kind: "number", get: (r) => r.missing_value, hint: "plat to complete" },
    },
  };
})();

export const ducatsSchema: SearchSchema<DucatRow> = {
  text: (r) => `${r.display_name} ${r.part_type}`,
  is: {
    vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
    hot: { test: (r) => r.trend === "up", hint: "trending up" },
  },
  fields: {
    type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
    trend: trendField((r) => r.trend),
    verdict: {
      kind: "enum",
      get: (r) => r.verdict,
      values: ["ducat", "plat"],
      hint: "ducat it vs sell for plat",
    },
    plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
    qty: { kind: "number", get: (r) => r.qty, hint: "owned quantity" },
    ducat: { kind: "number", get: (r) => r.ducats, hint: "ducats per unit" },
    dp: { kind: "number", get: (r) => r.ducats_per_plat, hint: "ducats per plat" },
  },
};

export const arcanesSchema: SearchSchema<OwnedArcane> = {
  text: (r) => `${r.display_name} ${r.collection ?? ""}`,
  is: {
    sell: { test: (r) => r.sell_qty > 0, hint: "has copies worth selling" },
    dissolve: { test: (r) => r.dissolve_qty > 0, hint: "has copies worth dissolving" },
  },
  fields: {
    rarity: { kind: "enum", get: (r) => r.rarity, values: RARITIES, hint: "arcane rarity" },
    verdict: {
      kind: "enum",
      get: (r) => r.verdict,
      values: ["sell", "dissolve"],
      hint: "recommended action",
    },
    collection: { kind: "text", get: (r) => r.collection, hint: "Vosfor collection" },
    trend: trendField((r) => r.trend),
    plat: { kind: "number", get: (r) => r.plat, hint: "unranked price (plat)" },
    qty: { kind: "number", get: (r) => r.qty, hint: "owned copies" },
    vosfor: { kind: "number", get: (r) => r.vosfor, hint: "Vosfor per copy" },
    value: {
      kind: "number",
      get: (r) => r.sell_plat + r.dissolve_plat_equiv,
      hint: "total value (plat)",
    },
  },
};

const RELIC_TIERS = ["lith", "meso", "neo", "axi", "requiem"] as const;
const REFINEMENTS = ["intact", "exceptional", "flawless", "radiant"] as const;

export const relicsSchema: SearchSchema<RelicRow> = {
  text: (r) => `${r.display_name} ${r.tier} ${r.refinement} ${r.best_reward ?? ""}`,
  is: {
    scanned: { test: (r) => r.source === "de_scan", hint: "imported from the game" },
    vaulted: { test: (r) => r.relic_vaulted, hint: "a vaulted (unfarmable) relic" },
  },
  fields: {
    tier: { kind: "enum", get: (r) => r.tier, values: RELIC_TIERS, hint: "relic tier" },
    refinement: {
      kind: "enum",
      get: (r) => r.refinement,
      values: REFINEMENTS,
      hint: "refinement level",
    },
    qty: { kind: "number", get: (r) => r.qty, hint: "owned count" },
    ev: { kind: "number", get: (r) => r.ev_plat, hint: "expected plat per relic" },
    value: { kind: "number", get: (r) => r.ev_plat * r.qty, hint: "total expected plat" },
  },
};

// The Relics "To crack" tab compiles this against the topbar query (the screen's
// registered autocomplete schema stays `relicsSchema`, for the All-relics table).
export const crackPlanSchema: SearchSchema<CrackPlanRow> = {
  text: (r) =>
    `${r.display_name} ${r.tier} ${r.refinement} ${r.drops.map((d) => d.reward_name).join(" ")}`,
  is: {
    now: { test: (r) => r.crackable_now, hint: "a live fissure can crack it now" },
    set: { test: (r) => r.sets.length > 0, hint: "completes a one-away set" },
    wanted: { test: (r) => r.drops.some((d) => d.wanted), hint: "drops a watch/buy-list item" },
    vaulted: { test: (r) => r.relic_vaulted, hint: "a vaulted (unfarmable) relic" },
  },
  fields: {
    tier: { kind: "enum", get: (r) => r.tier, values: RELIC_TIERS, hint: "relic tier" },
    qty: { kind: "number", get: (r) => r.qty, hint: "owned count" },
    ev: { kind: "number", get: (r) => r.ev_plat, hint: "expected plat per relic" },
  },
};

export const soldSchema: SearchSchema<SaleRow> = (() => {
  const cat = catField<SaleRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.category} ${r.notes ?? ""}`,
    is: {},
    fields: {
      cat,
      category: cat,
      qty: { kind: "number", get: (r) => r.qty, hint: "units sold" },
      unit: { kind: "number", get: (r) => r.plat_per_unit, hint: "plat per unit" },
      total: {
        kind: "number",
        get: (r) => (r.plat_per_unit ?? 0) * r.qty,
        hint: "sale total (plat)",
      },
      days: {
        kind: "number",
        get: (r) => Math.floor((Date.now() - new Date(r.sold_at).getTime()) / 86_400_000),
        hint: "days since sold",
      },
    },
  };
})();

export const listingsSchema: SearchSchema<ListingRow> = {
  text: (r) => `${r.display_name} ${r.part_type}`,
  is: {
    visible: { test: (r) => r.visible, hint: "order is public" },
    hidden: { test: (r) => !r.visible, hint: "order is invisible" },
    undercut: {
      test: (r) => r.market_low != null && (r.your_price ?? 0) > r.market_low,
      hint: "someone sells cheaper",
    },
    best: {
      test: (r) => r.market_low != null && (r.your_price ?? 0) <= r.market_low,
      hint: "at/below market low",
    },
    vaulted: { test: (r) => r.is_vaulted, hint: "no longer farmable" },
  },
  fields: {
    type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
    trend: trendField((r) => r.trend),
    plat: { kind: "number", get: (r) => r.your_price, hint: "your price (plat)" },
    qty: { kind: "number", get: (r) => r.qty, hint: "listed quantity" },
    low: { kind: "number", get: (r) => r.market_low, hint: "market low (plat)" },
    value: {
      kind: "number",
      get: (r) => (r.your_price ?? 0) * r.qty,
      hint: "listing value (plat)",
    },
  },
};

// The Listings "Recommended" tab. Mirrors the listings/inventory grammar so the
// topbar query (and the tab's own filters) can narrow what to sell.
export const recommendationsSchema: SearchSchema<RecommendationRow> = (() => {
  const cat = catField<RecommendationRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      hot: { test: (r) => r.trend === "up", hint: "trending up" },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      trend: trendField((r) => r.trend),
      volume: { kind: "number", get: (r) => r.avg_daily_volume, hint: "avg daily volume" },
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      suggested: { kind: "number", get: (r) => r.suggested_price, hint: "suggested sell price" },
      qty: { kind: "number", get: (r) => r.owned_qty, hint: "owned quantity" },
      value: { kind: "number", get: (r) => r.est_value, hint: "estimated value (plat)" },
    },
  };
})();

export const trendsSchema: SearchSchema<TrendRow> = (() => {
  const cat = catField<TrendRow>((r) => r.category);
  return {
    text: (r) => `${r.display_name} ${r.part_type} ${r.category}`,
    is: {
      owned: { test: (r) => r.owned_qty > 0, hint: "in your inventory" },
      watched: { test: (r) => r.on_watchlist, hint: "on your watchlist" },
    },
    fields: {
      cat,
      category: cat,
      type: { kind: "text", get: (r) => r.part_type, hint: "part type" },
      plat: { kind: "number", get: (r) => r.median_plat, hint: "unit price (plat)" },
      delta: { kind: "number", get: (r) => r.delta, hint: "% move (timeframe)" },
      z: { kind: "number", get: (r) => r.z, hint: "volatility-normalized move" },
      volume: { kind: "number", get: (r) => r.volume, hint: "avg daily volume" },
      qty: { kind: "number", get: (r) => r.owned_qty, hint: "owned quantity" },
    },
  };
})();

/** Screens whose rows the topbar query filters. Screens absent here fall back
 *  to the global catalog search: home, rotation, settings — and market, which
 *  keeps its own screener search box (it uses marketSchema directly). */
const GEAR_CATEGORIES = [
  "warframe",
  "primary",
  "secondary",
  "melee",
  "companion",
  "archwing",
  "necramech",
  "amp",
  "special",
  "railjack",
] as const;
const RESOURCE_KINDS = ["resource", "consumable", "booster", "fusion_treasure"] as const;

// Arsenal tab (owned gear). The Account screen registers this as its page schema;
// the Resources tab compiles `resourcesSchema` against the same topbar text.
export const arsenalSchema: SearchSchema<GearRow> = {
  text: (r) => `${r.display_name} ${r.category}`,
  is: {
    mastered: { test: (r) => r.mastered, hint: "fully ranked" },
    tradeable: { test: (r) => r.slug != null, hint: "opens in the market drawer" },
  },
  fields: {
    cat: { kind: "enum", get: (r) => r.category, values: GEAR_CATEGORIES, hint: "gear category" },
    rank: { kind: "number", get: (r) => r.rank, hint: "current rank" },
    mr: { kind: "number", get: (r) => r.mastery_req ?? 0, hint: "MR requirement" },
  },
};

export const resourcesSchema: SearchSchema<ResourceRow> = {
  text: (r) => `${r.display_name} ${r.kind}`,
  is: {},
  fields: {
    kind: { kind: "enum", get: (r) => r.kind, values: RESOURCE_KINDS, hint: "resource kind" },
    count: { kind: "number", get: (r) => r.count, hint: "owned count" },
  },
};

// Riven Search results. The form (weapon + stat pickers) drives the API query;
// the topbar narrows the returned auctions (by price, grade, rerolls, polarity…).
const RIVEN_POLARITIES = ["madurai", "vazarin", "naramon"] as const;
const rivenPrice = (r: RivenResult): number | null => r.buyout_price ?? r.starting_price;
export const rivensSchema: SearchSchema<RivenResult> = {
  text: (r) =>
    `${r.weapon_name} ${r.riven_name} ${r.owner_name} ${r.polarity} ${r.attributes.map((a) => a.name).join(" ")}`,
  is: {
    exact: { test: (r) => r.match_tier === 0, hint: "matches all your stats exactly" },
    direct: { test: (r) => r.is_direct_sell, hint: "buyout (not an auction)" },
    online: { test: (r) => r.owner_status !== "offline", hint: "seller online/ingame" },
    graded: { test: (r) => r.grade != null, hint: "has a roll grade" },
  },
  fields: {
    polarity: {
      kind: "enum",
      get: (r) => r.polarity,
      values: RIVEN_POLARITIES,
      hint: "mod polarity",
    },
    plat: { kind: "number", get: rivenPrice, hint: "price (plat)" },
    grade: { kind: "number", get: (r) => r.grade, hint: "roll grade %" },
    rerolls: { kind: "number", get: (r) => r.re_rolls, hint: "reroll count" },
    mr: { kind: "number", get: (r) => r.mastery_level, hint: "mastery requirement" },
    rep: { kind: "number", get: (r) => r.owner_reputation, hint: "seller reputation" },
    matched: { kind: "number", get: (r) => r.matched_positives, hint: "desired positives present" },
  },
};

// Vendor board rows. Applied per-column (each vendor panel filters its own rows
// against the shared topbar query).
export const vendorsSchema: SearchSchema<VendorIntelRow> = {
  text: (r) => r.item,
  is: {
    deal: { test: (r) => r.good_deal, hint: "worth grabbing (unowned + valuable)" },
    owned: { test: (r) => r.owned_qty > 0, hint: "already in your inventory" },
    checked: { test: (r) => r.checked, hint: "grabbed (owned or ticked)" },
    tradeable: { test: (r) => r.tradeable, hint: "sells on warframe.market" },
  },
  fields: {
    plat: { kind: "number", get: (r) => r.median_plat, hint: "market value (plat)" },
    cost: { kind: "number", get: (r) => r.cost, hint: "vendor price" },
  },
};

export const PAGE_SCHEMAS: Partial<Record<ScreenId, AnySearchSchema>> = {
  inventory: inventorySchema,
  watchlist: watchlistSchema,
  buy: buySchema,
  sets: setsSchema,
  ducats: ducatsSchema,
  arcanes: arcanesSchema,
  relics: relicsSchema,
  sold: soldSchema,
  listings: listingsSchema,
  trends: trendsSchema,
  rivens: rivensSchema,
  vendors: vendorsSchema,
  // Default tab is Overview (sales-backed); the Resources/Armory tabs compile their
  // own schema against the same topbar text.
  account: soldSchema,
};

export const PAGE_PLACEHOLDER: Partial<Record<ScreenId, string>> = {
  inventory: "Search inventory…  try is:scanned source:manual held<7 · all: for everything",
  watchlist: "Search watchlist…  try is:attarget target<30",
  buy: "Search buy list…  try plat>10 trend:down",
  sets: "Search sets…  try is:complete missing=1",
  ducats: "Search parts…  try verdict:ducat dp>=10",
  arcanes: "Search arcanes…  try rarity:legendary verdict:sell",
  relics: "Search relics…  try tier:axi ev>30 is:scanned",
  sold: "Search sales…  try days<7 unit>20",
  listings: "Search listings…  try is:undercut",
  rivens: "Filter results…  try is:exact plat<100 grade>80 polarity:madurai rerolls<5",
  trends: "Search trends…  try delta>10 is:owned",
  vendors: "Search vendors…  try is:deal plat>50 · is:checked",
  account: "Search account…  Overview: unit>20 days<7 · Armory: cat:warframe rank<30",
};

export const GLOBAL_PLACEHOLDER = "Search all items…  (ininv: to scope to inventory)";
