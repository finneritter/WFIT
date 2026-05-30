-- wfinv — initial schema
-- Run this in your Supabase project's SQL editor, or via `supabase db push` if using the CLI.

-- ============================================================
-- Extensions
-- ============================================================
-- pg_trgm: trigram-based fuzzy search for the command palette (gin_trgm_ops).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Catalog: shared across all users. Refreshed by edge function.
-- ============================================================
CREATE TABLE catalog_items (
    slug           TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    part_type      TEXT NOT NULL,
    set_slug       TEXT REFERENCES catalog_items(slug),
    ducats         INTEGER,
    is_vaulted     BOOLEAN NOT NULL DEFAULT FALSE,
    is_tradeable   BOOLEAN NOT NULL DEFAULT TRUE,
    thumbnail_url  TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_catalog_set_slug ON catalog_items(set_slug);
CREATE INDEX idx_catalog_display_name ON catalog_items USING gin (display_name gin_trgm_ops);

-- Public-read; only the service role (used by the edge function) can write.
ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog readable by authenticated users"
    ON catalog_items FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- Price cache: shared across all users.
-- ============================================================
CREATE TABLE price_cache (
    slug         TEXT PRIMARY KEY REFERENCES catalog_items(slug) ON DELETE CASCADE,
    median_plat  INTEGER NOT NULL,
    trend        TEXT NOT NULL CHECK (trend IN ('up','flat','down')),
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_price_cache_expires_at ON price_cache(expires_at);

ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prices readable by authenticated users"
    ON price_cache FOR SELECT
    TO authenticated
    USING (true);

-- ============================================================
-- Per-user inventory.
-- ============================================================
CREATE TABLE inventory_items (
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slug              TEXT NOT NULL REFERENCES catalog_items(slug),
    qty               INTEGER NOT NULL CHECK (qty >= 0),
    first_added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes             TEXT,
    PRIMARY KEY (user_id, slug)
);

CREATE INDEX idx_inventory_user_id ON inventory_items(user_id);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users access only their inventory"
    ON inventory_items FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Per-user sales history.
-- ============================================================
CREATE TABLE sale_events (
    id                          BIGSERIAL PRIMARY KEY,
    user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    slug                        TEXT NOT NULL REFERENCES catalog_items(slug),
    qty                         INTEGER NOT NULL CHECK (qty > 0),
    plat_per_unit               INTEGER,
    market_median_at_sale_time  INTEGER,
    sold_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes                       TEXT
);

CREATE INDEX idx_sale_events_user_sold_at ON sale_events(user_id, sold_at DESC);
CREATE INDEX idx_sale_events_user_slug ON sale_events(user_id, slug);

ALTER TABLE sale_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users access only their sales"
    ON sale_events FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Atomic sale: write event + decrement inventory in one transaction.
-- Called as supabase.rpc('record_sale', {...}).
-- ============================================================
CREATE OR REPLACE FUNCTION record_sale(
    p_slug          TEXT,
    p_qty           INTEGER,
    p_plat_per_unit INTEGER DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_user_id      UUID := auth.uid();
    v_cur_qty      INTEGER;
    v_median       INTEGER;
    v_new_qty      INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be > 0';
    END IF;

    SELECT qty INTO v_cur_qty
    FROM inventory_items
    WHERE user_id = v_user_id AND slug = p_slug;

    IF v_cur_qty IS NULL THEN
        RAISE EXCEPTION 'not in inventory: %', p_slug;
    END IF;
    IF v_cur_qty < p_qty THEN
        RAISE EXCEPTION 'cannot sell % (have %)', p_qty, v_cur_qty;
    END IF;

    SELECT median_plat INTO v_median
    FROM price_cache WHERE slug = p_slug;

    INSERT INTO sale_events (user_id, slug, qty, plat_per_unit, market_median_at_sale_time, notes)
    VALUES (v_user_id, p_slug, p_qty, COALESCE(p_plat_per_unit, v_median), v_median, p_notes);

    v_new_qty := v_cur_qty - p_qty;
    IF v_new_qty = 0 THEN
        DELETE FROM inventory_items
        WHERE user_id = v_user_id AND slug = p_slug;
    ELSE
        UPDATE inventory_items
        SET qty = v_new_qty, last_modified_at = NOW()
        WHERE user_id = v_user_id AND slug = p_slug;
    END IF;

    RETURN v_new_qty;
END;
$$;

-- ============================================================
-- Atomic add: insert-or-increment.
-- ============================================================
CREATE OR REPLACE FUNCTION add_to_inventory(p_slug TEXT, p_qty INTEGER DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_user_id  UUID := auth.uid();
    v_new_qty  INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be > 0';
    END IF;

    INSERT INTO inventory_items (user_id, slug, qty)
    VALUES (v_user_id, p_slug, p_qty)
    ON CONFLICT (user_id, slug) DO UPDATE
        SET qty = inventory_items.qty + EXCLUDED.qty,
            last_modified_at = NOW()
    RETURNING qty INTO v_new_qty;

    RETURN v_new_qty;
END;
$$;

-- ============================================================
-- Summary RPC: one round-trip for the four summary cards.
-- ============================================================
CREATE OR REPLACE FUNCTION inventory_summary()
RETURNS TABLE (
    total_plat        BIGINT,
    prime_part_count  BIGINT,
    full_set_count    BIGINT,
    total_ducats      BIGINT
)
LANGUAGE sql
SECURITY INVOKER
AS $$
    WITH owned AS (
        SELECT ii.slug, ii.qty, ci.part_type, ci.set_slug, ci.ducats, pc.median_plat
        FROM inventory_items ii
        JOIN catalog_items ci ON ci.slug = ii.slug
        LEFT JOIN price_cache pc ON pc.slug = ii.slug
        WHERE ii.user_id = auth.uid() AND ii.qty > 0
    ),
    set_parts AS (
        SELECT ci.set_slug AS sslug,
               COUNT(*) AS total_parts,
               SUM(CASE WHEN owned.qty >= 1 THEN 1 ELSE 0 END) AS owned_parts
        FROM catalog_items ci
        LEFT JOIN owned ON owned.slug = ci.slug
        WHERE ci.set_slug IS NOT NULL
        GROUP BY ci.set_slug
    )
    SELECT
        COALESCE(SUM(COALESCE(median_plat, 0) * qty), 0)::BIGINT AS total_plat,
        COALESCE(SUM(CASE WHEN part_type <> 'Set' THEN qty ELSE 0 END), 0)::BIGINT AS prime_part_count,
        (SELECT COUNT(*) FROM set_parts WHERE total_parts > 0 AND owned_parts = total_parts)::BIGINT AS full_set_count,
        COALESCE(SUM(COALESCE(ducats, 0) * qty), 0)::BIGINT AS total_ducats
    FROM owned;
$$;
