-- ============================================================
-- Write-path hardening: enforcement columns, content status
-- transitions, verification sessions, and SECURITY DEFINER RPCs
--
-- Closes a set of RLS gaps where broad owner UPDATE policies let
-- any authenticated user PATCH privileged columns through
-- PostgREST directly:
--
--   1. account_profiles: the "Owner or admin updates profile"
--      policy (20260324000000) covers every column, so a user could
--      self-unban / self-verify / clear strikes. A new guard trigger
--      restricts enforcement columns to service-role / admin actors.
--      (The existing enforce_identity_locks trigger only covers
--      name/location columns.)
--   2. listings/businesses/promotions: the status-transition trigger
--      (20260322000000) validated the matrix but not the actor, and
--      owner UPDATE policies (20260311120000) exposed monetization
--      and counter columns. Non-service-role actors may now only
--      submit drafts for moderation or hide live content, and may
--      never write add-on/counter columns.
--   3. verification_sessions: the "Owner updates own session" policy
--      (20260224000000) let users stamp phone_verified_at /
--      finalized_at on their own row. All legitimate writes go
--      through the service-role admin client (upload route, location
--      lifecycle, OTP verify, session start), so the owner UPDATE
--      policy is dropped; a guard trigger protects the signal
--      columns on INSERT as well (the owner INSERT policy stays so
--      session rows can still be created, but never with
--      verification signals pre-set).
--   4. claim_free_post_slot: 20260723000000 re-granted EXECUTE to
--      authenticated, undoing 20260430040000. The app only calls it
--      via the service-role admin client (src/lib/billing/free-posts.ts),
--      so EXECUTE is revoked again and an in-function caller guard is
--      added as defense in depth.
--   5. free_post_content_exists / free_post_area_has_any_content have
--      no app callers and let anyone probe whether an arbitrary user
--      has content in an area — EXECUTE revoked.
--   6. increment_strikes: new service-role-only RPC used by the admin
--      flagging route to atomically increment account strikes.
--
-- Guard convention: auth.role() IS NULL means a trusted non-PostgREST
-- context (migrations, console, pg_cron) and always passes, so future
-- migration backfills are not blocked; service_role and admins pass;
-- everyone else is restricted.
-- ============================================================

-- ── 1. account_profiles enforcement-column guard ────────────

CREATE OR REPLACE FUNCTION public.guard_account_enforcement_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trusted contexts: migrations/console (NULL role), the service-role
  -- admin client used by enforcement API routes, and admins.
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    RAISE EXCEPTION 'account_status can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.suspended_until IS DISTINCT FROM OLD.suspended_until THEN
    RAISE EXCEPTION 'suspended_until can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.banned_at IS DISTINCT FROM OLD.banned_at THEN
    RAISE EXCEPTION 'banned_at can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.ban_reason IS DISTINCT FROM OLD.ban_reason THEN
    RAISE EXCEPTION 'ban_reason can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.strikes IS DISTINCT FROM OLD.strikes THEN
    RAISE EXCEPTION 'strikes can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.legal_hold IS DISTINCT FROM OLD.legal_hold THEN
    RAISE EXCEPTION 'legal_hold can only be changed by enforcement workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.account_verification_status IS DISTINCT FROM OLD.account_verification_status THEN
    RAISE EXCEPTION 'account_verification_status can only be changed by verification workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_account_enforcement_columns ON public.account_profiles;
CREATE TRIGGER guard_account_enforcement_columns
  BEFORE UPDATE ON public.account_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_account_enforcement_columns();

REVOKE EXECUTE ON FUNCTION public.guard_account_enforcement_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_account_enforcement_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_account_enforcement_columns() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guard_account_enforcement_columns() TO service_role;

-- ── 2. Content status-transition actor gate + column guard ──

