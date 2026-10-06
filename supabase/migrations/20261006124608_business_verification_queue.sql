-- Business verification joins the claimable staff queues (docs/business-verification-spec.md §3.5).
--
-- queue_claims accepts queue 'business_kyc' / item 'business_verification';
-- claim_queue_items hands out pending cases (most red findings first) and
-- never a case the moderator owns; staff_nav_counts adds the sidebar badge.
-- Function bodies are otherwise unchanged from 20260928120000 / 20260929120000.

BEGIN;

ALTER TABLE public.queue_claims DROP CONSTRAINT queue_claims_item_type_check;
ALTER TABLE public.queue_claims ADD CONSTRAINT queue_claims_item_type_check
  CHECK (item_type IN ('report', 'verification_step', 'listing', 'business', 'promotion',
                       'content_edit', 'business_verification'));
ALTER TABLE public.queue_claims DROP CONSTRAINT queue_claims_queue_check;
ALTER TABLE public.queue_claims ADD CONSTRAINT queue_claims_queue_check
  CHECK (queue IN ('reports', 'kyc', 'content', 'business_kyc'));

CREATE OR REPLACE FUNCTION public.queue_item_conflict(p_actor uuid, p_item_type text, p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v boolean := false;
BEGIN
  IF p_item_type = 'report' THEN
    SELECT r.reporter_user_id = p_actor
           OR EXISTS (SELECT 1 FROM public.report_target_owner(r.target_type, r.target_id) o WHERE o.owner_id = p_actor)
      INTO v FROM public.reports r WHERE r.id = p_item_id;
  ELSIF p_item_type = 'verification_step' THEN
    SELECT user_id = p_actor INTO v FROM public.verification_steps WHERE id = p_item_id;
  ELSIF p_item_type = 'listing' THEN
    SELECT owner_id = p_actor INTO v FROM public.listings WHERE id = p_item_id;
  ELSIF p_item_type = 'business' THEN
    SELECT owner_id = p_actor INTO v FROM public.businesses WHERE id = p_item_id;
  ELSIF p_item_type = 'promotion' THEN
    SELECT owner_id = p_actor INTO v FROM public.promotions WHERE id = p_item_id;
  ELSIF p_item_type = 'content_edit' THEN
    SELECT owner_id = p_actor INTO v FROM public.content_edit_requests WHERE id = p_item_id;
  ELSIF p_item_type = 'business_verification' THEN
    SELECT owner_id = p_actor INTO v FROM public.business_verifications WHERE id = p_item_id;
  END IF;
  RETURN coalesce(v, false);
END;
$$;


CREATE OR REPLACE FUNCTION public.claim_queue_items(p_actor uuid, p_queue text, p_limit integer)
RETURNS TABLE (item_type text, item_id uuid, token uuid, expires_at timestamptz)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v_allowed integer;
  v_ttl constant interval := interval '15 minutes';
  r record;
BEGIN
  -- Moderators and admins work queues (queue:claim); governors reassign.
  IF v_role IS NULL OR v_role NOT IN ('moderator', 'admin') THEN
    RAISE EXCEPTION 'claim_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_queue NOT IN ('reports', 'kyc', 'content', 'business_kyc') THEN
    RAISE EXCEPTION 'invalid_queue' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  DELETE FROM public.queue_claims qc WHERE qc.expires_at <= now();

  -- Requested batch (1–25), within the 20-claim personal cap.
  v_allowed := least(greatest(coalesce(p_limit, 10), 1), 25,
                     20 - (SELECT count(*) FROM public.queue_claims qc WHERE qc.claimed_by = p_actor)::integer);
  IF v_allowed <= 0 THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.claim_candidates (
    item_type text, item_id uuid, priority integer, created_at timestamptz
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.claim_candidates;

  IF p_queue = 'reports' THEN
    FOR r IN
      SELECT rep.id, rep.severity, rep.created_at FROM public.reports rep
       WHERE rep.status = 'open'
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'report' AND qc.item_id = rep.id)
         AND rep.reporter_user_id IS DISTINCT FROM p_actor
       ORDER BY (rep.severity::text = 'high') DESC, rep.created_at
       LIMIT v_allowed * 3
       FOR UPDATE OF rep SKIP LOCKED
    LOOP
      IF NOT public.queue_item_conflict(p_actor, 'report', r.id) THEN
        INSERT INTO pg_temp.claim_candidates
        VALUES ('report', r.id, CASE WHEN r.severity::text = 'high' THEN 0 ELSE 1 END, r.created_at);
      END IF;
    END LOOP;

  ELSIF p_queue = 'kyc' THEN
    FOR r IN
      SELECT vs.id, vs.risk_level, vs.created_at FROM public.verification_steps vs
       WHERE vs.status = 'pending'
         AND vs.step_type::text <> 'location'
         AND vs.user_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'verification_step' AND qc.item_id = vs.id)
       ORDER BY CASE vs.risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                vs.created_at
       LIMIT v_allowed
       FOR UPDATE OF vs SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates
      VALUES ('verification_step', r.id,
              CASE r.risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              r.created_at);
    END LOOP;

  ELSIF p_queue = 'business_kyc' THEN
    -- Cases waiting on staff (not on the owner), most red findings first.
    FOR r IN
      SELECT bv.id, bv.created_at,
             (SELECT count(*) FROM jsonb_array_elements(bv.findings) f
               WHERE f->>'severity' = 'attention')::integer AS red
        FROM public.business_verifications bv
       WHERE bv.status = 'pending'
         AND bv.owner_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc
                          WHERE qc.item_type = 'business_verification' AND qc.item_id = bv.id)
       ORDER BY 3 DESC, bv.created_at
       LIMIT v_allowed
       FOR UPDATE OF bv SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates
      VALUES ('business_verification', r.id, -r.red, r.created_at);
    END LOOP;

  ELSE
    FOR r IN
      SELECT l.id, l.created_at FROM public.listings l
       WHERE l.status = 'pending_moderation' AND l.owner_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'listing' AND qc.item_id = l.id)
       ORDER BY l.created_at LIMIT v_allowed FOR UPDATE OF l SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates VALUES ('listing', r.id, 0, r.created_at);
    END LOOP;
    FOR r IN
      SELECT b.id, b.created_at FROM public.businesses b
       WHERE b.status = 'pending_moderation' AND b.owner_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'business' AND qc.item_id = b.id)
       ORDER BY b.created_at LIMIT v_allowed FOR UPDATE OF b SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates VALUES ('business', r.id, 0, r.created_at);
    END LOOP;
    FOR r IN
      SELECT p.id, p.created_at FROM public.promotions p
       WHERE p.status = 'pending_moderation' AND p.owner_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'promotion' AND qc.item_id = p.id)
       ORDER BY p.created_at LIMIT v_allowed FOR UPDATE OF p SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates VALUES ('promotion', r.id, 0, r.created_at);
    END LOOP;
    FOR r IN
      SELECT e.id, e.created_at FROM public.content_edit_requests e
       WHERE e.status = 'pending' AND e.owner_id <> p_actor
         AND NOT EXISTS (SELECT 1 FROM public.queue_claims qc WHERE qc.item_type = 'content_edit' AND qc.item_id = e.id)
       ORDER BY e.created_at LIMIT v_allowed FOR UPDATE OF e SKIP LOCKED
    LOOP
      INSERT INTO pg_temp.claim_candidates VALUES ('content_edit', r.id, 0, r.created_at);
    END LOOP;
  END IF;

  RETURN QUERY
  INSERT INTO public.queue_claims AS qc (item_type, item_id, queue, claimed_by, expires_at)
  SELECT c.item_type, c.item_id, p_queue, p_actor, now() + v_ttl
    FROM pg_temp.claim_candidates c
   ORDER BY c.priority, c.created_at
   LIMIT v_allowed
  ON CONFLICT DO NOTHING
  RETURNING qc.item_type, qc.item_id, qc.token, qc.expires_at;
