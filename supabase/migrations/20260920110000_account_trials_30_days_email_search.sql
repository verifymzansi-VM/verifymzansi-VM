-- Admin grants last 30 days. Existing submitted posts keep their original duration.
BEGIN;
ALTER TABLE public.intro_trial_claims DROP CONSTRAINT admin_grant_duration;

CREATE OR REPLACE FUNCTION public.intro_trial_offer(p_area public.marketplace_area) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE u uuid := auth.uid(); h text; eligible boolean; c public.intro_trial_campaigns; n integer; credits integer;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
 SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = p_area;
 h := public.intro_trial_identity(u);
 credits := CASE WHEN h IS NOT NULL THEN public.account_free_posts_remaining(u) ELSE 0 END;
 eligible := h IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h)
  AND NOT EXISTS (SELECT 1 FROM public.intro_trial_claims WHERE user_id = u AND NOT admin_granted AND (activated_at IS NOT NULL OR (released_at IS NULL AND (content_table IS NOT NULL OR created_at > now()-interval '15 minutes'))))
  AND NOT EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = u AND COALESCE(release_reason, '') NOT IN ('create_failed','rejected_deleted'));
 SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = p_area AND duration_days = 30 AND NOT admin_granted
  AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
 RETURN jsonb_build_object('adminFreePostsRemaining',credits,'eligible',eligible OR credits > 0,'sevenDayAvailable',credits = 0 AND eligible AND c.seven_day_enabled,
  'thirtyDayAvailable',credits > 0 OR (eligible AND c.launch_enabled AND n < c.slot_limit),
  'remaining',greatest(0,c.slot_limit-n),'launchEnabled',c.launch_enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_intro_trial(p_user_id uuid, p_area public.marketplace_area,
 p_content_id uuid, p_duration_days integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE h text; c public.intro_trial_campaigns;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 IF p_duration_days NOT IN (7,30) OR p_duration_days IS NULL THEN RAISE EXCEPTION 'Invalid trial duration'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::intro_trial'));
 h := public.intro_trial_identity(p_user_id);
 IF h IS NULL THEN RETURN false; END IF;
 SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = p_area;

 -- Repair a crashed create without releasing a real pending moderation post.
 UPDATE public.intro_trial_claims t SET released_at = now(), release_reason = 'abandoned_create'
 WHERE t.user_id = p_user_id AND activated_at IS NULL AND released_at IS NULL
 AND created_at < now() - interval '15 minutes' AND content_table IS NULL;
 -- Granted posts use a separate account allowance and do not consume launch capacity.
 IF p_duration_days = 30 AND public.account_free_posts_remaining(p_user_id) > 0 THEN
  INSERT INTO public.intro_trial_claims(user_id,area,content_id,duration_days,admin_granted)
  VALUES (p_user_id,p_area,p_content_id,30,true);
  RETURN true;
 END IF;
 IF (p_duration_days = 7 AND NOT c.seven_day_enabled) OR (p_duration_days = 30 AND NOT c.launch_enabled) THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h)
 OR EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = p_user_id AND COALESCE(release_reason, '') NOT IN ('create_failed','rejected_deleted'))
 OR EXISTS (SELECT 1 FROM public.intro_trial_claims WHERE user_id = p_user_id AND NOT admin_granted AND (activated_at IS NOT NULL OR released_at IS NULL)) THEN RETURN false; END IF;
 INSERT INTO public.intro_trial_claims(user_id,area,content_id,duration_days)
 VALUES (p_user_id,p_area,p_content_id,p_duration_days);
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_intro_trial_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; c public.intro_trial_campaigns; h text; n integer;
 a public.marketplace_area; staff boolean; paid_expiry timestamptz; event_end timestamptz;
