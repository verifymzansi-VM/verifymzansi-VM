ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS social_distribution_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS social_distribution_authorized_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS social_distribution_revoked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS social_authorizer_name text NULL,
  ADD COLUMN IF NOT EXISTS social_authorizer_role text NULL,
  ADD COLUMN IF NOT EXISTS social_authorizer_relationship text NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS social_authorization_version text NULL,
  ADD COLUMN IF NOT EXISTS social_monetization_acknowledged boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'promotions_social_authorizer_relationship_check'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_social_authorizer_relationship_check
      CHECK (
        social_authorizer_relationship IN (
          'owner',
          'business_representative',
          'agency_or_marketing_partner'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_promotions_social_distribution_authorized
  ON public.promotions (social_distribution_authorized);

CREATE INDEX IF NOT EXISTS idx_promotions_social_distribution_revoked_at
  ON public.promotions (social_distribution_revoked_at)
  WHERE social_distribution_revoked_at IS NOT NULL;
