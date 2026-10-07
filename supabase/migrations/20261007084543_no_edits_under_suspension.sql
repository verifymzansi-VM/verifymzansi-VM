-- Posts under suspension or review can't be rewritten (posting audit 2026-10-07).
--
-- Owners could edit a suspended (or flagged) post; lifting the suspension
-- restored it straight to live, publishing content nobody reviewed. Content
-- changes are now refused in those states, and a restore keeps any post that
-- was edited since its last review hidden for review instead of live.

CREATE OR REPLACE FUNCTION public.guard_owner_content_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Bookkeeping and presentation-only fields (image crop and dimensions).
  review_exempt text[] := ARRAY['status', 'updated_at', 'search_vector', 'edited_since_review',
                                'focal_x', 'focal_y', 'media_width', 'media_height'];
  content_changed boolean :=
    (to_jsonb(NEW) - review_exempt) IS DISTINCT FROM (to_jsonb(OLD) - review_exempt);
BEGIN
  IF auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin') THEN
    -- Moderation approval clears the flag; nothing else touches it.
    IF NEW.status::text = 'live'
       AND OLD.status::text IN ('pending_moderation', 'flagged_for_review') THEN
      NEW.edited_since_review := false;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.edited_since_review IS DISTINCT FROM OLD.edited_since_review
     OR to_jsonb(NEW)->'entitlement_id' IS DISTINCT FROM to_jsonb(OLD)->'entitlement_id'
     OR to_jsonb(NEW)->'status_reason' IS DISTINCT FROM to_jsonb(OLD)->'status_reason' THEN
    RAISE EXCEPTION 'edited_since_review, entitlement_id and status_reason are set by system workflows'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF content_changed THEN
    -- Approved content changes only through the content edit review. Status
    -- moves (hide, mark sold) stay subject to validate_listing_status_transition.
    IF OLD.status::text = 'live' THEN
      RAISE EXCEPTION 'Live content changes must go through edit review'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Content under suspension or review is evidence: it can't be rewritten.
    IF OLD.status::text IN ('suspended', 'flagged_for_review') THEN
      RAISE EXCEPTION 'Content under review or suspension cannot be edited'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status::text NOT IN ('draft', 'pending_moderation', 'rejected') THEN
      NEW.edited_since_review := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_content_effect_internal(p_effect uuid, p_by_decision uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  e public.content_effects%ROWTYPE;
  v_status text;
  v_expires timestamptz;
  v_end timestamptz;
  v_edited boolean;
  v_outcome text;
BEGIN
  SELECT * INTO e FROM public.content_effects WHERE id = p_effect AND reverted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  EXECUTE format('SELECT status::text, (to_jsonb(t)->>''expires_at'')::timestamptz, (to_jsonb(t)->>''end_date'')::timestamptz,
                         coalesce((to_jsonb(t)->>''edited_since_review'')::boolean, false)
                    FROM public.%I t WHERE id = $1 FOR UPDATE', e.table_name)
    INTO v_status, v_expires, v_end, v_edited USING e.row_id;

  IF v_status IS NULL THEN
    v_outcome := 'skipped:content_deleted';
  ELSIF v_status <> e.applied_status THEN
    v_outcome := 'skipped:status_changed_to_' || v_status;
  ELSIF e.prior_status = 'live' AND (v_expires <= now() OR v_end <= now()) THEN
    BEGIN
      EXECUTE format('UPDATE public.%I SET status = ''hidden'' WHERE id = $1', e.table_name) USING e.row_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    v_outcome := 'kept_hidden:listing_period_ended';
  ELSE
    DECLARE
      -- Flagged posts, and posts edited since their last review, are not put
      -- back live unseen.
      v_restore text := CASE
        WHEN e.prior_status = 'flagged_for_review' THEN 'hidden'
        WHEN e.prior_status = 'live' AND v_edited THEN 'hidden'
        ELSE e.prior_status END;
    BEGIN
      EXECUTE format('UPDATE public.%I SET status = %L WHERE id = $1', e.table_name, v_restore) USING e.row_id;
      v_outcome := CASE WHEN v_restore = e.prior_status THEN 'restored' ELSE 'kept_hidden:needs_review' END;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE format('UPDATE public.%I SET status = ''hidden'' WHERE id = $1', e.table_name) USING e.row_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      v_outcome := 'kept_hidden:' || left(SQLERRM, 200);
    END;
  END IF;

  UPDATE public.content_effects
     SET reverted_at = now(), reverted_by_decision_id = p_by_decision, revert_outcome = v_outcome
   WHERE id = e.id;
  RETURN v_outcome;
END;
$$;