END;
$$;


CREATE OR REPLACE FUNCTION public.staff_nav_counts(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v jsonb;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v := jsonb_build_object(
    'reports', (SELECT count(*) FROM public.reports WHERE status = 'open'),
    'kyc', (SELECT count(*) FROM public.verification_steps
             WHERE status = 'pending' AND step_type::text <> 'location'),
    'content', (SELECT count(*) FROM public.listings WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.businesses WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.promotions WHERE status = 'pending_moderation')
             + (SELECT count(*) FROM public.content_edit_requests WHERE status = 'pending'),
    'support', (SELECT count(*) FROM public.contact_submissions WHERE status = 'new'),
    'business_kyc', (SELECT count(*) FROM public.business_verifications WHERE status = 'pending'));

  IF public.is_decision_staff(v_role) THEN
    v := v || jsonb_build_object(
      'decisions', (SELECT count(*) FROM public.decision_records
                     WHERE status IN ('pending_approval', 'escalated') AND case_type <> 'staff_role'),
      'appeals', (SELECT count(*) FROM public.appeal_cases WHERE status IN ('submitted', 'under_review')),
      'dsar_overdue', (SELECT count(*) FROM public.dsar_cases
                        WHERE status IN ('submitted', 'identity_pending', 'in_progress')
                          AND effective_due_at < now()),
      'role_changes', (SELECT count(*) FROM public.decision_records
                        WHERE case_type = 'staff_role' AND status = 'pending_approval'));
  END IF;
  RETURN v;
END;
$$;


COMMIT;
