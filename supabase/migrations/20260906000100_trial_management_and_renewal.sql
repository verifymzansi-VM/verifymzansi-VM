BEGIN;
CREATE FUNCTION public.manage_intro_trial(p_actor_id uuid, p_action text, p_target text,
 p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; new_expiry timestamptz; n integer; c public.intro_trial_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
  SELECT 1 FROM auth.users WHERE id = p_actor_id AND raw_app_meta_data->>'role' IN ('admin','governance_controller')
 ) THEN RAISE EXCEPTION 'Trial management permission required' USING ERRCODE = '42501'; END IF;
 IF length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF p_action = 'configure' THEN
  UPDATE public.intro_trial_campaigns SET slot_limit = (p_values->>'slotLimit')::integer,
   launch_enabled = (p_values->>'launchEnabled')::boolean, seven_day_enabled = (p_values->>'sevenDayEnabled')::boolean
  WHERE area = p_target::public.marketplace_area;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
 ELSE
  SELECT * INTO STRICT t FROM public.intro_trial_claims WHERE id = p_target::uuid FOR UPDATE;
  IF p_action = 'revoke' THEN
   -- Hide first. The content trigger releases capacity in the same transaction.
   IF t.content_table IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET status = ''hidden'', status_reason = ''Introductory trial revoked'' WHERE id = $1 AND status = ''live''', t.content_table) USING t.content_id;
   END IF;
   UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'admin_revoked' WHERE id = t.id;
  ELSIF p_action = 'extend' THEN
   IF t.activated_at IS NULL OR t.converted_at IS NOT NULL OR t.released_at IS NOT NULL OR t.expires_at <= now() THEN RAISE EXCEPTION 'Only active unconverted trials can be extended'; END IF;
   new_expiry := (p_values->>'expiresAt')::timestamptz;
   IF new_expiry IS NULL OR new_expiry <= t.expires_at OR new_expiry > t.activated_at + interval '60 days' THEN RAISE EXCEPTION 'Extension must end within 60 days of activation'; END IF;
   -- A seven-day trial must never turn into an unallocated launch offer.
   IF t.duration_days = 7 THEN RAISE EXCEPTION 'Seven-day introductory trials cannot be extended'; END IF;
   SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = t.area FOR UPDATE;
   SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = t.area AND duration_days = 30 AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
   IF n > c.slot_limit THEN RAISE EXCEPTION 'Pool exceeds the current limit'; END IF;
   UPDATE public.intro_trial_claims SET expires_at = new_expiry WHERE id = t.id;
   EXECUTE format('UPDATE public.%I SET expires_at = $1 WHERE id = $2 AND status = ''live''', t.content_table) USING new_expiry, t.content_id;
  ELSE RAISE EXCEPTION 'Unknown trial management action';
  END IF;
 END IF;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason,details) VALUES(p_actor_id,p_action,p_target,p_reason,p_values);
END;
$$;

CREATE FUNCTION public.update_own_intro_trial(p_user_id uuid, p_claim_id uuid, p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; e public.entitlements; n integer; cap integer; tier_features jsonb; content jsonb; photos integer; videos integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 SELECT * INTO STRICT t FROM public.intro_trial_claims WHERE id = p_claim_id AND user_id = p_user_id FOR UPDATE;
 IF p_action = 'choose_seven' THEN
  IF t.activated_at IS NOT NULL OR t.released_at IS NOT NULL THEN RAISE EXCEPTION 'Only a pending trial can be changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.intro_trial_campaigns WHERE area = t.area AND seven_day_enabled) THEN RAISE EXCEPTION 'Seven-day offer is paused'; END IF;
  UPDATE public.intro_trial_claims SET duration_days = 7 WHERE id = t.id;
 ELSIF p_action = 'renew' THEN
  IF public.intro_trial_identity(p_user_id) IS NULL THEN RAISE EXCEPTION 'Verification required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::posting_area_limit::' || t.area::text));
  SELECT * INTO STRICT e FROM public.entitlements WHERE user_id = p_user_id AND area = t.area
   AND type = 'subscription' AND status = 'active' AND expires_at > now() ORDER BY expires_at DESC LIMIT 1 FOR UPDATE;
  -- Use the paid-plan capacity encoded in the plan catalogue. Includes the
  -- shared tourism businesses + events pool and matches normal create counts.
  SELECT features INTO tier_features FROM public.plans WHERE area = t.area AND tier = e.tier AND active = true LIMIT 1;
  cap := COALESCE((tier_features->>'maxListings')::integer,(tier_features->>'maxBusinesses')::integer,(tier_features->>'maxPromotions')::integer,0);
  n := public.posting_area_used(p_user_id,t.area::text,t.content_id);
  IF cap <> -1 AND n >= cap THEN RAISE EXCEPTION 'Paid plan capacity reached'; END IF;
  IF t.content_table IS NULL THEN RAISE EXCEPTION 'Content not found'; END IF;
  EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE id=$1 FOR UPDATE',t.content_table) INTO STRICT content USING t.content_id;
  photos := jsonb_array_length(COALESCE(NULLIF(content->'photos','null'::jsonb),NULLIF(content->'gallery_photos','null'::jsonb),'[]'::jsonb));
  videos := jsonb_array_length(COALESCE(NULLIF(content->'videos','null'::jsonb),'[]'::jsonb)) + CASE WHEN NULLIF(content->>'cover_video','') IS NOT NULL THEN 1 ELSE 0 END;
  IF photos > COALESCE((tier_features->>'maxPhotos')::integer,0)
    OR videos > COALESCE((tier_features->>'maxVideos')::integer, CASE WHEN (tier_features->>'videoAllowed')::boolean THEN 1 ELSE 0 END)
    OR (videos > 0 AND NOT COALESCE((tier_features->>'videoAllowed')::boolean,false)) THEN
   RAISE EXCEPTION 'Paid plan must support the media on this post';
  END IF;
  IF (content->>'end_date')::timestamptz <= now() THEN RAISE EXCEPTION 'This event has ended'; END IF;
  UPDATE public.intro_trial_claims SET converted_at = COALESCE(converted_at,now()), released_at = COALESCE(released_at,now()), release_reason = 'paid_renewal' WHERE id = t.id;
  -- Re-review expired/hidden content. A live trial keeps its current approval.
  EXECUTE format($update$UPDATE public.%I SET expires_at = $1, status = CASE WHEN status = 'live' THEN status ELSE 'pending_moderation' END WHERE id = $2 AND status IN ('live','expired','hidden','pending_moderation')$update$,t.content_table) USING e.expires_at,t.content_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Content cannot be renewed in its current state'; END IF;
 ELSE RAISE EXCEPTION 'Unknown action'; END IF;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason) VALUES(p_user_id,p_action,p_claim_id::text,'Member requested trial update');
