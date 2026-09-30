-- Promotion social-distribution authorizer details are personal data about
-- the person who authorised social sharing. They lived on public.promotions,
-- which anon/authenticated read through the public "live promotions" policy
-- and a full table SELECT grant, so every live promotion exposed them.
--
-- Column-level privileges cannot fix this on promotions: PostgREST computed
-- fields (active_boost_until(promotions), active_featured_until(promotions))
-- pass the whole row, and a whole-row reference needs SELECT on every column,
-- so any column revoke breaks the public "order by active_*" queries.
-- Instead the three columns move to an owner-only side table and are dropped
-- from promotions. No application code reads or writes them (production had
-- no non-default values when this was written); insert_promotion_with_limit
-- only defaults social_authorizer_relationship when that column exists.
BEGIN;

CREATE TABLE IF NOT EXISTS public.promotion_social_authorizers (
  promotion_id uuid PRIMARY KEY REFERENCES public.promotions(id) ON DELETE CASCADE,
  authorizer_name text,
  authorizer_role text,
  relationship text NOT NULL DEFAULT 'owner'
    CONSTRAINT promotion_social_authorizers_relationship_check
    CHECK (relationship IN ('owner', 'business_representative', 'agency_or_marketing_partner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.promotion_social_authorizers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_social_authorizers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.promotion_social_authorizers TO authenticated;
GRANT ALL ON public.promotion_social_authorizers TO service_role;

-- Writes stay server-side (service role). Owners may read their own rows.
DROP POLICY IF EXISTS "Owners read own promotion social authorizer" ON public.promotion_social_authorizers;
CREATE POLICY "Owners read own promotion social authorizer" ON public.promotion_social_authorizers
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.promotions p
    WHERE p.id = promotion_id AND p.owner_id = (SELECT auth.uid())
  ));

-- Copy any non-default values across before dropping the public columns.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'promotions'
        AND column_name IN ('social_authorizer_name', 'social_authorizer_role',
                            'social_authorizer_relationship')) = 3 THEN
    EXECUTE $copy$
      INSERT INTO public.promotion_social_authorizers
        (promotion_id, authorizer_name, authorizer_role, relationship)
      SELECT id, social_authorizer_name, social_authorizer_role,
             COALESCE(social_authorizer_relationship, 'owner')
      FROM public.promotions
      WHERE social_authorizer_name IS NOT NULL
         OR social_authorizer_role IS NOT NULL
         OR social_authorizer_relationship IS DISTINCT FROM 'owner'
      ON CONFLICT (promotion_id) DO NOTHING
    $copy$;
  END IF;
END $$;

ALTER TABLE public.promotions
  DROP COLUMN IF EXISTS social_authorizer_name,
  DROP COLUMN IF EXISTS social_authorizer_role,
  DROP COLUMN IF EXISTS social_authorizer_relationship;

COMMIT;
NOTIFY pgrst, 'reload schema';
