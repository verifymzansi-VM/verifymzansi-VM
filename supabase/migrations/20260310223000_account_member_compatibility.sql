-- Compatibility-first terminology refactor:
-- - add neutral account/member aliases alongside legacy seller naming
-- - keep legacy columns and types working during the rollout

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'user_role'
      AND n.nspname = 'public'
  ) THEN
    BEGIN
      ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'member' BEFORE 'moderator';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'account_verification_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.account_verification_status AS ENUM (
      'incomplete',
      'pending_review',
      'verified',
      'rejected'
    );
  END IF;
END
$$;

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS account_verification_status public.account_verification_status;

UPDATE public.seller_profiles
SET account_verification_status = seller_verification_status::text::public.account_verification_status
WHERE account_verification_status IS NULL;

CREATE OR REPLACE FUNCTION public.sync_account_profile_verification_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.account_verification_status IS NOT NULL AND NEW.seller_verification_status IS NULL THEN
      NEW.seller_verification_status :=
        NEW.account_verification_status::text::public.seller_verification_status;
    ELSIF NEW.seller_verification_status IS NOT NULL THEN
      NEW.account_verification_status :=
        NEW.seller_verification_status::text::public.account_verification_status;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.account_verification_status IS DISTINCT FROM OLD.account_verification_status
     AND NEW.seller_verification_status IS NOT DISTINCT FROM OLD.seller_verification_status THEN
    NEW.seller_verification_status :=
      NEW.account_verification_status::text::public.seller_verification_status;
  ELSIF NEW.seller_verification_status IS DISTINCT FROM OLD.seller_verification_status
     AND NEW.account_verification_status IS NOT DISTINCT FROM OLD.account_verification_status THEN
    NEW.account_verification_status :=
      NEW.seller_verification_status::text::public.account_verification_status;
  ELSIF NEW.account_verification_status IS NULL AND NEW.seller_verification_status IS NOT NULL THEN
    NEW.account_verification_status :=
      NEW.seller_verification_status::text::public.account_verification_status;
  ELSIF NEW.seller_verification_status IS NULL AND NEW.account_verification_status IS NOT NULL THEN
    NEW.seller_verification_status :=
      NEW.account_verification_status::text::public.seller_verification_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_account_profile_verification_fields ON public.seller_profiles;

CREATE TRIGGER sync_account_profile_verification_fields
BEFORE INSERT OR UPDATE OF seller_verification_status, account_verification_status
ON public.seller_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_account_profile_verification_fields();

CREATE OR REPLACE VIEW public.account_profiles AS
SELECT
  sp.id,
  sp.user_id,
  sp.user_id AS owner_id,
  sp.display_name,
  sp.account_verification_status,
  sp.seller_verification_status,
  sp.phone,
  sp.masked_phone_public,
  sp.location_province,
  sp.location_city,
  sp.location_verified_at,
  sp.account_status,
  sp.strikes,
  sp.suspended_until,
  sp.banned_at,
  sp.ban_reason,
  sp.legal_hold,
  sp.profile_completeness_score,
  sp.created_at,
  sp.updated_at
FROM public.seller_profiles sp;

COMMENT ON VIEW public.account_profiles IS
  'Compatibility view exposing seller_profiles through neutral account/member terminology.';

