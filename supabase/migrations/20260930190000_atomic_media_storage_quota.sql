-- Upload preflight is advisory: simultaneous requests can read the same usage.
-- Account for every tracking write atomically, including pending direct uploads.
-- Existing over-quota accounts keep their files and may reduce usage.
BEGIN;
LOCK TABLE public.media_uploads IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.media_storage_usage (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0)
);
ALTER TABLE public.media_storage_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_storage_usage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.media_storage_usage TO service_role;

INSERT INTO public.media_storage_usage (user_id, used_bytes)
SELECT user_id, sum(greatest(coalesce(file_size, 0), 0))::bigint
FROM public.media_uploads GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE SET used_bytes = EXCLUDED.used_bytes;

CREATE OR REPLACE FUNCTION public.enforce_media_storage_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  account_id uuid;
  delta bigint;
  quota_value jsonb;
  quota_number numeric;
  quota_mb bigint := 500;
  total bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    account_id := OLD.user_id;
    delta := -greatest(coalesce(OLD.file_size, 0), 0)::bigint;
    -- The account cascade may already have removed its usage row.
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = account_id) THEN
      RETURN OLD;
    END IF;
  ELSE
    account_id := NEW.user_id;
    IF NEW.file_size < 0 THEN
      RAISE EXCEPTION 'Invalid media size' USING ERRCODE = '22023';
    END IF;
    delta := coalesce(NEW.file_size, 0)::bigint;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'Media ownership is immutable' USING ERRCODE = '22023';
      END IF;
      delta := delta - greatest(coalesce(OLD.file_size, 0), 0)::bigint;
    END IF;
  END IF;

  IF delta > 0 THEN
    SELECT value -> 'storageQuotaMb' INTO quota_value
    FROM public.commercial_settings WHERE key = 'media';
    IF FOUND THEN
      IF quota_value IS NULL OR jsonb_typeof(quota_value) <> 'number' THEN
        RAISE EXCEPTION 'Media quota configuration unavailable' USING ERRCODE = 'PT503';
      END IF;
      -- JSON numeric values such as 50.0 or 5e1 are valid integer settings.
      -- Validate before the bigint cast so fractions cannot be rounded.
      quota_number := quota_value::text::numeric;
      IF quota_number NOT BETWEEN 50 AND 100000 OR quota_number <> trunc(quota_number) THEN
        RAISE EXCEPTION 'Media quota configuration unavailable' USING ERRCODE = 'PT503';
      END IF;
      quota_mb := quota_number::bigint;
    END IF;
  END IF;

  INSERT INTO public.media_storage_usage (user_id, used_bytes) VALUES (account_id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  -- UPDATE serializes on this account's row and rechecks the latest value.
  -- Higher isolation levels serialize/abort conflicting updates rather than
  -- allowing a stale SUM snapshot after an advisory-lock wait.
  UPDATE public.media_storage_usage SET used_bytes = used_bytes + delta
  WHERE user_id = account_id AND used_bytes + delta >= 0
    AND (delta <= 0 OR used_bytes + delta <= quota_mb * 1048576)
  RETURNING used_bytes INTO total;
  IF NOT FOUND THEN
    IF delta > 0 THEN
      RAISE EXCEPTION 'Media storage allowance exceeded' USING ERRCODE = 'PT413';
    END IF;
    RAISE EXCEPTION 'Media storage accounting mismatch' USING ERRCODE = '23000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_media_storage_quota() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS media_storage_quota ON public.media_uploads;
CREATE TRIGGER media_storage_quota
AFTER INSERT OR DELETE OR UPDATE OF file_size, user_id ON public.media_uploads
FOR EACH ROW EXECUTE FUNCTION public.enforce_media_storage_quota();

CREATE OR REPLACE FUNCTION public.media_storage_used(p_user uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT used_bytes FROM public.media_storage_usage WHERE user_id = p_user), 0);
$$;
REVOKE ALL ON FUNCTION public.media_storage_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_storage_used(uuid) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
