-- Partner referrals and commission, acquisition attribution, commercial
-- analytics and lifecycle notifications.
--   * Acquisition source is first-touch and never overwritten by later
--     organisation affiliation.
--   * Commission is created only from collected revenue (payments reaching
--     `complete`), never for free programmes, self-referrals or institutional
--     payments without manual approval; refunds/chargebacks reverse it.
BEGIN;

CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,16}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended')),
  commission_bps integer CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 5000),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.account_acquisition (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  acquisition_source text NOT NULL CHECK (acquisition_source IN
   ('DIRECT','ORGANIC','SOCIAL','PARTNER','ORGANISATION','STRATEGIC_INVITE','PAID_CAMPAIGN','ADMIN_CREATED')),
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  campaign_id text CHECK (campaign_id IS NULL OR length(campaign_id) <= 80),
  landing_path text CHECK (landing_path IS NULL OR length(landing_path) <= 300),
  referrer_host text CHECK (referrer_host IS NULL OR length(referrer_host) <= 200),
  utm jsonb NOT NULL DEFAULT '{}',
  first_touch_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_account_acquisition_partner ON public.account_acquisition(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX idx_account_acquisition_source ON public.account_acquisition(acquisition_source, recorded_at);

CREATE TABLE public.commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL,
  base_cents integer NOT NULL CHECK (base_cents >= 0),
  rate_bps integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','PAID','REVERSED')),
  requires_manual_approval boolean NOT NULL DEFAULT false,
  eligible_at timestamptz NOT NULL,
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  paid_reference text,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commissions_partner ON public.commissions(partner_id, status, created_at DESC);

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_acquisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners read own partner row" ON public.partners FOR SELECT USING (
  user_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Staff read acquisition" ON public.account_acquisition FOR SELECT USING (
  public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Partners read own commissions" ON public.commissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.user_id = (SELECT auth.uid()))
  OR public.has_any_role(ARRAY['admin','governance_controller']));

-- First touch wins. Self-referral attributes nothing.
CREATE FUNCTION public.record_account_acquisition(p_user uuid, p_values jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE p public.partners; o uuid; src text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM public.account_acquisition WHERE user_id = p_user) THEN
  RETURN (SELECT acquisition_source FROM public.account_acquisition WHERE user_id = p_user);
 END IF;
 SELECT * INTO p FROM public.partners WHERE code = upper(nullif(p_values->>'partnerCode','')) AND status = 'active';
 IF p.user_id = p_user THEN p := NULL; END IF;
 SELECT id INTO o FROM public.organisations WHERE slug = nullif(p_values->>'organisationSlug','');
 src := CASE
  WHEN p.id IS NOT NULL THEN 'PARTNER'
  WHEN o IS NOT NULL THEN 'ORGANISATION'
  WHEN p_values->>'source' IN ('DIRECT','ORGANIC','SOCIAL','PAID_CAMPAIGN','STRATEGIC_INVITE','ADMIN_CREATED') THEN p_values->>'source'
  ELSE 'DIRECT' END;
 INSERT INTO public.account_acquisition(user_id,acquisition_source,partner_id,organisation_id,campaign_id,landing_path,referrer_host,utm,first_touch_at)
 VALUES (p_user,src,p.id,o,left(nullif(p_values->>'campaignId',''),80),left(nullif(p_values->>'landingPath',''),300),
  left(nullif(p_values->>'referrerHost',''),200),COALESCE(p_values->'utm','{}'::jsonb),(p_values->>'firstTouchAt')::timestamptz)
 ON CONFLICT (user_id) DO NOTHING;
 RETURN src;
END;
$$;

CREATE FUNCTION public.payment_commission_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acq public.account_acquisition; p public.partners; meta jsonb; tier text; rate integer; manual boolean;
BEGIN
 IF NEW.status::text = OLD.status::text THEN RETURN NULL; END IF;
 IF NEW.status::text IN ('refunded','chargeback') THEN
  UPDATE public.commissions SET status = 'REVERSED', reversed_at = now(),
   reversal_reason = 'Payment ' || NEW.status::text WHERE payment_id = NEW.id AND status <> 'REVERSED';
  INSERT INTO public.notifications(user_id,type,title,message,href)
  SELECT pa.user_id,'warning','Commission reversed','A referred payment was ' || NEW.status::text || ', so its commission was reversed.','/dashboard/partner'
  FROM public.commissions c JOIN public.partners pa ON pa.id = c.partner_id WHERE c.payment_id = NEW.id;
  RETURN NULL;
 END IF;
 IF NEW.status::text <> 'complete' OR NEW.amount_cents <= 0 THEN RETURN NULL; END IF;
 IF NOT COALESCE((SELECT (value->>'enabled')::boolean FROM public.commercial_settings WHERE key = 'partner'), true) THEN RETURN NULL; END IF;
 SELECT * INTO acq FROM public.account_acquisition WHERE user_id = NEW.user_id;
 IF acq.partner_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.partners WHERE id = acq.partner_id;
 IF p.id IS NULL OR p.status <> 'active' OR p.user_id = NEW.user_id THEN RETURN NULL; END IF;
 meta := COALESCE(NEW.provider_data->'metadata', NEW.provider_data, '{}'::jsonb);
 tier := meta->>'plan_tier';
 -- Institutional and legacy plan revenue is never auto-commissioned.
 manual := meta->>'type' = 'subscription' AND COALESCE(tier,'') NOT IN ('month','half_year','year');
 rate := COALESCE(p.commission_bps, public.commercial_setting_int('partner','commissionBps',2000));
 INSERT INTO public.commissions(partner_id,payment_id,referred_user_id,base_cents,rate_bps,amount_cents,requires_manual_approval,eligible_at)
 VALUES (p.id,NEW.id,NEW.user_id,NEW.amount_cents,rate,floor(NEW.amount_cents::numeric * rate / 10000)::integer,manual,
  now() + make_interval(days => public.commercial_setting_int('partner','pendingDays',30)))
 ON CONFLICT (payment_id) DO NOTHING;
 RETURN NULL;
END;
$$;
CREATE TRIGGER payments_commission AFTER UPDATE OF status ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.payment_commission_trigger();

CREATE FUNCTION public.approve_due_commissions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 WITH due AS (
  UPDATE public.commissions c SET status = 'APPROVED', approved_at = now()
  FROM public.payments pay
  WHERE pay.id = c.payment_id AND pay.status::text = 'complete' AND c.status = 'PENDING'
   AND NOT c.requires_manual_approval AND c.eligible_at <= now()
  RETURNING c.partner_id, c.amount_cents)
 INSERT INTO public.notifications(user_id,type,title,message,href)
 SELECT pa.user_id,'success','Commission approved','R' || to_char(d.amount_cents / 100.0,'FM999999990.00') || ' commission has been approved.','/dashboard/partner'
 FROM due d JOIN public.partners pa ON pa.id = d.partner_id;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END;
$$;

CREATE FUNCTION public.admin_manage_partner(p_actor uuid, p_user uuid, p_action text, p_values jsonb, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.partners; nxt public.partners;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Partner management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO prev FROM public.partners WHERE user_id = p_user FOR UPDATE;
 IF p_action = 'create' THEN
  IF prev.id IS NOT NULL THEN RAISE EXCEPTION 'User is already a partner'; END IF;
  INSERT INTO public.partners(user_id,code,commission_bps,notes,created_by)
  VALUES (p_user,upper(p_values->>'code'),(p_values->>'commissionBps')::integer,p_values->>'notes',p_actor) RETURNING * INTO nxt;
 ELSIF p_action IN ('suspend','activate') THEN
  UPDATE public.partners SET status = CASE p_action WHEN 'suspend' THEN 'suspended' ELSE 'active' END, updated_at = now()
  WHERE user_id = p_user RETURNING * INTO nxt;
 ELSIF p_action = 'rate' THEN
  UPDATE public.partners SET commission_bps = (p_values->>'commissionBps')::integer, updated_at = now() WHERE user_id = p_user RETURNING * INTO nxt;
 ELSE RAISE EXCEPTION 'Unknown partner action';
 END IF;
 IF nxt.id IS NULL THEN RAISE EXCEPTION 'Partner not found'; END IF;
 PERFORM public.commercial_audit(p_actor,'partner_' || p_action,'partner',nxt.id,to_jsonb(prev),to_jsonb(nxt),p_reason);
 RETURN nxt.id;
END;
$$;

CREATE FUNCTION public.admin_manage_commission(p_actor uuid, p_commission uuid, p_action text, p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.commissions; nxt public.commissions;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Partner management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.commissions WHERE id = p_commission FOR UPDATE;
 IF p_action = 'approve' THEN
  IF prev.status <> 'PENDING' THEN RAISE EXCEPTION 'Only pending commissions can be approved'; END IF;
  IF (SELECT status::text FROM public.payments WHERE id = prev.payment_id) <> 'complete' THEN RAISE EXCEPTION 'Payment is no longer collected'; END IF;
  UPDATE public.commissions SET status = 'APPROVED', approved_at = now(), approved_by = p_actor,
   amount_cents = COALESCE((p_values->>'amountCents')::integer, amount_cents) WHERE id = p_commission;
 ELSIF p_action = 'mark_paid' THEN
  IF prev.status <> 'APPROVED' THEN RAISE EXCEPTION 'Only approved commissions can be paid'; END IF;
  UPDATE public.commissions SET status = 'PAID', paid_at = now(), paid_reference = p_values->>'reference' WHERE id = p_commission;
 ELSIF p_action = 'reverse' THEN
  UPDATE public.commissions SET status = 'REVERSED', reversed_at = now(), reversal_reason = p_reason WHERE id = p_commission;
 ELSE RAISE EXCEPTION 'Unknown commission action';
 END IF;
 SELECT * INTO nxt FROM public.commissions WHERE id = p_commission;
 PERFORM public.commercial_audit(p_actor,'commission_' || p_action,'commission',p_commission,to_jsonb(prev),to_jsonb(nxt),p_reason);
END;
$$;

CREATE FUNCTION public.partner_dashboard(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
  'code', p.code, 'status', p.status,
  'rateBps', COALESCE(p.commission_bps, public.commercial_setting_int('partner','commissionBps',2000)),
  'referrals', (SELECT count(*) FROM public.account_acquisition a WHERE a.partner_id = p.id),
  'payingReferrals', (SELECT count(DISTINCT referred_user_id) FROM public.commissions c WHERE c.partner_id = p.id AND c.status <> 'REVERSED'),
  'totals', (SELECT COALESCE(jsonb_object_agg(status, total),'{}'::jsonb) FROM (SELECT status, sum(amount_cents) total FROM public.commissions WHERE partner_id = p.id GROUP BY status) t),
  'recent', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'amountCents',c.amount_cents,'baseCents',c.base_cents,'status',c.status,
     'createdAt',c.created_at,'eligibleAt',c.eligible_at,'manual',c.requires_manual_approval) ORDER BY c.created_at DESC),'[]'::jsonb)
    FROM (SELECT * FROM public.commissions WHERE partner_id = p.id ORDER BY created_at DESC LIMIT 50) c))
 END
 FROM (SELECT 1) one LEFT JOIN public.partners p ON p.user_id = p_user;
