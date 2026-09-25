-- Commercial model foundation (founding network strategy).
--   * audit_logs: text actor_role (governance_controller/owner were not in
--     user_role) and previous/new/reason columns for commercial changes.
--   * commercial_settings: admin-editable commercial numbers.
--   * plans: retail R50/R250/R450 + bulk enterprise plans; old tiers → legacy.
--   * Active posting slots: slot_entitlements + slot_assignments. Capacity is
--     reusable; activations are counted. `entitlements` is kept as a per-area
--     summary so existing readers keep working.
--   * Publication trigger: paid visibility now activates a slot; events are
--     free and fair-use limited; trial durations come from settings.
--   * Trial ledger records which programme consumed an identity (no stacking).
--   * Programme contracts (strategic / founding commercial / enterprise).
--   * Refund / chargeback reversal.
BEGIN;

-- ── Audit log ────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ALTER COLUMN actor_role TYPE text USING actor_role::text;
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS previous_value jsonb,
  ADD COLUMN IF NOT EXISTS new_value jsonb,
  ADD COLUMN IF NOT EXISTS reason text;
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

CREATE FUNCTION public.is_commercial_admin(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor
  AND raw_app_meta_data->>'role' IN ('admin','governance_controller'));
$$;

CREATE FUNCTION public.commercial_audit(p_actor uuid, p_action text, p_target_type text, p_target_id uuid,
 p_previous jsonb, p_new jsonb, p_reason text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 INSERT INTO public.audit_logs(actor_id,actor_role,action,target_type,target_id,metadata,previous_value,new_value,reason)
 VALUES (COALESCE(p_actor,'00000000-0000-0000-0000-000000000000'),
  COALESCE((SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = p_actor),'system'),
  p_action,p_target_type,COALESCE(p_target_id,'00000000-0000-0000-0000-000000000000'),
  COALESCE(p_metadata,'{}'::jsonb),p_previous,p_new,p_reason);
END;
$$;

-- ── Commercial settings ──────────────────────────────────────────────────
CREATE TABLE public.commercial_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb NOT NULL,
  description text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commercial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public reads commercial settings" ON public.commercial_settings FOR SELECT USING (true);

INSERT INTO public.commercial_settings(key,value,description) VALUES
 ('trials','{"shortDays":7,"longDays":30}','Public introductory trial durations. Capacity and toggles live in intro_trial_campaigns.'),
 ('strategic','{"durationDays":90,"slotCapacity":1,"activationLimitTotal":3}','Invitation-only Strategic Individual trial defaults.'),
 ('founding_commercial','{"durationDays":180,"slotCapacity":25,"activationsPerPeriod":50,"periodDays":30,"adminLimit":2}','Founding Commercial Partner (dealership) defaults.'),
 ('founding_organisation','{"durationDays":180,"sponsoredCapacity":50,"adminLimit":3,"alertDays":[60,30,14,7]}','Founding Organisation Programme defaults.'),
 ('retail','{"activationsPerPeriod":10,"periodDays":30,"labels":{"month":"Flexible","half_year":"Most popular","year":"Best value"}}','Retail slot fair use and promotional labels.'),
 ('partner','{"commissionBps":2000,"pendingDays":30,"enabled":true}','Partner / agent commission (basis points of collected revenue).'),
 ('media','{"maxPhotos":10,"maxImageMb":5,"maxVideos":1,"maxVideoMb":50,"storageQuotaMb":500}','Default media fair-use limits for paid and programme posts.'),
 ('events','{"maxActivePerAccount":5,"maxCreatedPer30Days":10,"defaultVisibilityDays":30,"archiveAfterDays":30,"maxPhotos":10,"maxVideos":1}','Free event fair-use limits.'),
 ('showroom','{"programmeMinItems":3,"programmeMaxCards":12}','Programme showroom defaults.'),
 ('features','{"enterpriseCheckout":true,"organisationsPublic":true,"partnerProgramme":true,"qualityScore":true}','Commercial feature toggles.')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION public.commercial_setting_int(p_key text, p_path text, p_default integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE((SELECT (value #>> string_to_array(p_path,'.'))::integer
  FROM public.commercial_settings WHERE key = p_key), p_default);
$$;

CREATE FUNCTION public.update_commercial_setting(p_actor uuid, p_key text, p_value jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Commercial settings permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF jsonb_typeof(p_value) <> 'object' THEN RAISE EXCEPTION 'Setting value must be an object'; END IF;
 SELECT value INTO prev FROM public.commercial_settings WHERE key = p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown commercial setting'; END IF;
 UPDATE public.commercial_settings SET value = p_value, updated_by = p_actor, updated_at = now() WHERE key = p_key;
 PERFORM public.commercial_audit(p_actor,'commercial_setting_updated','commercial_setting',md5(p_key)::uuid,prev,p_value,p_reason,jsonb_build_object('key',p_key));
 RETURN p_value;
END;
$$;

-- ── Plans ────────────────────────────────────────────────────────────────
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS slot_capacity integer,
  ADD COLUMN IF NOT EXISTS monthly_activation_limit integer,
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS promo_label text,
  ADD COLUMN IF NOT EXISTS compare_at_cents integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE public.plans ALTER COLUMN area DROP NOT NULL;
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_area_tier_key;
CREATE UNIQUE INDEX IF NOT EXISTS plans_area_tier_single_key ON public.plans (area, tier) WHERE tier <> 'enterprise';
CREATE UNIQUE INDEX IF NOT EXISTS plans_area_plan_code_key ON public.plans (area, plan_code) WHERE plan_code IS NOT NULL AND area IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_any_area_plan_code_key ON public.plans (plan_code) WHERE plan_code IS NOT NULL AND area IS NULL;
ALTER TABLE public.plans ADD CONSTRAINT plans_duration_check CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 1100);
ALTER TABLE public.plans ADD CONSTRAINT plans_slot_capacity_check CHECK (slot_capacity IS NULL OR slot_capacity BETWEEN 1 AND 100000);

UPDATE public.plans SET active = false, is_legacy = true, public = false, retired_at = COALESCE(retired_at, now())
WHERE tier::text IN ('basic','starter','growth','pro');

INSERT INTO public.plans(area,tier,name,price_cents,billing_frequency,features,active,plan_code,duration_days,slot_capacity,
  monthly_activation_limit,promo_label,compare_at_cents,sort_order)
SELECT a.area, d.tier, a.label || ' — ' || d.name, d.price, 'fixed_term',
  jsonb_build_object('maxListings',1,'maxBusinesses',1,'maxPromotions',1,'maxPhotos',10,'maxVideos',1,'maxPostsPerMonth',10,
   'videoAllowed',true,'boostAllowed',true,'featuredAllowed',true,'urgentAllowed',true),
  true, d.code, d.days, 1, 10, d.label, d.compare, d.sort
FROM (VALUES ('MZANSI_MARKET'::public.marketplace_area,'Mzansi Market'),('MZANSI_BUSINESS','Mzansi Business'),('PROMOTIONS_EVENTS','Tourism')) a(area,label)
CROSS JOIN (VALUES
 ('month'::public.plan_tier,'30 Days',5000,'RETAIL_30D',30,'Flexible',NULL::integer,10),
 ('half_year','6 Months',25000,'RETAIL_6M',180,'Most popular',30000,20),
 ('year','12 Months',45000,'RETAIL_12M',365,'Best value',60000,30)
) d(tier,name,price,code,days,label,compare,sort)
ON CONFLICT DO NOTHING;

INSERT INTO public.plans(area,tier,name,price_cents,billing_frequency,features,active,plan_code,duration_days,slot_capacity,
  monthly_activation_limit,public,sort_order)
SELECT NULL, 'enterprise', s.slots || ' Active Slots — ' || d.label, s.prices[d.i], 'fixed_term',
  jsonb_build_object('maxPhotos',10,'maxVideos',1,'videoAllowed',true,'boostAllowed',true,'featuredAllowed',true,'urgentAllowed',true),
  true, 'ENT_' || s.slots || '_' || d.suffix, d.days, s.slots, s.activations, true, 200 + s.slots + d.i
FROM (VALUES
 (50, 100, ARRAY[500000,900000,1600000]),
 (100, 200, ARRAY[900000,1600000,2800000]),
 (250, 500, ARRAY[2000000,3500000,6000000]),
 (500, 1000, ARRAY[3500000,6000000,10000000])
) s(slots,activations,prices)
CROSS JOIN (VALUES (1,'3 Months','3M',90),(2,'6 Months','6M',180),(3,'12 Months','12M',365)) d(i,label,suffix,days)
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.update_plan_pricing(p_actor uuid, p_plan_id uuid, p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.plans; nxt public.plans;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Commercial settings permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.plans WHERE id = p_plan_id FOR UPDATE;
 IF prev.is_legacy THEN RAISE EXCEPTION 'Legacy plans cannot be edited or resold'; END IF;
 UPDATE public.plans SET
  price_cents = COALESCE((p_values->>'priceCents')::integer, price_cents),
  compare_at_cents = CASE WHEN p_values ? 'compareAtCents' THEN (p_values->>'compareAtCents')::integer ELSE compare_at_cents END,
  slot_capacity = COALESCE((p_values->>'slotCapacity')::integer, slot_capacity),
  duration_days = COALESCE((p_values->>'durationDays')::integer, duration_days),
  monthly_activation_limit = COALESCE((p_values->>'monthlyActivationLimit')::integer, monthly_activation_limit),
  promo_label = CASE WHEN p_values ? 'promoLabel' THEN nullif(p_values->>'promoLabel','') ELSE promo_label END,
  active = COALESCE((p_values->>'active')::boolean, active),
  public = COALESCE((p_values->>'public')::boolean, public)
 WHERE id = p_plan_id RETURNING * INTO nxt;
 IF nxt.price_cents < 0 OR nxt.price_cents > 100000000 THEN RAISE EXCEPTION 'Invalid price'; END IF;
 PERFORM public.commercial_audit(p_actor,'plan_pricing_updated','plan',p_plan_id,to_jsonb(prev),to_jsonb(nxt),p_reason);
END;
$$;

-- ── Programme contracts ──────────────────────────────────────────────────
CREATE TABLE public.commercial_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_type text NOT NULL CHECK (contract_type IN
   ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER','FOUNDING_ORGANISATION','ENTERPRISE_CUSTOM')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','ended','cancelled')),
  slot_capacity integer NOT NULL CHECK (slot_capacity BETWEEN 0 AND 100000),
  activation_limit_total integer CHECK (activation_limit_total IS NULL OR activation_limit_total >= 0),
  activation_limit_per_period integer CHECK (activation_limit_per_period IS NULL OR activation_limit_per_period >= 0),
  activation_period_days integer NOT NULL DEFAULT 30 CHECK (activation_period_days BETWEEN 1 AND 366),
  admin_limit integer NOT NULL DEFAULT 1 CHECK (admin_limit BETWEEN 1 AND 50),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  auto_renew boolean NOT NULL DEFAULT false,
  features jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR organisation_id IS NOT NULL),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_commercial_contracts_user ON public.commercial_contracts(user_id);
ALTER TABLE public.commercial_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own contracts" ON public.commercial_contracts FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));

-- ── Active posting slots ─────────────────────────────────────────────────
CREATE TABLE public.slot_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id uuid,
  area public.marketplace_area,
  source text NOT NULL CHECK (source IN ('RETAIL_PAID','LEGACY_PLAN','ENTERPRISE_PLAN','ENTERPRISE_CONTRACT',
   'STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER','FOUNDING_ORGANISATION','SPONSORED_ORGANISATION_MEMBER','ADMIN_GRANT')),
  plan_id uuid REFERENCES public.plans(id),
  payment_id uuid REFERENCES public.payments(id),
  contract_id uuid REFERENCES public.commercial_contracts(id) ON DELETE SET NULL,
  sponsorship_id uuid,
  slot_capacity integer NOT NULL CHECK (slot_capacity BETWEEN 0 AND 100000),
  activation_limit_total integer CHECK (activation_limit_total IS NULL OR activation_limit_total >= 0),
  activation_limit_per_period integer CHECK (activation_limit_per_period IS NULL OR activation_limit_per_period >= 0),
  activation_period_days integer NOT NULL DEFAULT 30 CHECK (activation_period_days BETWEEN 1 AND 366),
  activation_count integer NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_activation_at timestamptz,
  payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required','pending','paid','refunded','chargeback')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','pending_verification','expired','cancelled','revoked')),
  auto_renew boolean NOT NULL DEFAULT false,
  max_photos integer,
  max_videos integer,
  notes text,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR organisation_id IS NOT NULL),
  CHECK (expires_at > starts_at)
);
CREATE UNIQUE INDEX slot_entitlements_payment_key ON public.slot_entitlements(payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX slot_entitlements_contract_key ON public.slot_entitlements(contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX idx_slot_entitlements_user ON public.slot_entitlements(user_id, expires_at DESC);
CREATE INDEX idx_slot_entitlements_org ON public.slot_entitlements(organisation_id) WHERE organisation_id IS NOT NULL;

CREATE TABLE public.slot_entitlement_members (
  entitlement_id uuid NOT NULL REFERENCES public.slot_entitlements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entitlement_id, user_id)
);
CREATE INDEX idx_slot_members_user ON public.slot_entitlement_members(user_id);

CREATE TABLE public.slot_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES public.slot_entitlements(id) ON DELETE CASCADE,
  content_table text NOT NULL CHECK (content_table IN ('listings','businesses','promotions')),
  content_id uuid NOT NULL,
  owner_id uuid,
  activated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);
