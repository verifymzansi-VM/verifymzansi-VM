-- Apply before deploying the matching OTP route. A failed write rolls back the
-- challenge claim, canonical phone, step, session and OTP audit marker together.
CREATE OR REPLACE FUNCTION public.finalize_otp_phone_verification(
  p_user_id uuid, p_challenge_id uuid, p_expected_hash text, p_phone text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_profile public.account_profiles%ROWTYPE;
  v_challenge public.otp_challenges%ROWTYPE;
  v_phone text := public.normalize_sa_phone(p_phone);
  v_now timestamptz;
  v_changed boolean;
BEGIN
  IF v_phone IS NULL OR v_phone !~ '^\+27[0-9]{9}$' OR p_expected_hash IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_challenge');
  END IF;
  -- Lock account state before the challenge. Recheck staging, restrictions and
  -- cooldown under the same lock as promotion instead of trusting earlier HTTP reads.
  SELECT * INTO v_profile FROM public.account_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'profile_missing'); END IF;
  v_now := clock_timestamp();
  IF v_profile.account_status = 'banned' OR (v_profile.account_status = 'suspended'
      AND (v_profile.suspended_until IS NULL OR v_profile.suspended_until > v_now)) THEN
    RETURN jsonb_build_object('outcome', 'account_restricted');
  END IF;
  IF v_profile.pending_phone IS NOT NULL AND v_profile.pending_phone IS DISTINCT FROM v_phone THEN
    RETURN jsonb_build_object('outcome', 'invalid_challenge');
  END IF;
  SELECT * INTO v_challenge FROM public.otp_challenges
    WHERE id = p_challenge_id AND user_id = p_user_id AND phone = v_phone FOR UPDATE;
  IF NOT FOUND OR v_challenge.otp_hash IS DISTINCT FROM p_expected_hash
      OR v_challenge.expires_at IS NULL OR v_challenge.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('outcome', 'invalid_challenge');
  END IF;
  IF v_challenge.verified_at IS NOT NULL THEN
    IF v_profile.phone = v_phone AND v_profile.pending_phone IS NULL
      AND EXISTS (SELECT 1 FROM public.verification_steps WHERE user_id = p_user_id
        AND step_type = 'phone' AND status = 'approved' AND phone_verified_at = v_challenge.verified_at)
      AND EXISTS (SELECT 1 FROM public.verification_sessions WHERE user_id = p_user_id
        AND phone_verified_at = v_challenge.verified_at) THEN
      RETURN jsonb_build_object('outcome', 'already_verified', 'phone_changed', false);
    END IF;
    RETURN jsonb_build_object('outcome', 'invalid_challenge');
  END IF;
  IF COALESCE(v_challenge.attempt_count, 0) NOT BETWEEN 1 AND 5 THEN
    RETURN jsonb_build_object('outcome', 'invalid_challenge');
  END IF;
  v_changed := v_profile.phone IS DISTINCT FROM v_phone;
  IF v_changed AND v_profile.phone IS NOT NULL THEN
    IF v_profile.pending_phone IS DISTINCT FROM v_phone THEN
      RETURN jsonb_build_object('outcome', 'invalid_challenge');
    END IF;
    IF v_profile.account_verification_status IS DISTINCT FROM 'verified' THEN
      RETURN jsonb_build_object('outcome', 'phone_reverification_required');
    END IF;
    IF v_profile.contact_last_phone_change_at + interval '360 hours' > v_now THEN
      RETURN jsonb_build_object('outcome', 'phone_cooldown', 'retry_after',
        greatest(1, ceil(extract(epoch FROM
          v_profile.contact_last_phone_change_at + interval '360 hours' - v_now))::integer));
    END IF;
  END IF;
  UPDATE public.account_profiles SET phone = v_phone,
    masked_phone_public = public.mask_phone_public(v_phone), pending_phone = NULL,
    contact_last_phone_change_at = CASE WHEN v_changed THEN v_now ELSE contact_last_phone_change_at END
    WHERE user_id = p_user_id;
  INSERT INTO public.verification_steps(user_id, step_type, status, phone_verified_at)
    VALUES (p_user_id, 'phone', 'approved', v_now)
    ON CONFLICT (user_id, step_type) DO UPDATE
    SET status = EXCLUDED.status, phone_verified_at = EXCLUDED.phone_verified_at;
  INSERT INTO public.verification_sessions(user_id, phone_verified_at)
    VALUES (p_user_id, v_now) ON CONFLICT (user_id) DO UPDATE
    SET phone_verified_at = EXCLUDED.phone_verified_at;
  UPDATE public.otp_challenges SET verified_at = v_now
    WHERE user_id = p_user_id AND phone = v_phone AND verified_at IS NULL;
  UPDATE public.otp_logs SET verified = true, verified_at = v_now
    WHERE phone = v_phone AND otp_hash = p_expected_hash AND verified_at IS NULL;
  RETURN jsonb_build_object('outcome', 'verified', 'phone_changed', v_changed AND v_profile.phone IS NOT NULL);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_otp_phone_verification(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_otp_phone_verification(uuid, uuid, text, text) TO service_role;
