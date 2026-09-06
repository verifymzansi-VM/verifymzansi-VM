-- One introductory offer across all three posting areas. Only service workflows
-- can reserve/activate; the publishing trigger holds the pool lock until commit.
BEGIN;

CREATE TABLE public.intro_trial_campaigns (
  area public.marketplace_area PRIMARY KEY,
  slot_limit integer NOT NULL DEFAULT 50 CHECK (slot_limit BETWEEN 0 AND 500),
  launch_enabled boolean NOT NULL DEFAULT true,
  seven_day_enabled boolean NOT NULL DEFAULT true
);
INSERT INTO public.intro_trial_campaigns(area) VALUES
 ('MZANSI_MARKET'), ('MZANSI_BUSINESS'), ('PROMOTIONS_EVENTS');

CREATE TABLE public.intro_trial_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  area public.marketplace_area NOT NULL REFERENCES public.intro_trial_campaigns(area),
  content_id uuid NOT NULL UNIQUE,
  content_table text CHECK (content_table IN ('listings','businesses','promotions')),
  duration_days integer NOT NULL CHECK (duration_days IN (7,30)),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  converted_at timestamptz
);
CREATE INDEX intro_trial_user ON public.intro_trial_claims(user_id);
CREATE INDEX intro_trial_capacity ON public.intro_trial_claims(area, expires_at)
 WHERE duration_days = 30 AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL;
CREATE UNIQUE INDEX intro_trial_one_pending ON public.intro_trial_claims(user_id)
 WHERE activated_at IS NULL AND released_at IS NULL;

-- Deliberately no cascading identity FK: deleting an account must not reset
-- a redeemed promotion. Contains an existing keyed HMAC, never an ID number.
CREATE TABLE public.intro_trial_identities (
  identity_hmac text PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.intro_trial_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.intro_trial_notices (
  claim_id uuid REFERENCES public.intro_trial_claims(id) ON DELETE CASCADE,
  milestone integer NOT NULL,
  PRIMARY KEY (claim_id, milestone)
);

ALTER TABLE public.intro_trial_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intro_trial_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intro_trial_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intro_trial_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intro_trial_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intro_trial_campaigns, public.intro_trial_claims,
 public.intro_trial_identities, public.intro_trial_audit, public.intro_trial_notices FROM anon, authenticated;
GRANT ALL ON public.intro_trial_campaigns, public.intro_trial_claims,
 public.intro_trial_identities, public.intro_trial_audit, public.intro_trial_notices TO service_role;
GRANT SELECT ON public.intro_trial_claims TO authenticated;
CREATE POLICY intro_trial_owner_read ON public.intro_trial_claims FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));

-- Existing successful free posts count as the introductory benefit. Preserve
-- existing visibility, including pending legacy posts, without granting more.
INSERT INTO public.intro_trial_identities(identity_hmac)
SELECT DISTINCT v.id_number_hmac FROM public.verification_steps v
JOIN public.free_posts_used f ON f.user_id = v.user_id
WHERE v.step_type = 'id_doc' AND v.status = 'approved' AND v.id_number_hmac IS NOT NULL
 AND COALESCE(f.release_reason, '') NOT IN ('create_failed', 'rejected_deleted')
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.intro_trial_identity(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT v.id_number_hmac FROM public.verification_steps v
 JOIN public.account_profiles a ON a.user_id = v.user_id
 WHERE v.user_id = p_user_id AND v.step_type = 'id_doc' AND v.status = 'approved'
 AND v.id_number_hmac IS NOT NULL AND a.account_verification_status = 'verified'
 AND a.account_status IN ('active','warned') AND a.phone IS NOT NULL
 AND (SELECT count(DISTINCT s.step_type) FROM public.verification_steps s
      WHERE s.user_id = p_user_id AND s.status = 'approved'
      AND s.step_type IN ('phone','id_doc','selfie','location')) = 4
 LIMIT 1;
$$;

CREATE FUNCTION public.intro_trial_offer(p_area public.marketplace_area) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE u uuid := auth.uid(); h text; eligible boolean; c public.intro_trial_campaigns; n integer;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
 SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = p_area;
 h := public.intro_trial_identity(u);
 eligible := h IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h)
  AND NOT EXISTS (SELECT 1 FROM public.intro_trial_claims WHERE user_id = u AND (activated_at IS NOT NULL OR (released_at IS NULL AND (content_table IS NOT NULL OR created_at > now()-interval '15 minutes'))))
  AND NOT EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = u AND COALESCE(release_reason, '') NOT IN ('create_failed','rejected_deleted'));
 SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = p_area AND duration_days = 30
  AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
 RETURN jsonb_build_object('eligible',eligible,'sevenDayAvailable',eligible AND c.seven_day_enabled,
  'thirtyDayAvailable',eligible AND c.launch_enabled AND n < c.slot_limit,
  'remaining',greatest(0,c.slot_limit-n),'launchEnabled',c.launch_enabled);
END;
$$;

CREATE FUNCTION public.reserve_intro_trial(p_user_id uuid, p_area public.marketplace_area,
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
 IF (p_duration_days = 7 AND NOT c.seven_day_enabled) OR (p_duration_days = 30 AND NOT c.launch_enabled) THEN RETURN false; END IF;
 -- Repair a crashed create without releasing a real pending moderation post.
 UPDATE public.intro_trial_claims t SET released_at = now(), release_reason = 'abandoned_create'
 WHERE t.user_id = p_user_id AND activated_at IS NULL AND released_at IS NULL
 AND created_at < now() - interval '15 minutes' AND content_table IS NULL;
 IF EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h)
 OR EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = p_user_id AND COALESCE(release_reason, '') NOT IN ('create_failed','rejected_deleted'))
 OR EXISTS (SELECT 1 FROM public.intro_trial_claims WHERE user_id = p_user_id AND (activated_at IS NOT NULL OR released_at IS NULL)) THEN RETURN false; END IF;
 INSERT INTO public.intro_trial_claims(user_id,area,content_id,duration_days)
 VALUES (p_user_id,p_area,p_content_id,p_duration_days);
 RETURN true;