CREATE UNIQUE INDEX slot_assignments_active_content ON public.slot_assignments(content_id) WHERE released_at IS NULL;
CREATE INDEX idx_slot_assignments_entitlement ON public.slot_assignments(entitlement_id, activated_at DESC);

ALTER TABLE public.slot_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_entitlement_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Holders read own slot entitlements" ON public.slot_entitlements FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = id AND m.user_id = (SELECT auth.uid()))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Members read own memberships" ON public.slot_entitlement_members FOR SELECT USING (
  user_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Owners read own slot assignments" ON public.slot_assignments FOR SELECT USING (
  owner_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller','moderator']));

CREATE FUNCTION public.slot_entitlement_usable(e public.slot_entitlements) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT e.id IS NOT NULL AND e.status = 'active' AND e.payment_status IN ('not_required','paid')
  AND e.starts_at <= now() AND e.expires_at > now();
$$;

-- Keep the legacy per-area `entitlements` row as a summary of slot coverage so
-- plan gates, dashboards and add-on checks keep reading one row per area.
CREATE FUNCTION public.sync_area_entitlements(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.marketplace_area; best record;
BEGIN
 IF p_user IS NULL THEN RETURN; END IF;
 FOREACH a IN ARRAY ARRAY['MZANSI_MARKET','MZANSI_BUSINESS','PROMOTIONS_EVENTS']::public.marketplace_area[] LOOP
  SELECT max(e.expires_at) AS expires_at, min(e.starts_at) AS started_at, bool_or(e.status = 'active') AS any_active,
   (array_agg(COALESCE(p.tier::text, CASE WHEN e.source IN ('RETAIL_PAID','ADMIN_GRANT','STRATEGIC_INDIVIDUAL','SPONSORED_ORGANISATION_MEMBER') THEN 'month' ELSE 'enterprise' END)
     ORDER BY e.expires_at DESC))[1] AS tier,
   count(*) AS n
  INTO best
  FROM public.slot_entitlements e LEFT JOIN public.plans p ON p.id = e.plan_id
  WHERE (e.area IS NULL OR e.area = a) AND e.status IN ('active','pending_verification')
   AND e.payment_status IN ('not_required','paid') AND e.expires_at > now()
   AND (e.user_id = p_user OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = e.id AND m.user_id = p_user));
  IF best.n > 0 THEN
   INSERT INTO public.entitlements(user_id,area,tier,type,status,started_at,expires_at,cancelled_at)
   VALUES (p_user,a,best.tier::public.plan_tier,'subscription',
    CASE WHEN best.any_active THEN 'active' ELSE 'pending_verification' END::public.entitlement_status,
    best.started_at,best.expires_at,NULL)
   ON CONFLICT (user_id,area,type) DO UPDATE SET tier = EXCLUDED.tier, status = EXCLUDED.status,
    started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at, cancelled_at = NULL, updated_at = now();
  ELSIF EXISTS (SELECT 1 FROM public.slot_entitlements e WHERE (e.area IS NULL OR e.area = a)
   AND (e.user_id = p_user OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = e.id AND m.user_id = p_user))) THEN
   -- Only rows the slot system owns are withdrawn (refund, revocation, expiry).
   UPDATE public.entitlements SET status = 'expired', expires_at = least(expires_at, now()), updated_at = now()
   WHERE user_id = p_user AND area = a AND type = 'subscription' AND status IN ('active','pending_verification');
  END IF;
 END LOOP;
