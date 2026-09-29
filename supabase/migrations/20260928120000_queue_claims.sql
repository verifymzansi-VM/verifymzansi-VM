-- Queue claims: many moderators, no collisions.
--
-- A moderator claims the next items from a queue (reports, KYC, content) and
-- only they can decide those items while the claim lasts. Claims are
-- server-enforced leases:
--   * claim_queue_items() locks the work rows themselves with
--     FOR UPDATE SKIP LOCKED, so concurrent moderators receive disjoint items;
--   * it skips anything the moderator reported, owns or is the subject of;
--   * at most 20 active claims per person; 15-minute expiry measured in
--     database time; at most 4 renewals;
--   * ordering: severity or risk first, then age. A claim never touches the
--     item's own timestamps, so SLA clocks are unaffected;
--   * only the holder releases a claim; governors and admins can free or
--     reassign one, with a reason, audited;
--   * claims disappear when their holder loses staff access.
--
-- The decision routes call check_queue_claim() before acting and
-- release_queue_claim() afterwards. Status checks on the items themselves
-- still stop two decisions landing on the same item.

BEGIN;

CREATE TABLE public.queue_claims (
  item_type  text NOT NULL CHECK (item_type IN ('report', 'verification_step', 'listing', 'business',
                                                'promotion', 'content_edit')),
  item_id    uuid NOT NULL,
  queue      text NOT NULL CHECK (queue IN ('reports', 'kyc', 'content')),
  claimed_by uuid NOT NULL,
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  renewals   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_type, item_id)
);
CREATE INDEX queue_claims_holder_idx ON public.queue_claims (claimed_by, expires_at);
CREATE INDEX queue_claims_expiry_idx ON public.queue_claims (expires_at);

ALTER TABLE public.queue_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.queue_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.queue_claims TO authenticated;
GRANT ALL ON public.queue_claims TO service_role;
CREATE POLICY "Staff read queue claims" ON public.queue_claims
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(ARRAY['moderator', 'governance_controller', 'admin'])));

-- ── Conflicts: nobody works an item that is about themselves ────────────
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
  END IF;
  RETURN coalesce(v, false);
END;
$$;

-- ── Claim ───────────────────────────────────────────────────────────────
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
  IF p_queue NOT IN ('reports', 'kyc', 'content') THEN
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

-- ── Renew, release, reassign ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renew_queue_claims(p_actor uuid)
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  WITH renewed AS (
    UPDATE public.queue_claims
       SET expires_at = now() + interval '15 minutes', renewals = renewals + 1
     WHERE claimed_by = p_actor AND expires_at > now() AND renewals < 4
    RETURNING 1
  )
  SELECT count(*)::integer FROM renewed;
$$;

CREATE OR REPLACE FUNCTION public.release_queue_claims(p_actor uuid, p_item_type text, p_item_id uuid)
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  WITH released AS (
    DELETE FROM public.queue_claims
     WHERE claimed_by = p_actor
       AND (p_item_type IS NULL OR (item_type = p_item_type AND item_id = p_item_id))
    RETURNING 1
  )
  SELECT count(*)::integer FROM released;
$$;

CREATE OR REPLACE FUNCTION public.reassign_queue_claim(
  p_actor uuid, p_item_type text, p_item_id uuid, p_to uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  v_to_role text;
  c public.queue_claims%ROWTYPE;
BEGIN
  IF NOT public.is_decision_staff(v_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required');
  END IF;
  SELECT * INTO c FROM public.queue_claims WHERE item_type = p_item_type AND item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_claimed');
  END IF;

  IF p_to IS NULL THEN
    DELETE FROM public.queue_claims WHERE item_type = p_item_type AND item_id = p_item_id;
  ELSE
    v_to_role := public.staff_role_of(p_to);
    IF v_to_role IS NULL OR v_to_role NOT IN ('moderator', 'admin') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_assignee');
    END IF;
    IF public.queue_item_conflict(p_to, p_item_type, p_item_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
    END IF;
    UPDATE public.queue_claims
       SET claimed_by = p_to, token = gen_random_uuid(), claimed_at = now(),
           expires_at = now() + interval '15 minutes', renewals = 0
     WHERE item_type = p_item_type AND item_id = p_item_id;
  END IF;

  PERFORM public.decision_audit(p_actor, v_role, 'queue_claim_reassigned', p_item_type, p_item_id,
    jsonb_build_object('from', c.claimed_by, 'to', p_to), p_reason);
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_to IS NULL THEN 'released' ELSE 'reassigned' END);
END;
$$;

-- ── Decision routes: may this actor decide this item now? ───────────────
CREATE OR REPLACE FUNCTION public.check_queue_claim(p_actor uuid, p_item_type text, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text := public.staff_role_of(p_actor);
  c public.queue_claims%ROWTYPE;
BEGIN
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF public.queue_item_conflict(p_actor, p_item_type, p_item_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_independent');
  END IF;
  SELECT * INTO c FROM public.queue_claims
   WHERE item_type = p_item_type AND item_id = p_item_id AND expires_at > now();
  IF FOUND THEN
    IF c.claimed_by = p_actor THEN
      RETURN jsonb_build_object('ok', true, 'claimed', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'claimed_by_other', 'expires_at', c.expires_at);
  END IF;
  -- Moderators work from claims; governors and admins may act on unclaimed items.
  IF v_role = 'moderator' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_required');
  END IF;
  RETURN jsonb_build_object('ok', true, 'claimed', false);
END;
$$;

-- Losing staff access releases the person's claims.
CREATE OR REPLACE FUNCTION public.release_claims_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status <> 'active' OR NEW.role NOT IN ('moderator', 'admin') THEN
    DELETE FROM public.queue_claims WHERE claimed_by = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_roles_release_claims
  AFTER UPDATE OF status, role ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.release_claims_on_role_change();

-- Expired claims are also cleared by the 5-minute expiry job.
CREATE OR REPLACE FUNCTION public.expire_queue_claims()
RETURNS integer
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$
  WITH gone AS (DELETE FROM public.queue_claims WHERE expires_at <= now() RETURNING 1)
  SELECT count(*)::integer FROM gone;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.queue_item_conflict(uuid, text, uuid)',
    'public.claim_queue_items(uuid, text, integer)',
    'public.renew_queue_claims(uuid)',
    'public.release_queue_claims(uuid, text, uuid)',
    'public.reassign_queue_claim(uuid, text, uuid, uuid, text)',
    'public.check_queue_claim(uuid, text, uuid)',
    'public.release_claims_on_role_change()',
    'public.expire_queue_claims()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('expire-queue-claims', '*/5 * * * *', 'SELECT public.expire_queue_claims()');
  END IF;
END $$;

COMMIT;
