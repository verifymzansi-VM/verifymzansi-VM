-- Business verification jobs and ownership (debug pass D).
--
-- 1. Renewal reminders catch up after a missed daily run, go once per company
--    (not per linked profile), never repeat within 35 days, and skip owners
--    with a renewal already open. Seen stickers get a 30-day reminder too.
-- 2. A change of owner also removes the sticker from profiles linked to the
--    company, and closed cases record when they were decided.

CREATE OR REPLACE FUNCTION public.run_business_verification_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_closed integer;
  v_expired integer;
  v_reminded integer;
  v_purged integer;
BEGIN
  -- Waiting on the owner for 30 days: close the case.
  WITH closed AS (
    UPDATE public.business_verifications bv
       SET status = 'withdrawn', reason_code = 'no_reply', decided_at = now()
     WHERE bv.status = 'info_requested' AND bv.updated_at < now() - interval '30 days'
    RETURNING bv.owner_id, bv.business_id
  )
  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT owner_id, 'info', 'Business verification closed',
         'We closed your request because we did not hear back in 30 days. You can start again any time.',
         '/dashboard/businesses/' || business_id || '/verification'
    FROM closed;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Stickers past their 12 months.
  UPDATE public.business_verifications
     SET status = 'expired'
   WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at < now();

  WITH expired AS (
    UPDATE public.businesses b
       SET cipc_verified_at = NULL, cipc_expires_at = NULL, cipc_registration_number = NULL,
           cipc_registered_name = NULL, cipc_registered_office = NULL,
           show_full_registered_office = false, owner_verified_role = NULL, owner_position_title = NULL
     WHERE b.cipc_expires_at IS NOT NULL AND b.cipc_expires_at < now()
    RETURNING b.owner_id, b.id
  )
  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT owner_id, 'warning', 'CIPC sticker expired',
         'Your CIPC registered sticker has expired. Renew it in one tap.',
         '/dashboard/businesses/' || id || '/verification'
    FROM expired;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  WITH expired_seen AS (
    UPDATE public.businesses b
       SET seen_verified_at = NULL, seen_expires_at = NULL, seen_method = NULL, seen_city = NULL
     WHERE b.seen_expires_at IS NOT NULL AND b.seen_expires_at < now()
    RETURNING b.owner_id, b.id
  )
  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT owner_id, 'warning', 'Seen sticker expired',
         'Your Seen by VerifyMzansi sticker has expired. Book a new check when you are ready.',
         '/dashboard/businesses/' || id || '/verification'
    FROM expired_seen;

  -- Renewal reminders, 30 days before expiry. A missed run catches up; each
  -- company hears once (linked profiles renew with it), never twice within
  -- 35 days, and not while a renewal is already open.
  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT b.owner_id, 'info', 'Renew your CIPC sticker',
         'Your CIPC registered sticker expires on ' || to_char(b.cipc_expires_at, 'DD Mon YYYY') ||
         '. Renew in one tap — no new upload needed unless your details changed.',
         '/dashboard/businesses/' || b.id || '/verification'
    FROM public.businesses b
   WHERE b.cipc_expires_at > now() AND b.cipc_expires_at <= now() + interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.business_verifications l
                      WHERE l.business_id = b.id AND l.kind = 'cipc_link' AND l.status = 'approved')
     AND NOT EXISTS (SELECT 1 FROM public.business_verifications o
                      WHERE o.business_id = b.id AND o.kind <> 'seen'
                        AND o.status IN ('pending', 'info_requested'))
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = b.owner_id AND n.title = 'Renew your CIPC sticker'
                        AND n.href = '/dashboard/businesses/' || b.id || '/verification'
                        AND n.created_at > now() - interval '35 days');
  GET DIAGNOSTICS v_reminded = ROW_COUNT;

  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT b.owner_id, 'info', 'Book your next Seen check',
         'Your Seen by VerifyMzansi sticker expires on ' || to_char(b.seen_expires_at, 'DD Mon YYYY') ||
         '. Book a short video call or visit to keep it.',
         '/dashboard/businesses/' || b.id || '/verification'
    FROM public.businesses b
   WHERE b.seen_expires_at > now() AND b.seen_expires_at <= now() + interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.business_verifications o
                      WHERE o.business_id = b.id AND o.kind = 'seen'
                        AND o.status IN ('pending', 'info_requested'))
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = b.owner_id AND n.title = 'Book your next Seen check'
                        AND n.href = '/dashboard/businesses/' || b.id || '/verification'
                        AND n.created_at > now() - interval '35 days');

  -- Closed cases: schedule their files for deletion 30 days after closing.
  UPDATE public.business_verification_files f
     SET purge_after = coalesce(bv.decided_at, now()) + interval '30 days'
    FROM public.business_verifications bv
   WHERE f.case_id = bv.id AND f.purge_after IS NULL AND f.purged_at IS NULL
     AND bv.status IN ('approved', 'rejected', 'revoked', 'expired', 'withdrawn');

  -- Delete files whose time has come (storage delete via r2_cleanup_queue).
  WITH purged AS (
    UPDATE public.business_verification_files f
       SET purged_at = now(), extracted_text = NULL
      FROM public.business_verifications bv
     WHERE f.case_id = bv.id
       AND f.purge_after IS NOT NULL AND f.purge_after < now() AND f.purged_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.account_profiles ap
                        WHERE ap.user_id = bv.owner_id AND ap.legal_hold)
    RETURNING f.r2_key
  )
  INSERT INTO public.r2_cleanup_queue (bucket, r2_key, reason)
  SELECT DISTINCT 'private', p.r2_key, 'business_verification_purge'
    FROM purged p
   WHERE NOT EXISTS (SELECT 1 FROM public.r2_cleanup_queue q
                      WHERE q.r2_key = p.r2_key AND q.processed_at IS NULL);
  GET DIAGNOSTICS v_purged = ROW_COUNT;

  RETURN jsonb_build_object('closed', v_closed, 'expired', v_expired,
                            'reminded', v_reminded, 'purged', v_purged);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_business_verification_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  verification_cols text[] := ARRAY[
    'cipc_verified_at', 'cipc_expires_at', 'cipc_registration_number', 'cipc_registered_name',
    'cipc_registered_office', 'show_full_registered_office', 'seen_verified_at',
    'seen_expires_at', 'seen_method', 'seen_city', 'owner_verified_role', 'owner_position_title'];
  col text;