END;
$$;

CREATE FUNCTION public.slot_entitlements_sync_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE m uuid;
BEGIN
 IF TG_TABLE_NAME = 'slot_entitlement_members' THEN
  PERFORM public.sync_area_entitlements(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
 END IF;
 PERFORM public.sync_area_entitlements(COALESCE(NEW.user_id, OLD.user_id));
 FOR m IN SELECT user_id FROM public.slot_entitlement_members WHERE entitlement_id = COALESCE(NEW.id, OLD.id) LOOP
  PERFORM public.sync_area_entitlements(m);
 END LOOP;
 RETURN NULL;
END;
$$;
CREATE TRIGGER slot_entitlements_sync AFTER INSERT OR UPDATE OR DELETE ON public.slot_entitlements
 FOR EACH ROW EXECUTE FUNCTION public.slot_entitlements_sync_trigger();
CREATE TRIGGER slot_entitlement_members_sync AFTER INSERT OR DELETE ON public.slot_entitlement_members
 FOR EACH ROW EXECUTE FUNCTION public.slot_entitlements_sync_trigger();

-- What a user may post in an area right now. Used by create routes (capacity
-- and media) and trial renewal. Capacity -1 never occurs: every plan is capped.
CREATE FUNCTION public.posting_allowance(p_user uuid, p_area public.marketplace_area) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH usable AS (
  SELECT e.* FROM public.slot_entitlements e
  WHERE public.slot_entitlement_usable(e) AND (e.area IS NULL OR e.area = p_area)
   AND (e.user_id = p_user OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = e.id AND m.user_id = p_user))
 )
 SELECT jsonb_build_object(
  'hasPaidPlan', count(*) > 0,
  'capacity', COALESCE(sum(slot_capacity),0),
  'activeUsage', (SELECT count(*) FROM public.slot_assignments s WHERE s.released_at IS NULL AND s.entitlement_id IN (SELECT id FROM usable)),
  'maxPhotos', COALESCE(max(COALESCE(max_photos, public.commercial_setting_int('media','maxPhotos',10))), public.commercial_setting_int('media','maxPhotos',10)),
  'maxVideos', COALESCE(max(COALESCE(max_videos, public.commercial_setting_int('media','maxVideos',1))), public.commercial_setting_int('media','maxVideos',1)),
  'expiresAt', max(expires_at),
  'sources', COALESCE(jsonb_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL), '[]'::jsonb),
  'boostAllowed', bool_or(source IN ('RETAIL_PAID','LEGACY_PLAN','ENTERPRISE_PLAN','ENTERPRISE_CONTRACT')) IS TRUE)
 FROM usable;
$$;

-- Paid capacity counts content that holds or is waiting for a paid slot.
-- Sold/archived content, free events and live introductory-trial posts do not.
CREATE OR REPLACE FUNCTION public.posting_area_used(p_user_id uuid,p_area text,p_exclude uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT count(*)::integer FROM (
  SELECT id,status::text,expires_at,false AS free_event FROM public.listings WHERE owner_id=p_user_id AND area::text=p_area AND p_area='MZANSI_MARKET'
  UNION ALL SELECT id,status::text,expires_at,false FROM public.businesses WHERE owner_id=p_user_id AND area::text=p_area AND p_area IN ('MZANSI_BUSINESS','PROMOTIONS_EVENTS')
  UNION ALL SELECT id,status::text,expires_at,(to_jsonb(p)->>'promotion_type') = 'event' FROM public.promotions p WHERE owner_id=p_user_id AND p_area='PROMOTIONS_EVENTS'
 ) posts WHERE (p_exclude IS NULL OR id<>p_exclude) AND NOT free_event
 AND status NOT IN ('rejected','expired','sold','archived','suspended')
 AND (status<>'live' OR expires_at IS NULL OR expires_at>now())
 AND NOT EXISTS (SELECT 1 FROM public.intro_trial_claims t WHERE t.content_id = posts.id AND t.converted_at IS NULL AND t.released_at IS NULL);
$$;

CREATE FUNCTION public.activate_content_slot(p_table text, p_content uuid, p_owner uuid, p_area public.marketplace_area)
RETURNS public.slot_entitlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.slot_assignments; e public.slot_entitlements; any_usable boolean := false; n integer;
BEGIN
 SELECT * INTO s FROM public.slot_assignments WHERE content_id = p_content AND released_at IS NULL FOR UPDATE;
 IF s.id IS NOT NULL THEN
  SELECT * INTO e FROM public.slot_entitlements WHERE id = s.entitlement_id FOR UPDATE;
  IF public.slot_entitlement_usable(e) THEN RETURN e; END IF;
  UPDATE public.slot_assignments SET released_at = now(), release_reason = 'entitlement_ended' WHERE id = s.id;
 END IF;
 FOR e IN SELECT x.* FROM public.slot_entitlements x
  WHERE public.slot_entitlement_usable(x) AND (x.area IS NULL OR x.area = p_area)
   AND (x.user_id = p_owner OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = x.id AND m.user_id = p_owner))
  ORDER BY x.expires_at, x.created_at FOR UPDATE LOOP
  any_usable := true;
  SELECT count(*) INTO n FROM public.slot_assignments WHERE entitlement_id = e.id AND released_at IS NULL;
  CONTINUE WHEN n >= e.slot_capacity;
  CONTINUE WHEN e.activation_limit_total IS NOT NULL AND e.activation_count >= e.activation_limit_total;
  IF e.activation_limit_per_period IS NOT NULL THEN
   SELECT count(*) INTO n FROM public.slot_assignments WHERE entitlement_id = e.id
    AND activated_at > now() - make_interval(days => e.activation_period_days);
   CONTINUE WHEN n >= e.activation_limit_per_period;
  END IF;
  INSERT INTO public.slot_assignments(entitlement_id,content_table,content_id,owner_id) VALUES (e.id,p_table,p_content,p_owner);
  UPDATE public.slot_entitlements SET activation_count = activation_count + 1, last_activation_at = now(), updated_at = now()
   WHERE id = e.id RETURNING * INTO e;
  RETURN e;
 END LOOP;
 IF any_usable THEN
  RAISE EXCEPTION 'SLOT_FULL: All active posting slots or activations are in use. Mark a post as sold, deactivate one, or add capacity.';
 END IF;
 RETURN NULL;
END;
$$;