CREATE OR REPLACE FUNCTION public.sync_owner_id_with_seller_id()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.owner_id IS NULL THEN
      NEW.owner_id := NEW.seller_id;
    ELSIF NEW.seller_id IS NULL THEN
      NEW.seller_id := NEW.owner_id;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND NEW.seller_id IS NOT DISTINCT FROM OLD.seller_id THEN
    NEW.seller_id := NEW.owner_id;
  ELSIF NEW.seller_id IS DISTINCT FROM OLD.seller_id
     AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    NEW.owner_id := NEW.seller_id;
  ELSIF NEW.owner_id IS NULL AND NEW.seller_id IS NOT NULL THEN
    NEW.owner_id := NEW.seller_id;
  ELSIF NEW.seller_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.seller_id := NEW.owner_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_target_owner_id_with_target_seller_id()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.target_owner_id IS NULL THEN
      NEW.target_owner_id := NEW.target_seller_id;
    ELSIF NEW.target_seller_id IS NULL THEN
      NEW.target_seller_id := NEW.target_owner_id;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.target_owner_id IS DISTINCT FROM OLD.target_owner_id
     AND NEW.target_seller_id IS NOT DISTINCT FROM OLD.target_seller_id THEN
    NEW.target_seller_id := NEW.target_owner_id;
  ELSIF NEW.target_seller_id IS DISTINCT FROM OLD.target_seller_id
     AND NEW.target_owner_id IS NOT DISTINCT FROM OLD.target_owner_id THEN
    NEW.target_owner_id := NEW.target_seller_id;
  ELSIF NEW.target_owner_id IS NULL AND NEW.target_seller_id IS NOT NULL THEN
    NEW.target_owner_id := NEW.target_seller_id;
  ELSIF NEW.target_seller_id IS NULL AND NEW.target_owner_id IS NOT NULL THEN
    NEW.target_seller_id := NEW.target_owner_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.listings SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_owner ON public.listings(owner_id);
DROP TRIGGER IF EXISTS sync_listings_owner_fields ON public.listings;
CREATE TRIGGER sync_listings_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.listings
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.storefronts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.storefronts SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_storefronts_owner ON public.storefronts(owner_id);
DROP TRIGGER IF EXISTS sync_storefronts_owner_fields ON public.storefronts;
CREATE TRIGGER sync_storefronts_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.storefronts
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.storefront_posts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.storefront_posts SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_storefront_posts_owner ON public.storefront_posts(owner_id);
DROP TRIGGER IF EXISTS sync_storefront_posts_owner_fields ON public.storefront_posts;
CREATE TRIGGER sync_storefront_posts_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.storefront_posts
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.business_profiles SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_profiles_owner ON public.business_profiles(owner_id);
DROP TRIGGER IF EXISTS sync_business_profiles_owner_fields ON public.business_profiles;
CREATE TRIGGER sync_business_profiles_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.business_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.business_posts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.business_posts SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_posts_owner ON public.business_posts(owner_id);
DROP TRIGGER IF EXISTS sync_business_posts_owner_fields ON public.business_posts;
CREATE TRIGGER sync_business_posts_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.business_posts
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.businesses SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON public.businesses(owner_id);
DROP TRIGGER IF EXISTS sync_businesses_owner_fields ON public.businesses;
CREATE TRIGGER sync_businesses_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.promotions SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_owner ON public.promotions(owner_id);
DROP TRIGGER IF EXISTS sync_promotions_owner_fields ON public.promotions;
CREATE TRIGGER sync_promotions_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.leads SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_owner ON public.leads(owner_id);
DROP TRIGGER IF EXISTS sync_leads_owner_fields ON public.leads;
CREATE TRIGGER sync_leads_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.contact_events
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.contact_events SET owner_id = seller_id WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_events_owner ON public.contact_events(owner_id);
DROP TRIGGER IF EXISTS sync_contact_events_owner_fields ON public.contact_events;
CREATE TRIGGER sync_contact_events_owner_fields
BEFORE INSERT OR UPDATE OF seller_id, owner_id
ON public.contact_events
FOR EACH ROW
EXECUTE FUNCTION public.sync_owner_id_with_seller_id();

ALTER TABLE public.moderation_actions
  ADD COLUMN IF NOT EXISTS target_owner_id UUID REFERENCES auth.users(id);
UPDATE public.moderation_actions
SET target_owner_id = target_seller_id
WHERE target_owner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target_owner ON public.moderation_actions(target_owner_id);
DROP TRIGGER IF EXISTS sync_moderation_actions_target_owner_fields ON public.moderation_actions;
CREATE TRIGGER sync_moderation_actions_target_owner_fields
BEFORE INSERT OR UPDATE OF target_seller_id, target_owner_id
ON public.moderation_actions
FOR EACH ROW
EXECUTE FUNCTION public.sync_target_owner_id_with_target_seller_id();
