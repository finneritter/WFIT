// wfinv — warframe.market CORS proxy + cache writer.
// Supabase Edge Function (Deno). Deploy with:
//   supabase functions deploy market-proxy --no-verify-jwt
//
// API split (verified 2026-05-30):
//   - Catalog lives at the new v2 endpoint:  GET /v2/items
//     (richer schema: slug, tags, ducats, i18n.en.{name,thumb}, gameRef)
//   - Per-item statistics still on v1:       GET /v1/items/<slug>/statistics
//     (v2 statistics endpoint isn't ported yet — returns 404).
//
// All write operations use the service-role key (privileged) so they bypass RLS.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PRICE_TTL_HOURS = 6;
const MIN_GAP_MS = 350; // ~3 req/s ceiling
const MARKET_V1 = "https://api.warframe.market/v1";
const MARKET_V2 = "https://api.warframe.market/v2";
const STATIC_BASE = "https://warframe.market/static/assets/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let lastCall = 0;
async function throttle() {
  const now = Date.now();
  const gap = lastCall + MIN_GAP_MS - now;
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCall = Date.now();
}

function partTypeOf(slug: string, tags: string[]): string {
  if (tags.includes("set")) return "Set";
  if (tags.includes("blueprint")) return "Blueprint";
  const m: [string, string][] = [
    ["_systems", "Systems"],
    ["_chassis", "Chassis"],
    ["_neuroptics", "Neuroptics"],
    ["_blade", "Blade"],
    ["_handle", "Handle"],
    ["_grip", "Handle"],
    ["_barrel", "Barrel"],
    ["_receiver", "Receiver"],
    ["_stock", "Stock"],
    ["_string", "String"],
    ["_link", "Link"],
    ["_pouch", "Pouch"],
    ["_disc", "Disc"],
    ["_lower_limb", "Lower limb"],
    ["_upper_limb", "Upper limb"],
    ["_head", "Head"],
    ["_blades", "Blades"],
    ["_carapace", "Carapace"],
    ["_cerebrum", "Cerebrum"],
    ["_ornament", "Ornament"],
    ["_wings", "Wings"],
  ];
  for (const [suf, type] of m) if (slug.endsWith(suf)) return type;
  if (tags.includes("component")) return "Component";
  return "Other";
}

/** Broad UI category from warframe.market item tags. */
function categoryOf(tags: string[]): string {
  if (tags.includes("warframe")) return "Warframe";
  if (tags.includes("weapon")) return "Weapon";
  return "Other"; // sentinel, archwing, mod, skin, etc.
}

function deriveSetSlug(slug: string): string | null {
  const idx = slug.indexOf("_prime");
  if (idx < 0) return null;
  if (slug.endsWith("_set")) return null;
  return `${slug.slice(0, idx + "_prime".length)}_set`;
}