BEGIN
 -- Engagement counters do not change funding. Keep their frequent updates off
 -- the trial ledger lock and verification queries.
 IF TG_OP = 'UPDATE' AND
  (to_jsonb(NEW) - ARRAY['view_count','click_count','updated_at']) =
  (to_jsonb(OLD) - ARRAY['view_count','click_count','updated_at']) THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.intro_trial_claims WHERE content_id = OLD.id FOR UPDATE;
 IF TG_OP = 'DELETE' THEN
  IF t.id IS NOT NULL THEN UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'content_deleted' WHERE id = t.id; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO t FROM public.intro_trial_claims WHERE content_id = NEW.id FOR UPDATE;
 a := CASE WHEN TG_TABLE_NAME = 'promotions' THEN 'PROMOTIONS_EVENTS'::public.marketplace_area ELSE (to_jsonb(NEW)->>'area')::public.marketplace_area END;
 event_end := (to_jsonb(NEW)->>'end_date')::timestamptz;
 IF t.id IS NOT NULL THEN
  IF t.user_id IS DISTINCT FROM NEW.owner_id OR t.area IS DISTINCT FROM a THEN RAISE EXCEPTION 'Trial ownership or area mismatch'; END IF;
  UPDATE public.intro_trial_claims SET content_table = TG_TABLE_NAME WHERE id = t.id;
 END IF;
 IF NEW.status <> 'live' THEN
  IF t.id IS NOT NULL AND NEW.status IN ('hidden','expired','rejected','flagged_for_review') THEN
   UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = NEW.status::text WHERE id = t.id;
  END IF;
  RETURN NEW;
 END IF;
 -- Every reactivation of a trial goes through this gate, including direct
 -- admin writes and repeated moderation. Updates never restart the clock.
 IF t.id IS NULL AND TG_OP = 'UPDATE' AND OLD.status = 'live' THEN RETURN NEW; END IF;
 SELECT COALESCE(raw_app_meta_data->>'role','') IN ('admin','governance_controller','moderator') INTO staff FROM auth.users WHERE id = NEW.owner_id;
 IF staff THEN
  IF t.id IS NOT NULL THEN UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'staff_bypass' WHERE id = t.id; END IF;
  RETURN NEW;
 END IF;
 SELECT max(expires_at) INTO paid_expiry FROM public.entitlements WHERE user_id = NEW.owner_id AND area = a
  AND type = 'subscription' AND status = 'active' AND expires_at > now();
 IF t.id IS NULL THEN
  IF paid_expiry IS NULL AND NOT EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = NEW.owner_id AND content_id = NEW.id AND released_at IS NULL) THEN
   RAISE EXCEPTION 'TRIAL_REQUIRED: Select an introductory offer or a paid plan';
  END IF;
  RETURN NEW;
 END IF;
 h := public.intro_trial_identity(NEW.owner_id);
 IF h IS NULL THEN RAISE EXCEPTION 'TRIAL_VERIFICATION_REQUIRED: Complete verification before approval'; END IF;
 IF t.converted_at IS NOT NULL THEN
  IF paid_expiry IS NULL THEN RAISE EXCEPTION 'TRIAL_EXPIRED: Paid renewal required'; END IF;
  NEW.expires_at := least(NEW.expires_at, paid_expiry);
  IF event_end IS NOT NULL THEN
   NEW.expires_at := least(NEW.expires_at,event_end);
   IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF t.activated_at IS NOT NULL THEN
  IF t.released_at IS NOT NULL OR t.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EXPIRED: Paid renewal required'; END IF;
  NEW.expires_at := t.expires_at;
 ELSE
  IF t.released_at IS NOT NULL THEN RAISE EXCEPTION 'TRIAL_RELEASED: Select a new offer'; END IF;
  IF NOT t.admin_granted THEN
  PERFORM pg_advisory_xact_lock(hashtext(h || '::intro_identity'));
  IF EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h) THEN RAISE EXCEPTION 'TRIAL_USED: Introductory offer already used'; END IF;
  SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = a FOR UPDATE;
  IF (t.duration_days = 7 AND NOT c.seven_day_enabled) OR (t.duration_days = 30 AND NOT c.launch_enabled) THEN RAISE EXCEPTION 'TRIAL_PAUSED: Campaign is paused; post remains pending'; END IF;
  IF t.duration_days = 30 THEN
   SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = a AND duration_days = 30 AND NOT admin_granted
    AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
   IF n >= c.slot_limit THEN RAISE EXCEPTION 'TRIAL_FULL: No 30-day slot available; post remains pending'; END IF;
  END IF;
  END IF;
  NEW.expires_at := now() + make_interval(days => t.duration_days);
  IF TG_TABLE_NAME = 'promotions' AND event_end IS NOT NULL THEN NEW.expires_at := least(NEW.expires_at,event_end); END IF;
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  IF NOT t.admin_granted THEN INSERT INTO public.intro_trial_identities(identity_hmac) VALUES (h); END IF;
  UPDATE public.intro_trial_claims SET activated_at = now(), expires_at = NEW.expires_at WHERE id = t.id;
  INSERT INTO public.notifications(user_id,type,title,message,href)
   VALUES (NEW.owner_id,'success',CASE WHEN t.admin_granted THEN 'Your free post is active' ELSE 'Your introductory trial is active' END,
    'Your post is visible until ' || to_char(NEW.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST. Renew with a paid plan to keep it active.','/dashboard/listings');
 END IF;
 -- Trial posts cannot receive premium placement, even via another write path.
 NEW := jsonb_populate_record(NEW, jsonb_build_object('boost_until',NULL,'featured_until',NULL,'urgent_until',NULL,'featured',false,'urgent',false));
 IF TG_TABLE_NAME = 'promotions' AND event_end IS NOT NULL THEN
  NEW.expires_at := least(NEW.expires_at,event_end);
  UPDATE public.intro_trial_claims SET expires_at = NEW.expires_at WHERE id = t.id;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_intro_trial(p_actor_id uuid, p_action text, p_target text,
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
   IF NOT t.admin_granted THEN
   SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = t.area FOR UPDATE;
   SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = t.area AND duration_days = 30 AND NOT admin_granted AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
   IF n > c.slot_limit THEN RAISE EXCEPTION 'Pool exceeds the current limit'; END IF;
   END IF;
   UPDATE public.intro_trial_claims SET expires_at = new_expiry WHERE id = t.id;
   EXECUTE format('UPDATE public.%I SET expires_at = $1 WHERE id = $2 AND status = ''live''', t.content_table) USING new_expiry, t.content_id;
  ELSE RAISE EXCEPTION 'Unknown trial management action';
  END IF;
 END IF;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason,details) VALUES(p_actor_id,p_action,p_target,p_reason,p_values);
END;
$$;

CREATE OR REPLACE FUNCTION public.intro_trial_summary() RETURNS jsonb
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
  FROM public.intro_trial_campaigns c LEFT JOIN public.intro_trial_claims t ON t.area=c.area AND NOT t.admin_granted GROUP BY c.area
 ) s;
$$;

CREATE FUNCTION public.search_free_post_accounts(p_actor_id uuid, p_search text)
RETURNS TABLE(user_id uuid, display_name text, email text, remaining integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE term text := btrim(p_search);
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
  SELECT 1 FROM auth.users u WHERE u.id=p_actor_id AND u.raw_app_meta_data->>'role' IN ('admin','governance_controller')
 ) THEN RAISE EXCEPTION 'Free post management permission required' USING ERRCODE='42501'; END IF;
 IF term IS NULL OR length(term) NOT BETWEEN 1 AND 254 THEN RETURN; END IF;
 RETURN QUERY
 SELECT a.user_id, a.display_name::text, u.email::text, public.account_free_posts_remaining(a.user_id)
 FROM public.account_profiles a JOIN auth.users u ON u.id=a.user_id
 WHERE CASE
  WHEN strpos(term,'@') > 0 THEN lower(u.email)=lower(term)
  WHEN term ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN a.user_id=term::uuid
  ELSE strpos(lower(a.display_name),lower(term)) > 0
 END
 ORDER BY a.display_name, a.user_id LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.search_free_post_accounts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_free_post_accounts(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_own_intro_trial(p_user_id uuid, p_claim_id uuid, p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; e public.entitlements; n integer; cap integer; tier_features jsonb; content jsonb; photos integer; videos integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 SELECT * INTO STRICT t FROM public.intro_trial_claims WHERE id = p_claim_id AND user_id = p_user_id FOR UPDATE;
 IF p_action = 'choose_seven' THEN
  IF t.admin_granted THEN RAISE EXCEPTION 'Account grants keep their assigned duration'; END IF;
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

CREATE OR REPLACE FUNCTION public.notify_intro_trials() RETURNS integer
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
    CASE WHEN t.admin_granted THEN CASE WHEN milestone=0 THEN 'Your free post has ended' ELSE 'Your free post ends soon' END ELSE CASE WHEN milestone=0 THEN 'Your introductory trial has ended' ELSE 'Your introductory trial ends soon' END END,
    CASE WHEN milestone=0 THEN 'Your content is saved in your dashboard. Choose a paid plan and renew to make it visible again.' ELSE 'Your trial ends within ' || milestone || ' day(s). You will not be charged automatically.' END,'/dashboard');
   total := total + 1;
  END IF;
 END LOOP;
 RETURN total;
END;
$$;

COMMIT;