-- Replaces the 20260322000000 function: the transition matrix is kept
-- verbatim, but non-service-role, non-admin actors (i.e. content owners
-- writing through PostgREST) may only submit a draft for moderation or
-- hide their own live content. Self-publish (any → live) and un-hide
-- (hidden → live) now require moderation privileges.
CREATE OR REPLACE FUNCTION public.validate_listing_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Allow if status unchanged
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Actor gate: trusted contexts (migrations, console, pg_cron — NULL
  -- role), the service-role admin client, and admins may use any valid
  -- matrix transition. Everyone else is limited to the two
  -- owner-initiated transitions.
  IF NOT (auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin')) THEN
    IF NOT (
      -- owner submits a draft for moderation
      (OLD.status = 'draft' AND NEW.status = 'pending_moderation') OR
      -- owner takes their own live content down
      (OLD.status = 'live'  AND NEW.status = 'hidden')
    ) THEN
      RAISE EXCEPTION 'Status transition % → % requires moderation privileges', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Validate transition against allowed matrix
  IF NOT (
    -- draft → pending_moderation
    (OLD.status = 'draft'              AND NEW.status = 'pending_moderation') OR

    -- pending_moderation → live | rejected | flagged_for_review | hidden
    (OLD.status = 'pending_moderation' AND NEW.status IN ('live', 'rejected', 'flagged_for_review', 'hidden')) OR

    -- flagged_for_review → live | rejected | hidden | pending_moderation
    (OLD.status = 'flagged_for_review' AND NEW.status IN ('live', 'rejected', 'hidden', 'pending_moderation')) OR

    -- live → hidden | expired | flagged_for_review
    (OLD.status = 'live'               AND NEW.status IN ('hidden', 'expired', 'flagged_for_review')) OR

    -- hidden → live | pending_moderation | rejected
    (OLD.status = 'hidden'             AND NEW.status IN ('live', 'pending_moderation', 'rejected')) OR

    -- expired → pending_moderation | draft
    (OLD.status = 'expired'            AND NEW.status IN ('pending_moderation', 'draft')) OR

    -- rejected → pending_moderation | draft
    (OLD.status = 'rejected'           AND NEW.status IN ('pending_moderation', 'draft'))
  ) THEN
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Monetization add-on windows (boost/featured/urgent) and engagement
-- counters are written exclusively by billing fulfillment and system
-- workflows through the service-role admin client. Column presence is
-- checked via to_jsonb so the same guard works across tables whose
-- column sets differ (e.g. click_count exists on promotions only).
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
    'boost_until',
    'featured_until',
    'urgent_until',
    'view_count',
    'click_count',
    'approved_edit_count'
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

DROP TRIGGER IF EXISTS guard_listings_monetization_columns ON public.listings;
CREATE TRIGGER guard_listings_monetization_columns
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_content_monetization_columns();

DROP TRIGGER IF EXISTS guard_businesses_monetization_columns ON public.businesses;
CREATE TRIGGER guard_businesses_monetization_columns
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_content_monetization_columns();

DROP TRIGGER IF EXISTS guard_promotions_monetization_columns ON public.promotions;
CREATE TRIGGER guard_promotions_monetization_columns
  BEFORE UPDATE ON public.promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_content_monetization_columns();

REVOKE EXECUTE ON FUNCTION public.guard_content_monetization_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_content_monetization_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_content_monetization_columns() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guard_content_monetization_columns() TO service_role;

-- ── 3. verification_sessions lockdown ───────────────────────

-- All app writes to verification_sessions go through the service-role
-- admin client (artifact upload, location lifecycle, OTP verify,
-- session start), and service-role bypasses RLS — so the owner UPDATE
-- policy only existed as attack surface: it let any user stamp
-- phone_verified_at / finalized_at on their own row via PostgREST,
-- which app code treats as an approved phone-verification signal.
DROP POLICY IF EXISTS "Owner updates own session" ON public.verification_sessions;

-- Defense in depth: even if a broad UPDATE policy is ever re-added,
-- the verification signal columns stay read-only for non-service-role
-- actors. The owner INSERT policy is kept (session rows can still be
-- created) but inserts may not arrive with signals pre-set.
CREATE OR REPLACE FUNCTION public.guard_verification_session_signals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.phone_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'phone_verified_at can only be set by verification workflows'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'finalized_at can only be set by verification workflows'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
    RAISE EXCEPTION 'phone_verified_at can only be changed by verification workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION 'finalized_at can only be changed by verification workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_verification_session_signals ON public.verification_sessions;
CREATE TRIGGER guard_verification_session_signals
  BEFORE INSERT OR UPDATE ON public.verification_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_verification_session_signals();

REVOKE EXECUTE ON FUNCTION public.guard_verification_session_signals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_verification_session_signals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_verification_session_signals() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.guard_verification_session_signals() TO service_role;

-- ── 4. claim_free_post_slot: revoke + in-function guard ─────

-- 20260723000000 re-granted EXECUTE to authenticated when it recreated
-- the function, undoing the 20260430040000 lockdown. The function takes
-- p_user_id with no caller check, so any logged-in user could burn a
-- victim's free-post slot. The app only calls it through the
-- service-role admin client (src/lib/billing/free-posts.ts), so the
-- authenticated grant is removed again.
REVOKE EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_free_post_slot(UUID, marketplace_area, UUID, INTEGER) TO service_role;

-- Defense in depth inside the function itself: a caller carrying a
-- non-service-role JWT may only claim for their own user id. Service
-- role always passes (auth.uid() is NULL for service role, and the
-- auth.role() check short-circuits before it is consulted), as do
-- trusted non-PostgREST contexts where auth.role() is NULL.
CREATE OR REPLACE FUNCTION public.claim_free_post_slot(
  p_user_id UUID,
  p_area marketplace_area,
  p_content_id UUID,
  p_max_allowed INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INTEGER;
BEGIN
  IF auth.role() IS NOT NULL
     AND auth.role() <> 'service_role'
     AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'claim_free_post_slot may only claim a slot for the calling user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || '::free_post::' || p_area::text)
  );

  IF EXISTS (
    SELECT 1
    FROM public.free_posts_used
    WHERE user_id = p_user_id
      AND area = p_area
      AND content_id = p_content_id
      AND released_at IS NULL
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT COUNT(*)
  INTO current_count
  FROM public.free_posts_used
  WHERE user_id = p_user_id
    AND area = p_area
    AND released_at IS NULL;

  IF current_count >= p_max_allowed THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.free_posts_used (user_id, area, content_id)
  VALUES (p_user_id, p_area, p_content_id);

  RETURN TRUE;
END;
$$;

-- ── 5. Revoke free-post probe helpers ───────────────────────

-- These helpers have no app callers and let any RPC caller probe
-- whether an arbitrary user has content in an area. The functions
-- stay in place (claim flows may reuse them later); only the public
-- EXECUTE surface is removed.
REVOKE EXECUTE ON FUNCTION public.free_post_content_exists(UUID, marketplace_area, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.free_post_content_exists(UUID, marketplace_area, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.free_post_content_exists(UUID, marketplace_area, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.free_post_content_exists(UUID, marketplace_area, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.free_post_area_has_any_content(UUID, marketplace_area) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.free_post_area_has_any_content(UUID, marketplace_area) FROM anon;
REVOKE EXECUTE ON FUNCTION public.free_post_area_has_any_content(UUID, marketplace_area) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.free_post_area_has_any_content(UUID, marketplace_area) TO service_role;

-- ── 6. increment_strikes RPC ────────────────────────────────

-- Used by src/app/api/admin/flagging/action/route.ts via the admin
-- client when a "warn" enforcement action is applied. Atomically
-- increments strikes and marks the account warned without regressing
-- a stricter status (suspended/banned accounts stay as they are).
CREATE OR REPLACE FUNCTION public.increment_strikes(owner_id_input UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_strikes INTEGER;
BEGIN
  UPDATE public.account_profiles
  SET strikes = strikes + 1,
      account_status = CASE
        WHEN account_status IN ('active', 'warned') THEN 'warned'::public.account_status
        ELSE account_status
      END,
      updated_at = now()
  WHERE user_id = owner_id_input
  RETURNING strikes INTO new_strikes;

  RETURN new_strikes;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_strikes(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_strikes(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_strikes(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_strikes(UUID) TO service_role;
