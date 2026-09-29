-- Staff role authority.
--
-- Until now a person's staff role lived only in auth.users.raw_app_meta_data
-- and was copied into their JWT. Row-level security read the role from the
-- JWT, so a demoted or banned staff member kept database access until their
-- token expired, and a dozen SQL functions read the metadata directly.
--
-- This migration makes public.staff_roles the only authority:
--   1. staff_roles table, backfilled from auth metadata.
--   2. staff_role_of(user) — the single lookup. It also denies staff whose
--      account is banned or suspended.
--   3. has_role / has_any_role keep their signatures (used by RLS policies)
--      but read staff_roles, so every existing policy follows the table.
--   4. Functions that read raw_app_meta_data->>'role' are rewritten to call
--      staff_role_of. The migration fails if any are left.
--   5. Policies: role checks are wrapped in (SELECT ...) so Postgres evaluates
--      them once per statement; direct JWT role reads are replaced; staff
--      write access through PostgREST is removed (moderators and governors
--      write only through audited server routes) and three legacy staff
--      write policies are dropped. The migration fails if any policy still
--      reads the role from the JWT.
--   6. The last active admin cannot be removed, even by concurrent requests.

BEGIN;

-- ── 1. staff_roles ──────────────────────────────────────────────────────
CREATE TABLE public.staff_roles (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role               text NOT NULL CHECK (role IN ('moderator', 'governance_controller', 'admin')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by         uuid,
  granted_at         timestamptz NOT NULL DEFAULT now(),
  revoked_by         uuid,
  revoked_at         timestamptz,
  revoked_reason     text,
  -- Staff must have a verified second factor after this time (enrolment grace).
  mfa_required_after timestamptz NOT NULL DEFAULT now() + interval '7 days',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_roles_revocation_consistent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE INDEX staff_roles_active_role_idx ON public.staff_roles (role) WHERE status = 'active';

INSERT INTO public.staff_roles (user_id, role, granted_at)
SELECT u.id, lower(btrim(u.raw_app_meta_data->>'role')), now()
  FROM auth.users u
 WHERE lower(btrim(u.raw_app_meta_data->>'role')) IN ('moderator', 'governance_controller', 'admin')
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_roles TO authenticated;
GRANT ALL ON public.staff_roles TO service_role;

CREATE POLICY "Staff read own role" ON public.staff_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_staff_roles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_roles_touch_updated_at
  BEFORE UPDATE ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_staff_roles_updated_at();

-- ── 2. staff_role_of ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_role_of(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT sr.role
    FROM public.staff_roles sr
   WHERE sr.user_id = p_user
     AND sr.status = 'active'
     AND NOT EXISTS (
       SELECT 1
         FROM public.account_profiles ap
        WHERE ap.user_id = sr.user_id
          AND ap.account_status IN ('banned', 'suspended')
     );
$$;

REVOKE EXECUTE ON FUNCTION public.staff_role_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_role_of(uuid) TO service_role;

-- Everything a server route needs to authorise a staff request, in one call.
CREATE OR REPLACE FUNCTION public.staff_access_of(p_user uuid)
RETURNS TABLE (role text, mfa_required_after timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT sr.role, sr.mfa_required_after
    FROM public.staff_roles sr
   WHERE sr.user_id = p_user
     AND public.staff_role_of(p_user) IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.staff_access_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_access_of(uuid) TO service_role;

-- ── 3. RLS role helpers ─────────────────────────────────────────────────
-- SECURITY DEFINER so anon/authenticated callers (inside RLS) can consult
-- staff_roles without being granted access to it. They only ever answer for
-- the caller (auth.uid()); staff_role_of(any user) stays service-role only.
CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.staff_role_of(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.staff_role_of(auth.uid()) = required_role, false);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.staff_role_of(auth.uid()) = ANY(roles), false);
$$;

REVOKE EXECUTE ON FUNCTION public.current_staff_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_any_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(text[]) TO anon, authenticated, service_role;

-- ── 4. Functions that read the role from auth metadata ──────────────────
-- commercial_audit only labels the actor in audit rows (members included),
-- it does not authorise anything, so it keeps reading metadata.
DO $$
DECLARE
  fn record;
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, p.prosecdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc LIKE '%raw_app_meta_data->>''role''%'
       AND p.proname <> 'commercial_audit'
  LOOP
    IF NOT fn.prosecdef THEN
      RAISE EXCEPTION 'public.% reads the role from auth metadata but is not SECURITY DEFINER; rewrite it by hand', fn.proname;
    END IF;
    def := pg_get_functiondef(fn.oid);
    def := replace(def, 'u.raw_app_meta_data->>''role''', 'public.staff_role_of(u.id)');
    def := replace(def, 'raw_app_meta_data->>''role''', 'public.staff_role_of(auth.users.id)');
    EXECUTE def;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc LIKE '%raw_app_meta_data->>''role''%'
       AND p.proname <> 'commercial_audit'
  ) THEN
    RAISE EXCEPTION 'A public function still authorises from raw_app_meta_data';
  END IF;
END $$;

-- ── 5. Policies ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff updates reports" ON public.reports;
DROP POLICY IF EXISTS "Reviewer updates steps" ON public.verification_steps;
DROP POLICY IF EXISTS "Staff creates moderation action" ON public.moderation_actions;

DO $$
DECLARE
  pol record;
  new_qual text;
  new_check text;
  jwt_role constant text := '\(\(auth\.jwt\(\) -> ''app_metadata''::text\) ->> ''role''::text\)';
  -- A has_role/has_any_role call not already wrapped in a scalar sub-select.
  unwrapped constant text := '(?<!SELECT )((?:public\.)?has_(?:any_)?role\([^()]*\))';
  staff_writer constant text := '(?:public\.)?has_any_role\(ARRAY\[[^]]*''(?:moderator|governance_controller)''::text[^]]*\]\)';
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') ~ '(has_(any_)?role\(|app_metadata)'
            OR coalesce(with_check, '') ~ '(has_(any_)?role\(|app_metadata)')
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;

    -- Direct JWT role reads become a staff_roles lookup.
    new_qual := regexp_replace(new_qual, jwt_role, 'public.current_staff_role()', 'g');
    new_check := regexp_replace(new_check, jwt_role, 'public.current_staff_role()', 'g');

    -- Moderators and governors do not write through PostgREST; admins keep it.
    IF pol.cmd <> 'SELECT' THEN
      new_qual := regexp_replace(new_qual, staff_writer, 'has_role(''admin''::text)', 'g');
      new_check := regexp_replace(new_check, staff_writer, 'has_role(''admin''::text)', 'g');
    END IF;

    -- Evaluate role checks once per statement.
    new_qual := regexp_replace(new_qual, unwrapped, '(SELECT \1)', 'g');
    new_check := regexp_replace(new_check, unwrapped, '(SELECT \1)', 'g');

    IF new_qual IS DISTINCT FROM pol.qual OR new_check IS DISTINCT FROM pol.with_check THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I%s%s',
        pol.policyname, pol.schemaname, pol.tablename,
        CASE WHEN new_qual IS NOT NULL THEN format(' USING (%s)', new_qual) ELSE '' END,
        CASE WHEN new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') LIKE '%app_metadata%' OR coalesce(with_check, '') LIKE '%app_metadata%')
  ) THEN
    RAISE EXCEPTION 'A policy still reads the role from the JWT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd <> 'SELECT'
       AND (coalesce(qual, '') ~ '''(moderator|governance_controller)''::text'
            OR coalesce(with_check, '') ~ '''(moderator|governance_controller)''::text')
  ) THEN
    RAISE EXCEPTION 'A write policy still grants moderators or governors direct access';
  END IF;
END $$;

-- ── 6. Last-admin protection ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.status <> 'active') THEN
    -- Serialise admin removals so two concurrent demotions cannot both pass.
    PERFORM pg_advisory_xact_lock(hashtext('public.staff_roles:admins'));
    IF NOT EXISTS (
      SELECT 1 FROM public.staff_roles
       WHERE role = 'admin' AND status = 'active' AND user_id <> OLD.user_id
    ) THEN
      RAISE EXCEPTION 'The last active admin cannot be removed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER staff_roles_protect_last_admin
  BEFORE UPDATE OR DELETE ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

REVOKE EXECUTE ON FUNCTION public.protect_last_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_staff_roles_updated_at() FROM PUBLIC, anon, authenticated;

COMMIT;