$$;

-- ── Analytics ────────────────────────────────────────────────────────────
CREATE TABLE public.analytics_events (
  id bigserial PRIMARY KEY,
  content_table text NOT NULL CHECK (content_table IN ('listings','businesses','promotions','organisations')),
  content_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','detail_view','whatsapp_click','phone_click','website_click',
   'share','save','search_appearance','homepage_appearance','showroom_appearance','organisation_directory_appearance')),
  surface text CHECK (surface IS NULL OR length(surface) <= 40),
  viewer_key text CHECK (viewer_key IS NULL OR length(viewer_key) <= 128),
  traffic_source text CHECK (traffic_source IS NULL OR length(traffic_source) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_events_content ON public.analytics_events(content_id, created_at);
CREATE INDEX idx_analytics_events_created ON public.analytics_events(created_at);

CREATE TABLE public.analytics_daily (
  day date NOT NULL,
  content_table text NOT NULL,
  content_id uuid NOT NULL,
  event_type text NOT NULL,
  events integer NOT NULL,
  unique_viewers integer NOT NULL,
  PRIMARY KEY (day, content_table, content_id, event_type)
);
CREATE INDEX idx_analytics_daily_content ON public.analytics_daily(content_id, day);
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.record_analytics_events(p_events jsonb, p_viewer_key text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 50 THEN RAISE EXCEPTION 'Invalid analytics batch'; END IF;
 INSERT INTO public.analytics_events(content_table,content_id,event_type,surface,viewer_key,traffic_source)
 SELECT DISTINCT e->>'table', (e->>'id')::uuid, e->>'type', left(e->>'surface',40), left(p_viewer_key,128), left(e->>'source',40)
 FROM jsonb_array_elements(p_events) e
 WHERE e->>'table' IN ('listings','businesses','promotions','organisations')
  AND e->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  -- One impression-type event per viewer, item and surface per hour.
  AND NOT (e->>'type' IN ('impression','search_appearance','homepage_appearance','showroom_appearance','organisation_directory_appearance','detail_view')
   AND EXISTS (SELECT 1 FROM public.analytics_events x WHERE x.content_id = (e->>'id')::uuid AND x.event_type = e->>'type'
    AND x.viewer_key = p_viewer_key AND x.surface IS NOT DISTINCT FROM left(e->>'surface',40) AND x.created_at > now() - interval '1 hour'));
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END;
$$;

CREATE FUNCTION public.rollup_analytics_daily() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 INSERT INTO public.analytics_daily(day,content_table,content_id,event_type,events,unique_viewers)
 SELECT (created_at AT TIME ZONE 'Africa/Johannesburg')::date, content_table, content_id, event_type, count(*), count(DISTINCT viewer_key)
 FROM public.analytics_events
 WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' - interval '2 days'
 GROUP BY 1,2,3,4
 ON CONFLICT (day,content_table,content_id,event_type) DO UPDATE SET events = EXCLUDED.events, unique_viewers = EXCLUDED.unique_viewers;
 GET DIAGNOSTICS n = ROW_COUNT;
 DELETE FROM public.analytics_events WHERE created_at < now() - interval '90 days';
 RETURN n;
END;
$$;

-- Live + rolled-up counts for one owner's content (owner dashboards).
CREATE FUNCTION public.content_analytics_summary(p_user uuid, p_days integer DEFAULT 30)
RETURNS TABLE(content_table text, content_id uuid, event_type text, events bigint, unique_viewers bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH owned AS (
  SELECT 'listings'::text t, id FROM public.listings WHERE owner_id = p_user
  UNION ALL SELECT 'businesses', id FROM public.businesses WHERE owner_id = p_user
  UNION ALL SELECT 'promotions', id FROM public.promotions WHERE owner_id = p_user)
 SELECT e.content_table, e.content_id, e.event_type, count(*), count(DISTINCT e.viewer_key)
 FROM public.analytics_events e JOIN owned o ON o.id = e.content_id AND o.t = e.content_table
 WHERE e.created_at > now() - make_interval(days => least(greatest(p_days,1),90))
 GROUP BY 1,2,3;
$$;

-- Organisation Partnership Performance Report: aggregates only, never viewer
-- identities. Covers affiliated businesses and their owners' other content.
CREATE FUNCTION public.organisation_performance_report(p_user uuid, p_org uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 WITH members AS (
  SELECT DISTINCT b.id, b.owner_id, b.status::text AS status, b.category::text AS category, b.location_city::text AS city
  FROM public.organisation_affiliations f JOIN public.businesses b ON b.id = f.business_id
  WHERE f.organisation_id = p_org AND f.confirmed_at <= p_to AND (f.status = 'active' OR f.revoked_at >= p_from)),
 content AS (
  SELECT 'businesses'::text t, id, owner_id FROM members
  UNION ALL SELECT 'listings', l.id, l.owner_id FROM public.listings l WHERE l.owner_id IN (SELECT owner_id FROM members)
  UNION ALL SELECT 'promotions', p.id, p.owner_id FROM public.promotions p WHERE p.owner_id IN (SELECT owner_id FROM members)),
 ev AS (
  SELECT e.event_type, e.created_at, e.content_id FROM public.analytics_events e JOIN content c ON c.id = e.content_id AND c.t = e.content_table
  WHERE e.created_at BETWEEN p_from AND p_to)
 SELECT jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'participatingBusinesses', (SELECT count(*) FROM members),
  'activeBusinesses', (SELECT count(*) FROM members WHERE status = 'live'),
  'sponsoredBusinesses', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active'),
  'totalListings', (SELECT count(*) FROM content WHERE t <> 'businesses'),
  'events', (SELECT COALESCE(jsonb_object_agg(event_type, n),'{}'::jsonb) FROM (SELECT event_type, count(*) n FROM ev GROUP BY 1) x),
  'profileViews', (SELECT count(*) FROM ev JOIN members m ON m.id = ev.content_id WHERE ev.event_type = 'detail_view'),
  'topCategories', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category',category,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT category, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'topLocations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city',city,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT city, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'weeklyTrend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week',wk,'views',v,'contacts',c) ORDER BY wk),'[]'::jsonb)
    FROM (SELECT date_trunc('week',created_at)::date wk,
      count(*) FILTER (WHERE event_type IN ('impression','detail_view')) v,
      count(*) FILTER (WHERE event_type IN ('whatsapp_click','phone_click','website_click')) c
     FROM ev GROUP BY 1) x))
 INTO result;
 RETURN result;
END;
$$;

-- ── Lifecycle notifications (plans, sponsorship, capacity) ───────────────
CREATE TABLE public.commercial_notices (
  subject_id uuid NOT NULL,
  milestone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, milestone)
);
ALTER TABLE public.commercial_notices ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.notify_commercial_lifecycle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE e record; m text; inserted integer; total integer := 0;
BEGIN
 FOR e IN SELECT s.*, (SELECT count(*) FROM public.slot_assignments a WHERE a.entitlement_id = s.id AND a.released_at IS NULL) AS used
  FROM public.slot_entitlements s WHERE s.user_id IS NOT NULL AND s.expires_at > now() - interval '2 days' LOOP
  m := CASE
   WHEN e.expires_at <= now() THEN 'expired'
   WHEN e.expires_at <= now() + interval '1 day' THEN 'expiring_1'
   WHEN e.expires_at <= now() + interval '7 days' AND e.expires_at - e.starts_at > interval '20 days' THEN 'expiring_7'
   ELSE NULL END;
  IF m IS NOT NULL THEN
   INSERT INTO public.commercial_notices(subject_id,milestone) VALUES (e.id,m) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted = ROW_COUNT;
   IF inserted = 1 THEN
    INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (e.user_id,
     CASE WHEN m = 'expired' THEN 'warning' ELSE 'info' END,
     CASE WHEN e.source = 'SPONSORED_ORGANISATION_MEMBER' THEN CASE WHEN m = 'expired' THEN 'Sponsored visibility has ended' ELSE 'Sponsored visibility ends soon' END
      WHEN e.source IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER') THEN CASE WHEN m = 'expired' THEN 'Your programme has ended' ELSE 'Your programme ends soon' END
      ELSE CASE WHEN m = 'expired' THEN 'Your plan has expired' ELSE 'Your plan expires soon' END END,
     CASE WHEN m = 'expired' THEN 'Your posts are saved in your dashboard. Reactivate from R50 / 30 days, R250 / 6 months or R450 / year.'
      ELSE 'Nothing renews automatically. Extend from R50 / 30 days to keep your posts visible.' END,'/dashboard/listings');
    total := total + 1;
   END IF;
  END IF;
  IF e.expires_at > now() AND e.used >= e.slot_capacity AND e.slot_capacity > 0 THEN
   INSERT INTO public.commercial_notices(subject_id,milestone) VALUES (e.id,'capacity_' || e.slot_capacity) ON CONFLICT DO NOTHING;
   GET DIAGNOSTICS inserted = ROW_COUNT;
   IF inserted = 1 THEN
    INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (e.user_id,'info','All posting slots are in use',
     'Mark a sold item, deactivate a post, or add a slot to publish more.','/dashboard/listings');
    total := total + 1;
   END IF;
  END IF;
 END LOOP;
 RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.record_account_acquisition(uuid,jsonb), public.approve_due_commissions(),
 public.admin_manage_partner(uuid,uuid,text,jsonb,text), public.admin_manage_commission(uuid,uuid,text,jsonb,text),
 public.partner_dashboard(uuid), public.record_analytics_events(jsonb,text), public.rollup_analytics_daily(),
 public.content_analytics_summary(uuid,integer), public.organisation_performance_report(uuid,uuid,timestamptz,timestamptz),
 public.notify_commercial_lifecycle(), public.payment_commission_trigger()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_account_acquisition(uuid,jsonb), public.approve_due_commissions(),
 public.admin_manage_partner(uuid,uuid,text,jsonb,text), public.admin_manage_commission(uuid,uuid,text,jsonb,text),
 public.partner_dashboard(uuid), public.record_analytics_events(jsonb,text), public.rollup_analytics_daily(),
 public.content_analytics_summary(uuid,integer), public.organisation_performance_report(uuid,uuid,timestamptz,timestamptz),
 public.notify_commercial_lifecycle()
TO service_role;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('approve-due-commissions','5 2 * * *','SELECT public.approve_due_commissions()');
  PERFORM cron.schedule('rollup-analytics-daily','40 * * * *','SELECT public.rollup_analytics_daily()');
  PERFORM cron.schedule('notify-commercial-lifecycle','25 * * * *','SELECT public.notify_commercial_lifecycle()');
 END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
