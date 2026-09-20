-- Account-specific, admin-managed extra posts. Reservations and admin changes
-- share the existing account lock; usage remains in the audited trial ledger.
BEGIN;
ALTER TABLE public.intro_trial_claims ADD COLUMN admin_granted boolean NOT NULL DEFAULT false;
ALTER TABLE public.intro_trial_claims ADD CONSTRAINT admin_grant_duration CHECK (NOT admin_granted OR duration_days = 7);
DROP INDEX public.intro_trial_one_pending;
CREATE UNIQUE INDEX intro_trial_one_pending ON public.intro_trial_claims(user_id)
 WHERE activated_at IS NULL AND released_at IS NULL AND NOT admin_granted;
CREATE TABLE public.account_free_post_allowances (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 allowance integer NOT NULL DEFAULT 0 CHECK (allowance >= 0)
);
ALTER TABLE public.account_free_post_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_free_post_allowances FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.account_free_post_allowances TO service_role;

CREATE FUNCTION public.account_free_posts_used(p_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT count(*)::integer FROM public.intro_trial_claims
 WHERE user_id = p_user_id AND admin_granted AND (activated_at IS NOT NULL OR
  (released_at IS NULL AND (content_table IS NOT NULL OR created_at > now()-interval '15 minutes')));
$$;
CREATE FUNCTION public.account_free_posts_remaining(p_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT greatest(0, COALESCE((SELECT allowance FROM public.account_free_post_allowances WHERE user_id=p_user_id),0)
  - public.account_free_posts_used(p_user_id));
$$;
CREATE FUNCTION public.set_account_free_posts(p_actor_id uuid,p_user_id uuid,p_remaining integer,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE previous integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
  SELECT 1 FROM auth.users WHERE id=p_actor_id AND raw_app_meta_data->>'role' IN ('admin','governance_controller')
 ) THEN RAISE EXCEPTION 'Free post management permission required' USING ERRCODE='42501'; END IF;
 IF p_remaining IS NULL OR p_remaining NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Invalid free post count'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.account_profiles WHERE user_id=p_user_id) THEN RAISE EXCEPTION 'Account not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || '::intro_trial'));
 -- Expired reservations excluded from usage must not later publish after a reset.
 UPDATE public.intro_trial_claims SET released_at=now(), release_reason='abandoned_create'
 WHERE user_id=p_user_id AND admin_granted AND activated_at IS NULL AND released_at IS NULL
  AND content_table IS NULL AND created_at < now()-interval '15 minutes';
 previous := public.account_free_posts_remaining(p_user_id);
 INSERT INTO public.account_free_post_allowances(user_id,allowance)
 VALUES(p_user_id,public.account_free_posts_used(p_user_id)+p_remaining)
 ON CONFLICT(user_id) DO UPDATE SET allowance=EXCLUDED.allowance;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason,details)
 VALUES(p_actor_id,'set_account_free_posts',p_user_id::text,p_reason,jsonb_build_object('previousRemaining',previous,'remaining',p_remaining));
END;
$$;
REVOKE ALL ON FUNCTION public.account_free_posts_used(uuid), public.account_free_posts_remaining(uuid),
 public.set_account_free_posts(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_free_posts_used(uuid), public.account_free_posts_remaining(uuid),
 public.set_account_free_posts(uuid,uuid,integer,text) TO service_role;


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
 SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = p_area AND duration_days = 30
  AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
 RETURN jsonb_build_object('adminFreePostsRemaining',credits,'eligible',eligible OR credits > 0,'sevenDayAvailable',credits > 0 OR (eligible AND c.seven_day_enabled),
  'thirtyDayAvailable',credits = 0 AND eligible AND c.launch_enabled AND n < c.slot_limit,
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
 IF p_duration_days = 7 AND public.account_free_posts_remaining(p_user_id) > 0 THEN
  INSERT INTO public.intro_trial_claims(user_id,area,content_id,duration_days,admin_granted)
  VALUES (p_user_id,p_area,p_content_id,7,true);
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
   SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = a AND duration_days = 30
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

COMMIT;
