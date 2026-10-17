-- Evidence metadata and extracted text must pass the staff HTTP route's
-- expiry, self-review and audit gates; direct PostgREST SELECT bypasses them.
-- Revoking table SELECT does not remove previously granted column SELECT.
BEGIN;

REVOKE SELECT ON TABLE public.business_verification_files FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  selectable_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO selectable_columns
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.business_verification_files'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.business_verification_files FROM PUBLIC, anon, authenticated',
    selectable_columns
  );
END;
$$;

-- Existing service-role mutations and RLS policies stay in place.
GRANT SELECT ON TABLE public.business_verification_files TO service_role;

COMMIT;
