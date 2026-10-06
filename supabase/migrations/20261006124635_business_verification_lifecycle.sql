-- Daily business verification lifecycle (docs/business-verification-spec.md §2, §9):
--   * files are deleted 30 days after a case closes (r2_cleanup_queue does the
--     storage delete); hashes and metadata stay for the audit trail;
--   * cases waiting on the owner for 30 days close as withdrawn;
--   * stickers expire after 12 months and leave the business profile;
--   * owners get a renewal reminder 30 days before expiry.
-- Owners on legal hold keep their files.

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

  -- One reminder, 30 days before expiry (the job runs daily).
  INSERT INTO public.notifications (user_id, type, title, message, href)
  SELECT b.owner_id, 'info', 'Renew your CIPC sticker',
         'Your CIPC registered sticker expires on ' || to_char(b.cipc_expires_at, 'DD Mon YYYY') ||
         '. Renew in one tap — no new upload needed unless your details changed.',
         '/dashboard/businesses/' || b.id || '/verification'
    FROM public.businesses b
   WHERE b.cipc_expires_at >= now() + interval '29 days'
     AND b.cipc_expires_at < now() + interval '30 days';
  GET DIAGNOSTICS v_reminded = ROW_COUNT;

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
REVOKE EXECUTE ON FUNCTION public.run_business_verification_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_business_verification_lifecycle() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'business_verification_daily';
    PERFORM cron.schedule('business_verification_daily', '15 2 * * *',
                          'SELECT public.run_business_verification_lifecycle()');
  END IF;
END;
$$;