BEGIN
  -- A new owner does not inherit the previous owner's verification.
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    NEW.cipc_verified_at := NULL; NEW.cipc_expires_at := NULL;
    NEW.cipc_registration_number := NULL; NEW.cipc_registered_name := NULL;
    NEW.cipc_registered_office := NULL; NEW.show_full_registered_office := false;
    NEW.seen_verified_at := NULL; NEW.seen_expires_at := NULL;
    NEW.seen_method := NULL; NEW.seen_city := NULL;
    NEW.owner_verified_role := NULL; NEW.owner_position_title := NULL;
    -- Profiles linked to this company share its sticker, so they lose it too.
    WITH links AS (
      UPDATE public.business_verifications l
         SET status = 'revoked', reason_code = 'source_owner_changed', decided_at = now()
       WHERE l.kind = 'cipc_link' AND l.status = 'approved' AND l.business_id <> NEW.id
         AND l.linked_case_id IN (SELECT c.id FROM public.business_verifications c
                                   WHERE c.business_id = NEW.id)
      RETURNING l.business_id
    )
    UPDATE public.businesses b
       SET cipc_verified_at = NULL, cipc_expires_at = NULL, cipc_registration_number = NULL,
           cipc_registered_name = NULL, cipc_registered_office = NULL,
           show_full_registered_office = false, owner_verified_role = NULL,
           owner_position_title = NULL
     WHERE b.id IN (SELECT business_id FROM links);
    UPDATE public.business_verifications
       SET status = 'revoked', reason_code = 'ownership_changed', decided_at = now()
      WHERE business_id = NEW.id AND status IN ('approved', 'pending', 'info_requested');
    RETURN NEW;
  END IF;

  IF auth.role() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  FOREACH col IN ARRAY verification_cols LOOP
    IF TG_OP = 'INSERT' THEN
      IF to_jsonb(NEW) -> col IS NOT NULL AND to_jsonb(NEW) -> col <> 'null'::jsonb
         AND NOT (col = 'show_full_registered_office' AND to_jsonb(NEW) -> col = 'false'::jsonb) THEN
        RAISE EXCEPTION 'Verification fields are set by VerifyMzansi staff'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'Verification fields are set by VerifyMzansi staff'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
