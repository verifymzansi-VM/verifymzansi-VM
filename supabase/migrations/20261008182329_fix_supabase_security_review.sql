-- Close owner analytics writes and remove unused database privileges.
-- Existing public table/RPC grants are preserved; new objects need deliberate
-- grants. supabase_admin defaults belong to the hosted platform and cannot be
-- changed by the non-superuser postgres migration role.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_content_monetization_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  protected_column TEXT;
  old_json JSONB := to_jsonb(OLD);
  new_json JSONB := to_jsonb(NEW);
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    RETURN NEW;
  END IF;
  FOREACH protected_column IN ARRAY ARRAY[
    'boost_until', 'featured_until', 'urgent_until',
    'view_count', 'engaged_view_count', 'click_count', 'approved_edit_count'
  ]
  LOOP
    IF (old_json ? protected_column)
       AND (new_json ? protected_column)
       AND new_json->protected_column IS DISTINCT FROM old_json->protected_column THEN
      RAISE EXCEPTION '% can only be changed by billing or system workflows', protected_column
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_content_monetization_columns()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_content_monetization_columns() TO service_role;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM PUBLIC, anon, authenticated;

-- Schema grants add to global defaults. Revoke implicit global PUBLIC EXECUTE
-- as well as the explicit public-schema browser grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- mode takes precedence over enabled. This UPDATE retains the feature-flag
-- audit trigger; staff can still enrol through /staff/two-step.
UPDATE public.feature_flags
SET mode = 'on', enabled = true, rollout_percent = 100,
    updated_by = NULL,
    updated_reason = 'Security remediation: require staff MFA (8 October 2026)'
WHERE key = 'staff_mfa_enforced';

COMMIT;