CREATE FUNCTION public.release_content_slot(p_content uuid, p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 UPDATE public.slot_assignments SET released_at = now(), release_reason = p_reason
 WHERE content_id = p_content AND released_at IS NULL;
$$;

-- ── Trial programme ledger (no stacking) ─────────────────────────────────
ALTER TABLE public.intro_trial_identities
  ADD COLUMN IF NOT EXISTS programme_kind text NOT NULL DEFAULT 'PUBLIC_7_DAY',
  ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.intro_trial_identities ADD CONSTRAINT intro_trial_identities_kind_check CHECK (programme_kind IN
 ('PUBLIC_7_DAY','PUBLIC_30_DAY','STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER','FOUNDING_ORGANISATION','SPONSORED_ORGANISATION_MEMBER'));
UPDATE public.intro_trial_identities i SET programme_kind = 'PUBLIC_30_DAY', user_id = c.user_id
FROM public.intro_trial_claims c
WHERE NOT c.admin_granted AND c.activated_at IS NOT NULL AND c.duration_days = 30
 AND public.intro_trial_identity(c.user_id) = i.identity_hmac;

CREATE FUNCTION public.intro_trial_days(p_choice integer) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT CASE WHEN p_choice = 7 THEN public.commercial_setting_int('trials','shortDays',7)
  ELSE public.commercial_setting_int('trials','longDays',30) END;
$$;

CREATE FUNCTION public.trial_entitlement_for(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE((SELECT programme_kind FROM public.intro_trial_identities WHERE identity_hmac = public.intro_trial_identity(p_user)),'NONE');
$$;

CREATE FUNCTION public.override_trial_entitlement(p_actor uuid, p_user uuid, p_kind text, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE h text; prev text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Trial management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 h := public.intro_trial_identity(p_user);
 IF h IS NULL THEN RAISE EXCEPTION 'Verified identity required'; END IF;
 SELECT programme_kind INTO prev FROM public.intro_trial_identities WHERE identity_hmac = h FOR UPDATE;
 IF p_kind = 'NONE' THEN
  DELETE FROM public.intro_trial_identities WHERE identity_hmac = h;
 ELSE
  INSERT INTO public.intro_trial_identities(identity_hmac,programme_kind,user_id) VALUES (h,p_kind,p_user)
  ON CONFLICT (identity_hmac) DO UPDATE SET programme_kind = EXCLUDED.programme_kind;
 END IF;
 PERFORM public.commercial_audit(p_actor,'trial_entitlement_overridden','user',p_user,
  jsonb_build_object('kind',COALESCE(prev,'NONE')),jsonb_build_object('kind',p_kind),p_reason);
 RETURN p_kind;
END;
$$;

-- Invitation-only programmes: one contract, one slot entitlement, identity
-- ledger entry so the person cannot later stack a public trial (or vice versa).
CREATE FUNCTION public.grant_programme_contract(p_actor uuid, p_user uuid, p_type text, p_values jsonb, p_reason text,
 p_override boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE h text; prev text; cfg jsonb; c public.commercial_contracts; days integer; area public.marketplace_area;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Programme management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF p_type NOT IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER','ENTERPRISE_CUSTOM') THEN RAISE EXCEPTION 'Unsupported programme'; END IF;
 IF p_type <> 'ENTERPRISE_CUSTOM' THEN
  h := public.intro_trial_identity(p_user);
  IF h IS NULL THEN RAISE EXCEPTION 'PROGRAMME_VERIFICATION_REQUIRED: The member must complete identity verification first'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(h || '::intro_identity'));
  SELECT programme_kind INTO prev FROM public.intro_trial_identities WHERE identity_hmac = h;
  IF prev IS NOT NULL AND NOT p_override THEN
   RAISE EXCEPTION 'PROGRAMME_ALREADY_USED: This identity already received %', prev;
  END IF;
  INSERT INTO public.intro_trial_identities(identity_hmac,programme_kind,user_id) VALUES (h,p_type,p_user)
  ON CONFLICT (identity_hmac) DO UPDATE SET programme_kind = EXCLUDED.programme_kind, user_id = EXCLUDED.user_id;
 END IF;
 SELECT value INTO cfg FROM public.commercial_settings
  WHERE key = CASE p_type WHEN 'STRATEGIC_INDIVIDUAL' THEN 'strategic' WHEN 'FOUNDING_COMMERCIAL_PARTNER' THEN 'founding_commercial' ELSE 'none' END;
 cfg := COALESCE(cfg,'{}'::jsonb) || COALESCE(p_values,'{}'::jsonb);
 days := COALESCE((cfg->>'durationDays')::integer, 90);
 area := nullif(cfg->>'area','')::public.marketplace_area;
 INSERT INTO public.commercial_contracts(contract_type,user_id,title,slot_capacity,activation_limit_total,
  activation_limit_per_period,activation_period_days,admin_limit,price_cents,starts_at,ends_at,features,notes,created_by)
 VALUES (p_type,p_user,COALESCE(nullif(cfg->>'title',''),initcap(replace(lower(p_type),'_',' '))),
  COALESCE((cfg->>'slotCapacity')::integer,1),(cfg->>'activationLimitTotal')::integer,(cfg->>'activationsPerPeriod')::integer,
  COALESCE((cfg->>'periodDays')::integer,30),COALESCE((cfg->>'adminLimit')::integer,1),COALESCE((cfg->>'priceCents')::integer,0),
  now(),now() + make_interval(days => days),COALESCE(cfg->'features','{}'::jsonb),cfg->>'notes',p_actor)
 RETURNING * INTO c;
 INSERT INTO public.slot_entitlements(user_id,area,source,contract_id,slot_capacity,activation_limit_total,activation_limit_per_period,
  activation_period_days,starts_at,expires_at,payment_status,granted_by,notes)
 VALUES (p_user,area,CASE WHEN p_type = 'ENTERPRISE_CUSTOM' THEN 'ENTERPRISE_CONTRACT' ELSE p_type END,c.id,c.slot_capacity,
  c.activation_limit_total,c.activation_limit_per_period,c.activation_period_days,c.starts_at,c.ends_at,
  CASE WHEN c.price_cents > 0 THEN 'pending' ELSE 'not_required' END,p_actor,c.notes);
 PERFORM public.commercial_audit(p_actor,'programme_granted','commercial_contract',c.id,
  jsonb_build_object('trialEntitlement',COALESCE(prev,'NONE')),to_jsonb(c),p_reason,jsonb_build_object('userId',p_user,'override',p_override));
 INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (p_user,'success',
  'You have been invited to a VerifyMzansi programme',
  c.title || ' is active until ' || to_char(c.ends_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY') || '. It does not renew automatically.','/dashboard');
 RETURN c.id;
END;
$$;

CREATE FUNCTION public.manage_commercial_contract(p_actor uuid, p_contract uuid, p_action text, p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.commercial_contracts; nxt public.commercial_contracts; member_count integer; target uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Programme management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.commercial_contracts WHERE id = p_contract FOR UPDATE;
 IF p_action = 'extend' THEN
  IF (p_values->>'endsAt')::timestamptz <= now() THEN RAISE EXCEPTION 'New end date must be in the future'; END IF;
  UPDATE public.commercial_contracts SET ends_at = (p_values->>'endsAt')::timestamptz, status = 'active', updated_at = now() WHERE id = p_contract;
 ELSIF p_action = 'end' THEN
  UPDATE public.commercial_contracts SET status = 'ended', ends_at = least(ends_at, now() + interval '1 second'), updated_at = now() WHERE id = p_contract;
 ELSIF p_action = 'limits' THEN
  UPDATE public.commercial_contracts SET
   slot_capacity = COALESCE((p_values->>'slotCapacity')::integer, slot_capacity),
   activation_limit_total = CASE WHEN p_values ? 'activationLimitTotal' THEN (p_values->>'activationLimitTotal')::integer ELSE activation_limit_total END,
   activation_limit_per_period = CASE WHEN p_values ? 'activationsPerPeriod' THEN (p_values->>'activationsPerPeriod')::integer ELSE activation_limit_per_period END,
   admin_limit = COALESCE((p_values->>'adminLimit')::integer, admin_limit),
   updated_at = now() WHERE id = p_contract;
 ELSIF p_action = 'notes' THEN
  UPDATE public.commercial_contracts SET notes = p_values->>'notes', updated_at = now() WHERE id = p_contract;
 ELSIF p_action IN ('add_member','remove_member') THEN
  target := (p_values->>'userId')::uuid;
  IF p_action = 'add_member' THEN
   SELECT count(*) + 1 INTO member_count FROM public.slot_entitlement_members m JOIN public.slot_entitlements e ON e.id = m.entitlement_id WHERE e.contract_id = p_contract;
   IF member_count >= prev.admin_limit THEN RAISE EXCEPTION 'CONTRACT_ADMIN_LIMIT: Administrator limit reached'; END IF;
   INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by)
    SELECT id,target,p_actor FROM public.slot_entitlements WHERE contract_id = p_contract ON CONFLICT DO NOTHING;
  ELSE
   DELETE FROM public.slot_entitlement_members m USING public.slot_entitlements e WHERE e.id = m.entitlement_id AND e.contract_id = p_contract AND m.user_id = target;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown contract action';
 END IF;
 SELECT * INTO nxt FROM public.commercial_contracts WHERE id = p_contract;
 UPDATE public.slot_entitlements SET slot_capacity = nxt.slot_capacity, activation_limit_total = nxt.activation_limit_total,
  activation_limit_per_period = nxt.activation_limit_per_period, expires_at = nxt.ends_at, notes = nxt.notes,
  status = CASE WHEN nxt.status = 'ended' THEN 'expired' ELSE status END, updated_at = now()
 WHERE contract_id = p_contract;
 PERFORM public.commercial_audit(p_actor,'programme_' || p_action,'commercial_contract',p_contract,to_jsonb(prev),to_jsonb(nxt),p_reason,
  COALESCE(p_values,'{}'::jsonb));
END;
$$;

-- ── Status lifecycle ─────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.promotions'::regclass AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%status%pending_moderation%' LOOP
  EXECUTE format('ALTER TABLE public.promotions DROP CONSTRAINT %I', r.conname);
 END LOOP;
END $$;
ALTER TABLE public.promotions ADD CONSTRAINT promotions_status_check CHECK (status IN
 ('draft','pending_moderation','flagged_for_review','live','hidden','expired','rejected','sold','suspended','archived'));

CREATE OR REPLACE FUNCTION public.validate_listing_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE o text := OLD.status::text; n text := NEW.status::text;
BEGIN
 IF o = n THEN RETURN NEW; END IF;
 IF NOT (auth.role() IS NULL OR auth.role() = 'service_role' OR public.has_role('admin')) THEN
  IF NOT ((o = 'draft' AND n = 'pending_moderation') OR (o = 'live' AND n IN ('hidden','sold'))) THEN
   RAISE EXCEPTION 'Status transition % → % requires moderation privileges', o, n USING ERRCODE = 'insufficient_privilege';
  END IF;
 END IF;
 IF NOT (
  (o = 'draft' AND n = 'pending_moderation') OR
  (o = 'pending_moderation' AND n IN ('live','rejected','flagged_for_review','hidden')) OR
  (o = 'flagged_for_review' AND n IN ('live','rejected','hidden','pending_moderation','suspended')) OR
  (o = 'live' AND n IN ('hidden','expired','flagged_for_review','sold','suspended')) OR
  (o = 'hidden' AND n IN ('live','pending_moderation','rejected','archived')) OR
  -- Reactivation of unchanged approved content after payment is a system write.
  (o = 'expired' AND n IN ('pending_moderation','draft','live','archived')) OR
  (o = 'sold' AND n IN ('live','pending_moderation','archived')) OR
  (o = 'suspended' AND n IN ('live','hidden','rejected','archived')) OR
  (o = 'archived' AND n IN ('draft','pending_moderation')) OR
  (o = 'rejected' AND n IN ('pending_moderation','draft','archived'))
 ) THEN
  RAISE EXCEPTION 'Invalid status transition: % → %', o, n USING ERRCODE = 'check_violation';
 END IF;
 RETURN NEW;
END;
$$;

-- ── Publication gate ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_intro_trial_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; c public.intro_trial_campaigns; h text; n integer;
 a public.marketplace_area; staff boolean; event_end timestamptz; e public.slot_entitlements; is_event boolean;
BEGIN
 IF TG_OP = 'UPDATE' AND
  (to_jsonb(NEW) - ARRAY['view_count','click_count','updated_at']) =
  (to_jsonb(OLD) - ARRAY['view_count','click_count','updated_at']) THEN RETURN NEW; END IF;
 IF TG_OP = 'DELETE' THEN
  SELECT * INTO t FROM public.intro_trial_claims WHERE content_id = OLD.id FOR UPDATE;
  IF t.id IS NOT NULL THEN UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'content_deleted' WHERE id = t.id; END IF;
  PERFORM public.release_content_slot(OLD.id,'deleted');
  RETURN OLD;
 END IF;
 SELECT * INTO t FROM public.intro_trial_claims WHERE content_id = NEW.id FOR UPDATE;
 a := CASE WHEN TG_TABLE_NAME = 'promotions' THEN 'PROMOTIONS_EVENTS'::public.marketplace_area ELSE (to_jsonb(NEW)->>'area')::public.marketplace_area END;
 event_end := (to_jsonb(NEW)->>'end_date')::timestamptz;
 is_event := TG_TABLE_NAME = 'promotions' AND to_jsonb(NEW)->>'promotion_type' = 'event';
 IF t.id IS NOT NULL THEN
  IF t.user_id IS DISTINCT FROM NEW.owner_id OR t.area IS DISTINCT FROM a THEN RAISE EXCEPTION 'Trial ownership or area mismatch'; END IF;
  UPDATE public.intro_trial_claims SET content_table = TG_TABLE_NAME WHERE id = t.id;
 END IF;
 IF NEW.status::text <> 'live' THEN
  IF t.id IS NOT NULL AND NEW.status::text IN ('hidden','expired','rejected','flagged_for_review','sold','suspended','archived') THEN
   UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = NEW.status::text WHERE id = t.id;
  END IF;
  -- A slot is held through review of already-live content; any take-down frees it.
  IF NEW.status::text IN ('hidden','expired','rejected','sold','suspended','archived') THEN
   PERFORM public.release_content_slot(NEW.id, NEW.status::text);
  END IF;
  RETURN NEW;
 END IF;
 IF t.id IS NULL AND TG_OP = 'UPDATE' AND OLD.status::text = 'live' THEN RETURN NEW; END IF;
 SELECT COALESCE(raw_app_meta_data->>'role','') IN ('admin','governance_controller','moderator') INTO staff FROM auth.users WHERE id = NEW.owner_id;
 IF staff THEN
  IF t.id IS NOT NULL THEN UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'staff_bypass' WHERE id = t.id; END IF;
  RETURN NEW;
 END IF;

 -- Events are free and never consume trials or paid slots; fair use applies.
 IF is_event THEN
  IF t.id IS NOT NULL THEN UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'free_event' WHERE id = t.id; END IF;
  SELECT count(*) INTO n FROM public.promotions p WHERE p.owner_id = NEW.owner_id AND p.id <> NEW.id AND p.status = 'live'
   AND to_jsonb(p)->>'promotion_type' = 'event' AND (p.expires_at IS NULL OR p.expires_at > now());
  IF n >= public.commercial_setting_int('events','maxActivePerAccount',5) THEN
   RAISE EXCEPTION 'EVENT_LIMIT: Maximum active events reached for this account';
  END IF;
  NEW.expires_at := COALESCE(event_end, now() + make_interval(days => public.commercial_setting_int('events','defaultVisibilityDays',30)));
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  RETURN NEW;
 END IF;

 -- Paid, programme and sponsored visibility: activate a reusable slot.
 IF t.id IS NULL OR t.converted_at IS NOT NULL THEN
  e := public.activate_content_slot(TG_TABLE_NAME, NEW.id, NEW.owner_id, a);
  IF e.id IS NULL THEN
   IF t.id IS NULL AND EXISTS (SELECT 1 FROM public.free_posts_used WHERE user_id = NEW.owner_id AND content_id = NEW.id AND released_at IS NULL) THEN
    RETURN NEW;
   END IF;
   IF t.id IS NULL THEN RAISE EXCEPTION 'TRIAL_REQUIRED: Select an introductory offer or a paid plan'; END IF;
   RAISE EXCEPTION 'TRIAL_EXPIRED: Paid renewal required';
  END IF;
  NEW.expires_at := e.expires_at;
  IF event_end IS NOT NULL THEN
   NEW.expires_at := least(NEW.expires_at,event_end);
   IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  END IF;
  RETURN NEW;
 END IF;

 h := public.intro_trial_identity(NEW.owner_id);
 IF h IS NULL THEN RAISE EXCEPTION 'TRIAL_VERIFICATION_REQUIRED: Complete verification before approval'; END IF;
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
  NEW.expires_at := now() + make_interval(days => CASE WHEN t.admin_granted THEN 30 ELSE public.intro_trial_days(t.duration_days) END);
  IF TG_TABLE_NAME = 'promotions' AND event_end IS NOT NULL THEN NEW.expires_at := least(NEW.expires_at,event_end); END IF;
  IF NEW.expires_at <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  IF NOT t.admin_granted THEN
   INSERT INTO public.intro_trial_identities(identity_hmac,programme_kind,user_id)
   VALUES (h,CASE WHEN t.duration_days = 30 THEN 'PUBLIC_30_DAY' ELSE 'PUBLIC_7_DAY' END,NEW.owner_id);
  END IF;
  UPDATE public.intro_trial_claims SET activated_at = now(), expires_at = NEW.expires_at WHERE id = t.id;
  INSERT INTO public.notifications(user_id,type,title,message,href)
   VALUES (NEW.owner_id,'success',CASE WHEN t.admin_granted THEN 'Your free post is active' ELSE 'Your introductory trial is active' END,
    'Your post is visible until ' || to_char(NEW.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST. Renew from R50 to keep it active.','/dashboard/listings');
 END IF;
 NEW := jsonb_populate_record(NEW, jsonb_build_object('boost_until',NULL,'featured_until',NULL,'urgent_until',NULL,'featured',false,'urgent',false));
 IF TG_TABLE_NAME = 'promotions' AND event_end IS NOT NULL THEN
  NEW.expires_at := least(NEW.expires_at,event_end);
  UPDATE public.intro_trial_claims SET expires_at = NEW.expires_at WHERE id = t.id;
 END IF;
 RETURN NEW;
END;
$$;

-- Trial renewal converts to the paid slot pool and republishes directly when
-- the content was already approved and has not changed (edits of expired
-- content are blocked by the API).
CREATE OR REPLACE FUNCTION public.update_own_intro_trial(p_user_id uuid, p_claim_id uuid, p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE t public.intro_trial_claims; allowance jsonb; n integer; cap integer; content jsonb; photos integer; videos integer;
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
  allowance := public.posting_allowance(p_user_id, t.area);
  IF NOT (allowance->>'hasPaidPlan')::boolean THEN RAISE EXCEPTION 'Paid plan required'; END IF;
  cap := (allowance->>'capacity')::integer;
  n := public.posting_area_used(p_user_id,t.area::text,t.content_id);
  IF n >= cap THEN RAISE EXCEPTION 'Paid plan capacity reached'; END IF;
  IF t.content_table IS NULL THEN RAISE EXCEPTION 'Content not found'; END IF;
  EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE id=$1 FOR UPDATE',t.content_table) INTO STRICT content USING t.content_id;
  photos := jsonb_array_length(COALESCE(NULLIF(content->'photos','null'::jsonb),NULLIF(content->'gallery_photos','null'::jsonb),'[]'::jsonb));
  videos := jsonb_array_length(COALESCE(NULLIF(content->'videos','null'::jsonb),'[]'::jsonb)) + CASE WHEN NULLIF(content->>'cover_video','') IS NOT NULL THEN 1 ELSE 0 END;
  IF photos > (allowance->>'maxPhotos')::integer OR videos > (allowance->>'maxVideos')::integer THEN
   RAISE EXCEPTION 'Paid plan must support the media on this post';
  END IF;
  IF (content->>'end_date')::timestamptz <= now() THEN RAISE EXCEPTION 'This event has ended'; END IF;
  UPDATE public.intro_trial_claims SET converted_at = COALESCE(converted_at,now()), released_at = COALESCE(released_at,now()), release_reason = 'paid_renewal' WHERE id = t.id;
  IF content->>'status' NOT IN ('live','expired','hidden','pending_moderation') THEN RAISE EXCEPTION 'Content cannot be renewed in its current state'; END IF;
  EXECUTE format('UPDATE public.%I SET status = %L, status_reason = NULL WHERE id = $1', t.content_table,
   CASE WHEN content->>'status' IN ('live','expired') THEN 'live' ELSE 'pending_moderation' END) USING t.content_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Content cannot be renewed in its current state'; END IF;
 ELSE RAISE EXCEPTION 'Unknown action'; END IF;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason) VALUES(p_user_id,p_action,p_claim_id::text,'Member requested trial update');
END;
$$;

-- Owner actions on their own content (service role; the API authenticates).
CREATE FUNCTION public.owner_content_action(p_user uuid, p_table text, p_content uuid, p_action text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE content jsonb; st text; claim public.intro_trial_claims; n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
 IF p_table NOT IN ('listings','businesses','promotions') THEN RAISE EXCEPTION 'Unknown content type'; END IF;
 EXECUTE format('SELECT to_jsonb(p) FROM public.%I p WHERE id = $1 FOR UPDATE',p_table) INTO content USING p_content;
 IF content IS NULL OR (content->>'owner_id')::uuid IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND: Content not found'; END IF;
 st := content->>'status';
 IF p_action = 'mark_sold' THEN
  IF st <> 'live' THEN RAISE EXCEPTION 'CONTENT_STATE: Only live posts can be marked as sold'; END IF;
  EXECUTE format('UPDATE public.%I SET status = ''sold'', status_reason = ''Marked as sold by owner'' WHERE id = $1',p_table) USING p_content;
  RETURN 'sold';
 ELSIF p_action = 'deactivate' THEN
  IF st <> 'live' THEN RAISE EXCEPTION 'CONTENT_STATE: Only live posts can be deactivated'; END IF;
  EXECUTE format('UPDATE public.%I SET status = ''hidden'', status_reason = ''Deactivated by owner'' WHERE id = $1',p_table) USING p_content;
  RETURN 'hidden';
 ELSIF p_action = 'reactivate' THEN
  IF st NOT IN ('expired','sold') AND NOT (st = 'hidden' AND content->>'status_reason' = 'Deactivated by owner') THEN
   RAISE EXCEPTION 'CONTENT_STATE: This post cannot be reactivated in its current state';
  END IF;
  IF (content->>'end_date')::timestamptz <= now() THEN RAISE EXCEPTION 'TRIAL_EVENT_ENDED: Event has already ended'; END IF;
  SELECT * INTO claim FROM public.intro_trial_claims WHERE content_id = p_content FOR UPDATE;
  IF claim.id IS NOT NULL AND claim.converted_at IS NULL THEN
   UPDATE public.intro_trial_claims SET converted_at = now(), released_at = COALESCE(released_at,now()), release_reason = COALESCE(release_reason,'paid_renewal') WHERE id = claim.id;
  END IF;
  -- Unchanged, previously approved content goes straight back to live; the
  -- publication trigger activates a slot or raises SLOT_FULL / TRIAL_REQUIRED.
  EXECUTE format('UPDATE public.%I SET status = ''live'', status_reason = NULL WHERE id = $1',p_table) USING p_content;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN 'live';
 END IF;
 RAISE EXCEPTION 'Unknown content action';
END;
$$;

CREATE FUNCTION public.slot_usage_summary(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',e.id,'source',e.source,'area',e.area,'planName',p.name,'planCode',p.plan_code,'status',
   CASE WHEN public.slot_entitlement_usable(e) THEN 'active' WHEN e.expires_at <= now() THEN 'expired' ELSE e.status END,
  'slotCapacity',e.slot_capacity,'activeUsage',(SELECT count(*) FROM public.slot_assignments s WHERE s.entitlement_id = e.id AND s.released_at IS NULL),
  'activationCount',e.activation_count,'activationLimitTotal',e.activation_limit_total,
  'activationLimitPerPeriod',e.activation_limit_per_period,'activationPeriodDays',e.activation_period_days,
  'periodActivations',(SELECT count(*) FROM public.slot_assignments s WHERE s.entitlement_id = e.id AND s.activated_at > now() - make_interval(days => e.activation_period_days)),
  'startsAt',e.starts_at,'expiresAt',e.expires_at,'lastActivationAt',e.last_activation_at,'autoRenew',e.auto_renew,
  'paymentStatus',e.payment_status,'sponsored',e.source IN ('SPONSORED_ORGANISATION_MEMBER'))
  ORDER BY e.expires_at DESC),'[]'::jsonb)
 FROM public.slot_entitlements e LEFT JOIN public.plans p ON p.id = e.plan_id
 WHERE (e.user_id = p_user OR EXISTS (SELECT 1 FROM public.slot_entitlement_members m WHERE m.entitlement_id = e.id AND m.user_id = p_user))
  AND e.expires_at > now() - interval '90 days';
$$;

-- ── Payment fulfilment: paid plans create slot entitlements ─────────────
CREATE OR REPLACE FUNCTION public.fulfill_ozow_payment(
  p_payment_id uuid, p_provider_payment_id text, p_expected_amount integer, p_expected_metadata jsonb,
  p_plan_id uuid, p_addon_days numeric, p_webhook jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_payment public.payments%ROWTYPE; v_plan public.plans%ROWTYPE; v_meta jsonb; v_data jsonb;
  v_account_status text; v_outcome text := 'completed'; v_expires_at timestamptz; v_vat integer;
  v_table text; v_column text; v_owner text; v_target uuid; v_target_type text; v_action text; v_rows integer;
  v_capacity integer; v_source text;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.provider <> 'ozow' OR v_payment.amount_cents IS DISTINCT FROM p_expected_amount THEN
    RAISE EXCEPTION 'Payment provider or amount mismatch';
  END IF;
  IF nullif(p_provider_payment_id, '') IS NULL THEN RAISE EXCEPTION 'Missing provider payment ID'; END IF;
  IF v_payment.provider_payment_id IS NOT NULL AND v_payment.provider_payment_id <> p_provider_payment_id THEN
    RAISE EXCEPTION 'Payment ID mismatch';
  END IF;
  IF v_payment.status = 'complete' THEN RETURN jsonb_build_object('outcome', 'duplicate'); END IF;
  IF v_payment.status NOT IN ('pending', 'failed', 'expired', 'processing') THEN
    RETURN jsonb_build_object('outcome', 'ignored');
  END IF;

  v_data := coalesce(v_payment.provider_data, '{}'::jsonb);
  v_meta := CASE WHEN jsonb_typeof(v_data->'metadata') = 'object' AND nullif(v_data->'metadata'->>'type', '') IS NOT NULL
                 THEN v_data->'metadata' ELSE v_data END;
  IF v_payment.status = 'processing' THEN
    IF jsonb_typeof(v_data->'fulfillment_completed_at') IS DISTINCT FROM 'string'
       OR nullif(v_data->>'fulfillment_completed_at', '') IS NULL THEN
      RAISE EXCEPTION 'Legacy payment requires reconciliation' USING ERRCODE = 'P0001';
    END IF;
    v_outcome := 'recovered';
  ELSE
    IF v_meta IS DISTINCT FROM p_expected_metadata OR nullif(v_meta->>'type', '') IS NULL THEN
      RAISE EXCEPTION 'Payment metadata changed or missing';
    END IF;

    IF v_meta->>'type' = 'subscription' THEN
      SELECT * INTO v_plan FROM public.plans WHERE id = p_plan_id FOR SHARE;
      -- A plan retired after checkout still honours the price the customer paid.
      IF NOT FOUND OR NOT (v_plan.active OR (v_plan.retired_at IS NOT NULL AND v_plan.retired_at > v_payment.created_at))
         OR v_plan.price_cents IS DISTINCT FROM v_payment.amount_cents
         OR (v_plan.area IS NOT NULL AND (v_plan.area IS DISTINCT FROM v_payment.area OR v_meta->>'area' IS DISTINCT FROM v_plan.area::text))
         OR v_meta->>'plan_tier' IS DISTINCT FROM v_plan.tier::text THEN
        RAISE EXCEPTION 'Paid plan validation failed';
      END IF;
      SELECT account_status::text INTO v_account_status FROM public.account_profiles WHERE user_id = v_payment.user_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Account profile not found'; END IF;
      v_expires_at := v_payment.created_at + make_interval(days => COALESCE(v_plan.duration_days, 30));
      v_capacity := COALESCE(v_plan.slot_capacity, nullif(greatest(
        COALESCE((v_plan.features->>'maxListings')::integer,(v_plan.features->>'maxBusinesses')::integer,(v_plan.features->>'maxPromotions')::integer,1),0),0), 1);
      IF v_capacity < 0 THEN v_capacity := 1000; END IF;
      v_source := CASE WHEN v_plan.tier::text = 'enterprise' THEN 'ENTERPRISE_PLAN' WHEN v_plan.is_legacy THEN 'LEGACY_PLAN' ELSE 'RETAIL_PAID' END;
      INSERT INTO public.slot_entitlements(user_id,area,source,plan_id,payment_id,slot_capacity,activation_limit_per_period,
        activation_period_days,starts_at,expires_at,payment_status,status,max_photos,max_videos)
      VALUES (v_payment.user_id,v_plan.area,v_source,v_plan.id,v_payment.id,v_capacity,v_plan.monthly_activation_limit,30,
        v_payment.created_at,v_expires_at,'paid',CASE WHEN v_account_status = 'restricted' THEN 'pending_verification' ELSE 'active' END,
        (v_plan.features->>'maxPhotos')::integer,(v_plan.features->>'maxVideos')::integer)
      ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING;

      v_vat := round(v_payment.amount_cents::numeric * 1500 / 11500)::integer;
      INSERT INTO public.invoices (invoice_number, user_id, payment_id, amount_cents, vat_cents, total_cents, description)
      VALUES ('INV-' || to_char(v_payment.created_at AT TIME ZONE 'Africa/Johannesburg', 'YYYYMMDD') || '-' || upper(left(v_payment.id::text, 8)),
        v_payment.user_id, v_payment.id, v_payment.amount_cents - v_vat, v_vat, v_payment.amount_cents,
        v_plan.name || ' (' || COALESCE(v_plan.area::text,'all areas') || ')')
      ON CONFLICT (payment_id) DO NOTHING;
    ELSE
      CASE v_meta->>'type'
        WHEN 'boost' THEN v_table := 'listings'; v_column := 'boost_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'featured' THEN v_table := 'listings'; v_column := 'featured_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'urgent' THEN v_table := 'listings'; v_column := 'urgent_until'; v_target := (v_meta->>'listing_id')::uuid;
        WHEN 'boost_business' THEN v_table := 'businesses'; v_column := 'boost_until'; v_target := coalesce(v_meta->>'business_id', v_meta->>'business_profile_id')::uuid;
        WHEN 'featured_business' THEN v_table := 'businesses'; v_column := 'featured_until'; v_target := (v_meta->>'business_id')::uuid;
        WHEN 'urgent_business' THEN v_table := 'businesses'; v_column := 'urgent_until'; v_target := (v_meta->>'business_id')::uuid;
        WHEN 'boost_promotion' THEN v_table := 'promotions'; v_column := 'boost_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'featured_promotion' THEN v_table := 'promotions'; v_column := 'featured_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'urgent_promotion' THEN v_table := 'promotions'; v_column := 'urgent_until'; v_target := (v_meta->>'promotion_id')::uuid;
        WHEN 'boost_storefront' THEN v_table := 'storefronts'; v_column := 'boost_until'; v_target := (v_meta->>'storefront_id')::uuid;
        ELSE RAISE EXCEPTION 'Unsupported payment type';
      END CASE;
      IF v_target IS NULL OR p_addon_days IS NULL OR p_addon_days <= 0
         OR p_addon_days::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Missing target or invalid addon duration';
      END IF;
      SELECT column_name INTO v_owner FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = v_table AND column_name IN ('owner_id', 'seller_id')
        ORDER BY CASE column_name WHEN 'owner_id' THEN 0 ELSE 1 END LIMIT 1;
      IF v_owner IS NULL THEN RAISE EXCEPTION 'Owner column not found'; END IF;
      v_expires_at := v_payment.created_at + p_addon_days * interval '24 hours';
      EXECUTE format('UPDATE public.%I SET %I = greatest(%I, $1) WHERE id = $2 AND %I = $3',
        v_table, v_column, v_column, v_owner) USING v_expires_at, v_target, v_payment.user_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'Addon target not found or not owned'; END IF;
      v_target_type := CASE v_table WHEN 'businesses' THEN 'business' WHEN 'listings' THEN 'listing' WHEN 'promotions' THEN 'promotion' ELSE 'storefront' END;
      v_action := v_target_type || CASE v_column WHEN 'boost_until' THEN '_boosted' WHEN 'featured_until' THEN '_featured' ELSE '_urgent' END;
      INSERT INTO public.audit_logs(actor_id, actor_role, action, target_type, target_id, metadata)
      VALUES (v_payment.user_id, 'member', v_action, v_target_type, v_target,
        jsonb_build_object('paymentId', v_payment.id,
          CASE v_column WHEN 'boost_until' THEN 'boostDays' WHEN 'featured_until' THEN 'featureDays' ELSE 'urgentDays' END, p_addon_days,
          CASE v_column WHEN 'boost_until' THEN 'boostUntil' WHEN 'featured_until' THEN 'featuredUntil' ELSE 'urgentUntil' END, v_expires_at));
    END IF;
  END IF;

  UPDATE public.payments SET status = 'complete', provider_payment_id = p_provider_payment_id,
    provider_reference = coalesce(provider_reference, id::text),
    provider_data = v_data || jsonb_build_object(
      'fulfillment_completed_at', coalesce(v_data->>'fulfillment_completed_at', now()::text),
      'fulfillment_state', 'completed', 'completed_at', now(),
      'fulfillment_protocol', 'atomic_v2', 'last_webhook_at', now(),
      'webhooks', CASE WHEN jsonb_typeof(v_data->'webhooks') = 'array' THEN v_data->'webhooks' ELSE '[]'::jsonb END
        || jsonb_build_array(coalesce(p_webhook, '{}'::jsonb)))
    WHERE id = v_payment.id;
  RETURN jsonb_build_object('outcome', v_outcome, 'expires_at', v_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.fulfill_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_ozow_payment(uuid, text, integer, jsonb, uuid, numeric, jsonb) TO service_role;

-- ── Refunds / chargebacks ────────────────────────────────────────────────
CREATE FUNCTION public.reverse_payment(p_actor uuid, p_payment uuid, p_kind text, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE pay public.payments; s record; hidden integer := 0;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor AND raw_app_meta_data->>'role' = 'admin') THEN
  RAISE EXCEPTION 'Payment reversal permission required' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('refunded','chargeback') THEN RAISE EXCEPTION 'Unknown reversal kind'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT pay FROM public.payments WHERE id = p_payment FOR UPDATE;
 IF pay.status::text <> 'complete' THEN RAISE EXCEPTION 'Only completed payments can be reversed'; END IF;
 UPDATE public.payments SET status = p_kind::public.payment_status, updated_at = now() WHERE id = p_payment;
 FOR s IN SELECT a.content_table, a.content_id FROM public.slot_assignments a JOIN public.slot_entitlements e ON e.id = a.entitlement_id
  WHERE e.payment_id = p_payment AND a.released_at IS NULL LOOP
  EXECUTE format('UPDATE public.%I SET status = ''expired'', status_reason = ''Payment reversed'' WHERE id = $1 AND status = ''live''', s.content_table) USING s.content_id;
  hidden := hidden + 1;
 END LOOP;
 UPDATE public.slot_entitlements SET status = 'revoked', payment_status = p_kind, updated_at = now() WHERE payment_id = p_payment;
 PERFORM public.commercial_audit(p_actor,'payment_' || p_kind,'payment',p_payment,
  jsonb_build_object('status','complete'),jsonb_build_object('status',p_kind,'contentWithdrawn',hidden),p_reason);
 RETURN hidden;
END;
$$;

-- ── Expire slot entitlements (cosmetic status; usability is time based) ──
CREATE FUNCTION public.expire_slot_entitlements() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
 UPDATE public.slot_entitlements SET status = 'expired', updated_at = now() WHERE status = 'active' AND expires_at <= now();
 GET DIAGNOSTICS n = ROW_COUNT;
 UPDATE public.commercial_contracts SET status = 'ended', updated_at = now() WHERE status = 'active' AND ends_at <= now();
 RETURN n;
END;
$$;

-- ── Legacy migration: paid entitlements keep their original expiry ───────
INSERT INTO public.slot_entitlements(user_id,area,source,plan_id,slot_capacity,starts_at,expires_at,payment_status,status,max_photos,max_videos,notes)
SELECT e.user_id, e.area, 'LEGACY_PLAN', p.id,
  greatest(1, CASE WHEN COALESCE((p.features->>'maxListings')::integer,(p.features->>'maxBusinesses')::integer,(p.features->>'maxPromotions')::integer,1) < 0 THEN 1000
   ELSE COALESCE((p.features->>'maxListings')::integer,(p.features->>'maxBusinesses')::integer,(p.features->>'maxPromotions')::integer,1) END,
   public.posting_area_used(e.user_id, e.area::text)),
  least(e.started_at, e.expires_at - interval '1 second'), e.expires_at, 'paid',
  CASE WHEN e.status::text = 'pending_verification' THEN 'pending_verification' ELSE 'active' END,
  (p.features->>'maxPhotos')::integer, (p.features->>'maxVideos')::integer,
  'Migrated from legacy ' || COALESCE(e.tier::text,'unknown') || ' plan; honoured until original expiry.'
FROM public.entitlements e LEFT JOIN public.plans p ON p.area = e.area AND p.tier = e.tier
WHERE e.type = 'subscription' AND e.status::text IN ('active','pending_verification') AND e.expires_at > now();

INSERT INTO public.slot_assignments(entitlement_id,content_table,content_id,owner_id,activated_at)
SELECT DISTINCT ON (c.id) s.id, c.tbl, c.id, c.owner_id, now()
FROM public.slot_entitlements s
JOIN (
  SELECT 'listings'::text tbl, id, owner_id, area FROM public.listings WHERE status = 'live' AND expires_at > now()
  UNION ALL SELECT 'businesses', id, owner_id, area FROM public.businesses WHERE status = 'live' AND expires_at > now()
  UNION ALL SELECT 'promotions', id, owner_id, 'PROMOTIONS_EVENTS'::public.marketplace_area FROM public.promotions p
   WHERE status = 'live' AND expires_at > now() AND COALESCE(to_jsonb(p)->>'promotion_type','') <> 'event'
) c ON c.owner_id = s.user_id AND c.area = s.area
WHERE s.source = 'LEGACY_PLAN'
 AND NOT EXISTS (SELECT 1 FROM public.intro_trial_claims t WHERE t.content_id = c.id AND t.converted_at IS NULL)
ORDER BY c.id, s.expires_at DESC;
UPDATE public.slot_entitlements s SET activation_count = (SELECT count(*) FROM public.slot_assignments a WHERE a.entitlement_id = s.id)
WHERE s.source = 'LEGACY_PLAN';

-- ── Grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_commercial_admin(uuid), public.commercial_audit(uuid,text,text,uuid,jsonb,jsonb,text,jsonb),
 public.update_commercial_setting(uuid,text,jsonb,text), public.update_plan_pricing(uuid,uuid,jsonb,text),
 public.sync_area_entitlements(uuid), public.posting_allowance(uuid,public.marketplace_area),
 public.activate_content_slot(text,uuid,uuid,public.marketplace_area), public.release_content_slot(uuid,text),
 public.trial_entitlement_for(uuid), public.override_trial_entitlement(uuid,uuid,text,text),
 public.grant_programme_contract(uuid,uuid,text,jsonb,text,boolean), public.manage_commercial_contract(uuid,uuid,text,jsonb,text),
 public.owner_content_action(uuid,text,uuid,text), public.slot_usage_summary(uuid), public.reverse_payment(uuid,uuid,text,text),
 public.expire_slot_entitlements(), public.intro_trial_days(integer), public.commercial_setting_int(text,text,integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_commercial_setting(uuid,text,jsonb,text), public.update_plan_pricing(uuid,uuid,jsonb,text),
 public.posting_allowance(uuid,public.marketplace_area), public.trial_entitlement_for(uuid),
 public.override_trial_entitlement(uuid,uuid,text,text), public.grant_programme_contract(uuid,uuid,text,jsonb,text,boolean),
 public.manage_commercial_contract(uuid,uuid,text,jsonb,text), public.owner_content_action(uuid,text,uuid,text),
 public.slot_usage_summary(uuid), public.reverse_payment(uuid,uuid,text,text), public.expire_slot_entitlements(),
 public.commercial_setting_int(text,text,integer), public.intro_trial_days(integer)
TO service_role;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('expire-slot-entitlements','20 * * * *','SELECT public.expire_slot_entitlements()');
 END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