END;
$$;

CREATE FUNCTION public.release_intro_trial(p_user_id uuid, p_area public.marketplace_area,
 p_content_id uuid, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 UPDATE public.intro_trial_claims SET released_at = now(), release_reason = p_reason
 WHERE user_id = p_user_id AND area = p_area AND content_id = p_content_id
 AND activated_at IS NULL AND released_at IS NULL;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n > 0;
END;
$$;

-- Disable the old reservation entry point: a stale application cannot issue a
-- second free benefit through the old per-area ledger during a rolling release.
CREATE OR REPLACE FUNCTION public.claim_free_post_slot(p_user_id uuid, p_area public.marketplace_area,
 p_content_id uuid, p_max_allowed integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'Trial policy updated. Refresh the posting page.'; END;
$$;
REVOKE INSERT, UPDATE, DELETE ON public.free_posts_used FROM authenticated, anon;

CREATE FUNCTION public.enforce_intro_trial_publication() RETURNS trigger
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
  PERFORM pg_advisory_xact_lock(hashtext(h || '::intro_identity'));
  IF EXISTS (SELECT 1 FROM public.intro_trial_identities WHERE identity_hmac = h) THEN RAISE EXCEPTION 'TRIAL_USED: Introductory offer already used'; END IF;
  SELECT * INTO STRICT c FROM public.intro_trial_campaigns WHERE area = a FOR UPDATE;
  IF (t.duration_days = 7 AND NOT c.seven_day_enabled) OR (t.duration_days = 30 AND NOT c.launch_enabled) THEN RAISE EXCEPTION 'TRIAL_PAUSED: Campaign is paused; post remains pending'; END IF;
  IF t.duration_days = 30 THEN
   SELECT count(*) INTO n FROM public.intro_trial_claims WHERE area = a AND duration_days = 30
    AND activated_at IS NOT NULL AND released_at IS NULL AND converted_at IS NULL AND expires_at > now();
   IF n >= c.slot_limit THEN RAISE EXCEPTION 'TRIAL_FULL: No 30-day slot available; post remains pending'; END IF;
  END IF;
  NEW.expires_at := now() + make_interval(days => t.duration_days);
  IF TG_TABLE_NAME = 'promotions' AND event_end IS NOT NULL THEN NEW.expires_at := least(NEW.expires_at,event_end); END IF;
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  INSERT INTO public.intro_trial_identities(identity_hmac) VALUES (h);
  UPDATE public.intro_trial_claims SET activated_at = now(), expires_at = NEW.expires_at WHERE id = t.id;
  INSERT INTO public.notifications(user_id,type,title,message,href)
   VALUES (NEW.owner_id,'success','Your introductory trial is active',
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
CREATE TRIGGER intro_trial_publication BEFORE INSERT OR UPDATE OR DELETE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.enforce_intro_trial_publication();
CREATE TRIGGER intro_trial_publication BEFORE INSERT OR UPDATE OR DELETE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.enforce_intro_trial_publication();
CREATE TRIGGER intro_trial_publication BEFORE INSERT OR UPDATE OR DELETE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.enforce_intro_trial_publication();

-- Owner RLS must not permit extending paid/legacy expiry, moving a funded post
-- into another area, or publishing via a direct PostgREST insert.
CREATE FUNCTION public.guard_post_funding_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE field text;
BEGIN
 IF auth.role() IS NULL OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.status = 'live' THEN RAISE EXCEPTION 'Publication requires moderation' USING ERRCODE='42501'; END IF;
 ELSE
  IF NEW.status = 'live' AND OLD.status <> 'live' THEN
   RAISE EXCEPTION 'Publication requires moderation' USING ERRCODE='42501';
  END IF;
  FOREACH field IN ARRAY ARRAY['owner_id','area','created_at','published_at','expires_at','featured','urgent'] LOOP
   IF to_jsonb(NEW)->field IS DISTINCT FROM to_jsonb(OLD)->field THEN
    RAISE EXCEPTION 'Funding fields require a system workflow' USING ERRCODE='42501';
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER aa_guard_post_funding BEFORE INSERT OR UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.guard_post_funding_fields();
CREATE TRIGGER aa_guard_post_funding BEFORE INSERT OR UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.guard_post_funding_fields();
CREATE TRIGGER aa_guard_post_funding BEFORE INSERT OR UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.guard_post_funding_fields();
REVOKE ALL ON FUNCTION public.guard_post_funding_fields() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_post_funding_fields() TO service_role;

REVOKE ALL ON FUNCTION public.intro_trial_identity(uuid), public.intro_trial_offer(public.marketplace_area),
 public.reserve_intro_trial(uuid,public.marketplace_area,uuid,integer),
 public.release_intro_trial(uuid,public.marketplace_area,uuid,text), public.enforce_intro_trial_publication() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intro_trial_offer(public.marketplace_area) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intro_trial_identity(uuid), public.reserve_intro_trial(uuid,public.marketplace_area,uuid,integer),
 public.release_intro_trial(uuid,public.marketplace_area,uuid,text), public.enforce_intro_trial_publication() TO service_role;
COMMIT;
