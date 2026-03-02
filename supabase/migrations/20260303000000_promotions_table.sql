-- ============================================================
-- Standalone promotions / advertisements table
-- Any verified user can create ads for products, services,
-- events, deals — without needing a listing, storefront, or
-- business profile.
-- ============================================================

-- Promotion type enum
CREATE TYPE promotion_type AS ENUM (
  'product',
  'service',
  'event',
  'deal',
  'general'
);

CREATE TABLE IF NOT EXISTS promotions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Content
  title             TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 120),
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 5000),
  promotion_type    promotion_type NOT NULL DEFAULT 'general',
  category          TEXT,
  photos            TEXT[] NOT NULL DEFAULT '{}',
  videos            TEXT[] NOT NULL DEFAULT '{}',
  video_thumbnail   TEXT,

  -- Pricing
  price_cents       INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  price_negotiable  BOOLEAN NOT NULL DEFAULT false,

  -- Location
  location_province TEXT NOT NULL,
  location_city     TEXT NOT NULL,

  -- Contact
  contact_methods   TEXT[] NOT NULL DEFAULT '{call}',

  -- Scheduling
  start_date        TIMESTAMPTZ,
  end_date          TIMESTAMPTZ,

  -- Status (same pattern as listings)
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN (
                      'draft',
                      'pending_moderation',
                      'flagged_for_review',
                      'live',
                      'hidden',
                      'expired',
                      'rejected'
                    )),
  status_reason     TEXT,

  -- Boost / featured (same pattern as listings)
  boost_until       TIMESTAMPTZ,
  featured_until    TIMESTAMPTZ,

  -- Analytics
  view_count        INTEGER NOT NULL DEFAULT 0,
  click_count       INTEGER NOT NULL DEFAULT 0,

  -- Entitlement tracking (nullable — free posts have no entitlement)
  entitlement_id    UUID REFERENCES entitlements(id) ON DELETE SET NULL,

  -- Timestamps
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX idx_promotions_seller     ON promotions (seller_id);
CREATE INDEX idx_promotions_status     ON promotions (status, created_at DESC);
CREATE INDEX idx_promotions_type       ON promotions (promotion_type);
CREATE INDEX idx_promotions_location   ON promotions (location_province, location_city);
CREATE INDEX idx_promotions_boost      ON promotions (boost_until)
  WHERE boost_until IS NOT NULL;
CREATE INDEX idx_promotions_featured   ON promotions (featured_until)
  WHERE featured_until IS NOT NULL;

-- ── Row Level Security ─────────────────────────────────────
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

-- Public can read live promotions
CREATE POLICY "Public can view live promotions"
  ON promotions FOR SELECT
  USING (status = 'live');

-- Owners can see all their own promotions (any status)
CREATE POLICY "Owners can view own promotions"
  ON promotions FOR SELECT
  USING (auth.uid() = seller_id);

-- Owners can insert their own promotions
CREATE POLICY "Owners can create promotions"
  ON promotions FOR INSERT
  WITH CHECK (auth.uid() = seller_id);

-- Owners can update their own promotions
CREATE POLICY "Owners can update own promotions"
  ON promotions FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

-- Owners can delete their own draft/rejected promotions
CREATE POLICY "Owners can delete own draft promotions"
  ON promotions FOR DELETE
  USING (auth.uid() = seller_id AND status IN ('draft', 'rejected'));

-- ── updated_at trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_promotions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_promotions_updated_at
  BEFORE UPDATE ON promotions
  FOR EACH ROW
  EXECUTE FUNCTION update_promotions_updated_at();