async function fetchCatalog(): Promise<any[]> {
  await throttle();
  const r = await fetch(`${MARKET_V2}/items`, {
    headers: {
      "User-Agent": "wfinv-edge/0.0.1",
      Language: "en",
      Platform: "pc",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`warframe.market /v2/items: ${r.status}`);
  const json = await r.json();
  const items: any[] = json?.data ?? [];
  const out: any[] = [];
  for (const it of items) {
    const slug = it?.slug as string | undefined;
    const tags: string[] = Array.isArray(it?.tags) ? it.tags : [];
    if (!slug || !tags.includes("prime")) continue; // v1 scope: prime items only
    const en = it?.i18n?.en ?? {};
    const display_name: string = en.name ?? slug;
    const thumb_path: string | null = en.thumb ?? null;
    out.push({
      slug,
      display_name,
      part_type: partTypeOf(slug, tags),
      category: categoryOf(tags),
      set_slug: tags.includes("set") ? null : deriveSetSlug(slug),
      ducats: typeof it?.ducats === "number" ? it.ducats : null,
      is_vaulted: false, // not exposed by /v2/items; could enrich later
      is_tradeable: true,
      thumbnail_url: thumb_path ? `${STATIC_BASE}${thumb_path}` : null,
    });
  }
  return out;
}

/** Fetch 90d statistics for a single slug; derive median + trend. v1 endpoint. */
async function fetchPrice(
  slug: string,
): Promise<{ slug: string; median_plat: number; trend: string } | null> {
  await throttle();
  const r = await fetch(`${MARKET_V1}/items/${slug}/statistics`, {
    headers: { "User-Agent": "wfinv-edge/0.0.1", Language: "en", Platform: "pc" },
  });
  if (!r.ok) return null;
  const json = await r.json();
  const ninety: any[] = json?.payload?.statistics_closed?.["90days"] ?? [];
  const medians = ninety.map((d) => d.median).filter((m): m is number => typeof m === "number");
  if (medians.length === 0) return null;
  const recent = medians.slice(-7);
  const older = medians.slice(-14, -7);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
  const trend =
    recentAvg > olderAvg * 1.05 ? "up" : recentAvg < olderAvg * 0.95 ? "down" : "flat";
  const sorted = [...medians].sort((a, b) => a - b);
  const median = Math.round(sorted[Math.floor(sorted.length / 2)]);
  return { slug, median_plat: median, trend };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const action = body?.action;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (action === "catalog_refresh") {
      const items = await fetchCatalog();
      // Chunked upsert so a bad row doesn't kill the whole batch + the
      // error message points at the offending chunk.
      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < items.length; i += CHUNK) {
        const slice = items.slice(i, i + CHUNK);
        const { error } = await db.from("catalog_items").upsert(slice, { onConflict: "slug" });
        if (error) {
          return new Response(
            JSON.stringify({
              error: `catalog upsert failed at chunk ${i}: ${error.message}`,
              code: (error as any).code,
              details: (error as any).details,
              hint: (error as any).hint,
            }),
            { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
          );
        }
        inserted += slice.length;
      }
      return new Response(JSON.stringify({ ok: true, count: inserted }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (action === "prices_refresh") {
      let slugs: string[] = Array.isArray(body.slugs) ? body.slugs : [];
      if (slugs.length === 0) {
        // Pick catalog items whose price is missing or stale. Embedded-resource
        // filters can't go in a top-level .or(), so diff two plain selects.
        const nowIso = new Date().toISOString();
        const { data: cat, error: catErr } = await db.from("catalog_items").select("slug");
        if (catErr) throw catErr;
        const { data: fresh, error: freshErr } = await db
          .from("price_cache")
          .select("slug")
          .gt("expires_at", nowIso);
        if (freshErr) throw freshErr;
        const freshSet = new Set((fresh ?? []).map((r: any) => r.slug));
        slugs = (cat ?? [])
          .map((r: any) => r.slug)
          .filter((s: string) => !freshSet.has(s))
          .slice(0, 50); // budget cap
      }

      const updates: { slug: string; median_plat: number; trend: string; fetched_at: string; expires_at: string }[] = [];
      const now = new Date();
      const expiresAt = new Date(now.getTime() + PRICE_TTL_HOURS * 3600_000);
      for (const slug of slugs) {
        const p = await fetchPrice(slug);
        if (p) {
          updates.push({
            ...p,
            fetched_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
          });
        }
      }
      if (updates.length > 0) {
        const { error } = await db.from("price_cache").upsert(updates, { onConflict: "slug" });
        if (error) {
          throw new Error(
            `price_cache upsert failed: ${error.message}` +
              ((error as any).details ? ` — ${(error as any).details}` : ""),
          );
        }
      }
      return new Response(JSON.stringify({ ok: true, count: updates.length }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `unknown action: ${action}` }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Surface real detail: PostgrestError-style objects stringify to
    // "[object Object]" via String(), which hides the actual cause.
    let message: string;
    if (e instanceof Error) message = e.message;
    else if (e && typeof e === "object") {
      const o = e as any;
      message = o.message ?? o.error ?? JSON.stringify(o);
    } else message = String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