END;
$$;

CREATE FUNCTION public.notify_intro_trials() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; milestone integer; inserted integer; total integer := 0;
BEGIN
 FOR t IN SELECT * FROM public.intro_trial_claims WHERE activated_at IS NOT NULL AND converted_at IS NULL
  AND user_id IS NOT NULL AND (released_at IS NULL OR release_reason = 'expired') LOOP
  milestone := CASE WHEN t.expires_at <= now() THEN 0
   WHEN t.expires_at <= now()+interval '1 day' THEN 1
   WHEN t.duration_days=7 AND t.expires_at <= now()+interval '2 days' THEN 2
   WHEN t.duration_days=30 AND t.expires_at <= now()+interval '3 days' THEN 3
   WHEN t.duration_days=30 AND t.expires_at <= now()+interval '7 days' THEN 7 ELSE NULL END;
  IF milestone IS NULL THEN CONTINUE; END IF;
  INSERT INTO public.intro_trial_notices(claim_id,milestone) VALUES(t.id,milestone) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN
   INSERT INTO public.notifications(user_id,type,title,message,href) VALUES(t.user_id,'info',
    CASE WHEN milestone=0 THEN 'Your introductory trial has ended' ELSE 'Your introductory trial ends soon' END,
    CASE WHEN milestone=0 THEN 'Your content is saved in your dashboard. Choose a paid plan and renew to make it visible again.' ELSE 'Your trial ends within ' || milestone || ' day(s). You will not be charged automatically.' END,'/dashboard');
   total := total + 1;
  END IF;
 END LOOP;
 RETURN total;
END;
$$;
CREATE FUNCTION public.intro_trial_summary() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM (
  SELECT c.area,
   count(t.id) FILTER (WHERE t.duration_days=30 AND t.activated_at IS NOT NULL AND t.released_at IS NULL AND t.converted_at IS NULL AND t.expires_at>now()) AS active,
   count(t.id) FILTER (WHERE t.duration_days=7 AND t.activated_at IS NOT NULL) AS "started7",
   count(t.id) FILTER (WHERE t.duration_days=30 AND t.activated_at IS NOT NULL) AS "started30",
   count(t.id) FILTER (WHERE t.activated_at IS NOT NULL AND t.expires_at<=now() AND t.converted_at IS NULL) AS expired,
   count(t.id) FILTER (WHERE t.converted_at IS NOT NULL AND t.activated_at IS NOT NULL) AS converted,
   count(t.id) FILTER (WHERE t.release_reason='admin_revoked') AS revoked,
   COALESCE(round(100.0 * count(t.id) FILTER (WHERE t.converted_at IS NOT NULL AND t.activated_at IS NOT NULL) / nullif(count(t.id) FILTER (WHERE t.activated_at IS NOT NULL),0),1),0) AS "conversionRate"
  FROM public.intro_trial_campaigns c LEFT JOIN public.intro_trial_claims t ON t.area=c.area GROUP BY c.area
 ) s;
$$;
REVOKE ALL ON FUNCTION public.manage_intro_trial(uuid,text,text,jsonb,text), public.update_own_intro_trial(uuid,uuid,text), public.notify_intro_trials(), public.intro_trial_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_intro_trial(uuid,text,text,jsonb,text), public.update_own_intro_trial(uuid,uuid,text), public.notify_intro_trials(), public.intro_trial_summary() TO service_role;
DO $cron$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.schedule('intro-trial-notifications','15 * * * *','SELECT public.notify_intro_trials()');
 END IF;
END $cron$;
COMMIT;
