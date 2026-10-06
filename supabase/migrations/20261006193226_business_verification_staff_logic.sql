-- Business verification staff logic (debug pass B).
--
-- 1. append_seen_photo: atomic append of a visit photo, only by the assigned
--    verifier and only before the report (concurrent uploads lost photos or
--    erased a submitted report).
-- 2. One holder per company: another owner can never hold a verified CIPC
--    sticker for the same registration number (closes the approval race).
-- 3. claim_queue_items (business_kyc) skips cases the claimer can't act on.

CREATE OR REPLACE FUNCTION public.append_seen_photo(p_case uuid, p_actor uuid, p_photo jsonb)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.business_verifications
     SET seen = jsonb_set(coalesce(seen, '{}'::jsonb), '{photos}',
                          coalesce(seen->'photos', '[]'::jsonb) || jsonb_build_array(p_photo))
   WHERE id = p_case
     AND kind = 'seen'
     AND status = 'pending'
     AND seen->>'assignedTo' = p_actor::text
     AND jsonb_typeof(seen->'report') IS DISTINCT FROM 'object'
  RETURNING true
$$;
REVOKE EXECUTE ON FUNCTION public.append_seen_photo(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_seen_photo(uuid, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.one_cipc_holder_per_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.cipc_registration_number IS NULL OR NEW.cipc_verified_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- Serialise grants for the same company so two approvals can't both pass.
  PERFORM pg_advisory_xact_lock(hashtext('cipc_holder:' || NEW.cipc_registration_number));
  IF EXISTS (SELECT 1 FROM public.businesses b
              WHERE b.cipc_registration_number = NEW.cipc_registration_number
                AND b.cipc_verified_at IS NOT NULL
                AND b.owner_id IS DISTINCT FROM NEW.owner_id
                AND b.id <> NEW.id) THEN
    RAISE EXCEPTION 'cipc_held_by_other_owner' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.one_cipc_holder_per_company() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS one_cipc_holder_per_company ON public.businesses;
CREATE TRIGGER one_cipc_holder_per_company
  BEFORE INSERT OR UPDATE OF cipc_registration_number, cipc_verified_at, owner_id
  ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.one_cipc_holder_per_company();

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
         -- Only hand out cases the claimer can act on:
         -- a Seen check booked by another verifier (they work it themselves),
         AND NOT (bv.kind = 'seen'
                  AND coalesce(bv.seen->>'assignedTo', '') NOT IN ('', p_actor::text)
                  AND jsonb_typeof(bv.seen->'report') IS DISTINCT FROM 'object')
         -- a Seen report the claimer wrote (a different person approves it),
         AND coalesce(bv.seen->'report'->>'by', '') <> p_actor::text
         -- and an exception waiting for a senior second reviewer.
         AND NOT coalesce(bv.checks->'exception' ? 'proposedBy'
                          AND NOT (bv.checks->'exception' ? 'confirmedBy'), false)
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
