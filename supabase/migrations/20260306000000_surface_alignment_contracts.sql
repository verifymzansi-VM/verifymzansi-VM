-- ============================================================
-- Marketplace surface alignment contracts
-- - Add top-level listing condition column for Mzansi Market
-- - Add canonical promotion category_key for Promotions & Events
-- - Backfill legacy data into the new canonical columns
-- ============================================================

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS condition TEXT
  CHECK (
    condition IS NULL OR condition IN ('new', 'like_new', 'good', 'fair', 'for_parts')
  );

COMMENT ON COLUMN public.listings.condition IS
  'Canonical listing condition stored separately from attributes JSON.';

CREATE INDEX IF NOT EXISTS idx_listings_condition
  ON public.listings (condition)
  WHERE condition IS NOT NULL;

UPDATE public.listings
SET condition = CASE lower(coalesce(attributes ->> 'condition', ''))
  WHEN 'new' THEN 'new'
  WHEN 'like_new' THEN 'like_new'
  WHEN 'good' THEN 'good'
  WHEN 'fair' THEN 'fair'
  WHEN 'for_parts' THEN 'for_parts'
  ELSE NULL
END
WHERE condition IS NULL
  AND attributes ? 'condition';

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS category_key business_category;

COMMENT ON COLUMN public.promotions.category_key IS
  'Canonical business taxonomy key used for filtering promotions.';

CREATE INDEX IF NOT EXISTS idx_promotions_category_key
  ON public.promotions (category_key);

UPDATE public.promotions
SET category_key = CASE
  WHEN lower(coalesce(category, '')) ~ '(fashion|clothing|apparel|shoe|jewel|boutique|bag)' THEN 'fashion_accessories'::business_category
  WHEN lower(coalesce(category, '')) ~ '(electronic|tech|phone|laptop|computer|gaming|gadget)' THEN 'electronics_tech'::business_category
  WHEN lower(coalesce(category, '')) ~ '(grocery|supermarket|essential|convenience|produce)' THEN 'groceries_essentials'::business_category
  WHEN lower(coalesce(category, '')) ~ '(health|beauty|wellness|salon|spa|cosmetic|pharmacy)' THEN 'health_beauty'::business_category
  WHEN lower(coalesce(category, '')) ~ '(home|living|furniture|decor|appliance|interior)' THEN 'home_living'::business_category
  WHEN lower(coalesce(category, '')) ~ '(food|dining|restaurant|cafe|bakery|catering|takeaway)' THEN 'food_dining'::business_category
  WHEN lower(coalesce(category, '')) ~ '(trade|maintenance|repair|plumb|electric|clean|handyman)' THEN 'trade_maintenance'::business_category
  WHEN lower(coalesce(category, '')) ~ '(service|consult|legal|account|finance|marketing|\mit\M)' THEN 'professional_services'::business_category
  WHEN lower(coalesce(category, '')) ~ '(education|training|school|course|workshop|tutor)' THEN 'education_training'::business_category
  WHEN lower(coalesce(category, '')) ~ '(event|concert|festival|market|show|entertainment|party)' THEN 'events_entertainment'::business_category
  WHEN lower(coalesce(category, '')) ~ '(auto|car|vehicle|transport|logistics|taxi|shuttle)' THEN 'automotive_transport'::business_category
  WHEN promotion_type = 'event'::promotion_type THEN 'events_entertainment'::business_category
  ELSE 'general_other'::business_category
END
WHERE category_key IS NULL;
