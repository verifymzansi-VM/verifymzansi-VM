-- Completion of the commercial model against the founding-network spec.
--   * Priced custom contracts can be marked paid (their slots were unusable),
--     and contracts can start on a custom date.
--   * Affiliation types: Programme Participant / Member / Affiliated with,
--     with a directory filter; showroom province targeting.
--   * Per-account event allowances for large organisers.
--   * Per-account media storage usage for the storage quota.
BEGIN;

-- ── Storage quota support ───────────────────────────────────────────────
CREATE FUNCTION public.media_storage_used(p_user uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE(sum(file_size),0)::bigint FROM public.media_uploads WHERE user_id = p_user;
$$;
REVOKE ALL ON FUNCTION public.media_storage_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_storage_used(uuid) TO service_role;

-- ── Event allowances (custom fair use for large organisers) ─────────────
CREATE TABLE public.event_allowances (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  max_active integer NOT NULL CHECK (max_active BETWEEN 1 AND 10000),
  max_created_per_30_days integer NOT NULL CHECK (max_created_per_30_days BETWEEN 1 AND 100000),
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_allowances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own event allowance" ON public.event_allowances FOR SELECT USING (
  user_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));

CREATE FUNCTION public.event_limits(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT jsonb_build_object(
  'maxActive', COALESCE((SELECT max_active FROM public.event_allowances WHERE user_id = p_user),
    public.commercial_setting_int('events','maxActivePerAccount',5)),
  'maxCreatedPer30Days', COALESCE((SELECT max_created_per_30_days FROM public.event_allowances WHERE user_id = p_user),
    public.commercial_setting_int('events','maxCreatedPer30Days',10)),
  'custom', EXISTS (SELECT 1 FROM public.event_allowances WHERE user_id = p_user));
$$;

CREATE FUNCTION public.admin_set_event_allowance(p_actor uuid, p_user uuid, p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.event_allowances;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Programme management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO prev FROM public.event_allowances WHERE user_id = p_user;
 IF COALESCE((p_values->>'remove')::boolean,false) THEN
  DELETE FROM public.event_allowances WHERE user_id = p_user;
 ELSE
  INSERT INTO public.event_allowances(user_id,max_active,max_created_per_30_days,notes,updated_by)
  VALUES (p_user,(p_values->>'maxActive')::integer,(p_values->>'maxCreatedPer30Days')::integer,p_values->>'notes',p_actor)
  ON CONFLICT (user_id) DO UPDATE SET max_active = EXCLUDED.max_active,
   max_created_per_30_days = EXCLUDED.max_created_per_30_days, notes = EXCLUDED.notes,
   updated_by = p_actor, updated_at = now();
 END IF;
 PERFORM public.commercial_audit(p_actor,'programme_event_allowance','user',p_user,to_jsonb(prev),p_values,p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.event_limits(uuid), public.admin_set_event_allowance(uuid,uuid,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_limits(uuid), public.admin_set_event_allowance(uuid,uuid,jsonb,text) TO service_role;

-- ── Affiliation types ───────────────────────────────────────────────────
ALTER TABLE public.organisation_affiliations
  ADD COLUMN affiliation_type text NOT NULL DEFAULT 'participant'
  CHECK (affiliation_type IN ('participant','member','affiliate'));

CREATE FUNCTION public.affiliation_label(p_type text, p_org_wording text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_type WHEN 'member' THEN 'Member' WHEN 'affiliate' THEN 'Affiliated with' ELSE p_org_wording END;
$$;

CREATE FUNCTION public.org_set_affiliation_type(p_user uuid, p_affiliation uuid, p_type text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f public.organisation_affiliations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.organisation_affiliations WHERE id = p_affiliation FOR UPDATE;
 IF f.id IS NULL OR f.status <> 'active' THEN RAISE EXCEPTION 'Active affiliation not found'; END IF;
 IF NOT (public.is_organisation_admin(f.organisation_id,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 IF p_type NOT IN ('participant','member','affiliate') THEN RAISE EXCEPTION 'Unknown affiliation type'; END IF;
 UPDATE public.organisation_affiliations SET affiliation_type = p_type WHERE id = f.id;
 PERFORM public.commercial_audit(p_user,'affiliation_type_changed','organisation_affiliation',f.id,
  jsonb_build_object('type',f.affiliation_type),jsonb_build_object('type',p_type),NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.org_set_affiliation_type(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_set_affiliation_type(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.public_business_affiliations(p_business_ids uuid[])
RETURNS TABLE(business_id uuid, organisation_id uuid, organisation_slug text, organisation_name text, logo_url text,
 label text, programme_name text, confirmed_at timestamptz, sponsored boolean, sponsorship_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT f.business_id, o.id, o.slug, o.name, CASE WHEN o.logo_permission_at IS NOT NULL THEN o.logo_url END,
  public.affiliation_label(f.affiliation_type, o.affiliation_wording), pr.name, f.confirmed_at,
  s.id IS NOT NULL, CASE WHEN s.id IS NOT NULL THEN o.sponsorship_wording || ' ' || o.name END
 FROM public.organisation_affiliations f
 JOIN public.organisations o ON o.id = f.organisation_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
 LEFT JOIN public.organisation_sponsorships s ON s.affiliation_id = f.id AND s.status = 'active'
  AND s.sponsor_type = 'ORGANISATION' AND s.ends_at > now()
 WHERE f.business_id = ANY(p_business_ids[1:200]) AND f.status = 'active' AND public.organisation_is_listed(o)
 ORDER BY f.business_id, (s.id IS NOT NULL) DESC, f.confirmed_at;
$$;

DROP FUNCTION public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer);

CREATE FUNCTION public.organisation_directory(p_org uuid, p_search text DEFAULT NULL, p_category text DEFAULT NULL,
 p_city text DEFAULT NULL, p_programme uuid DEFAULT NULL, p_sponsored boolean DEFAULT NULL, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0,
 p_province text DEFAULT NULL, p_type text DEFAULT NULL)
RETURNS TABLE(business_id uuid, business_name text, slug text, category text, subcategory text, city text, province text,
 logo_url text, cover_image text, programme_name text, confirmed_at timestamptz, sponsored boolean,
 affiliation_type text, affiliation_label text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH rows AS (
  SELECT b.id, b.business_name::text AS business_name, b.slug::text AS slug, b.category::text AS category, b.subcategory::text AS subcategory,
   b.location_city::text AS city, b.location_province::text AS province, b.logo_url::text AS logo_url,
   (to_jsonb(b)->>'cover_photo') AS cover_image, pr.name AS programme_name, f.confirmed_at,
   EXISTS (SELECT 1 FROM public.organisation_sponsorships s WHERE s.affiliation_id = f.id AND s.status = 'active') AS sponsored,
   f.affiliation_type, public.affiliation_label(f.affiliation_type, o.affiliation_wording) AS affiliation_label
  FROM public.organisation_affiliations f
  JOIN public.organisations o ON o.id = f.organisation_id
  JOIN public.businesses b ON b.id = f.business_id
  LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
  WHERE f.organisation_id = p_org AND f.status = 'active' AND public.organisation_is_listed(o)
   AND b.status = 'live' AND (b.expires_at IS NULL OR b.expires_at > now())
   AND (p_search IS NULL OR b.business_name ILIKE '%' || replace(replace(p_search,'%',''),'_','') || '%')
   AND (p_category IS NULL OR b.category::text = p_category)
   AND (p_city IS NULL OR b.location_city ILIKE replace(replace(p_city,'%',''),'_',''))
   AND (p_programme IS NULL OR f.programme_id = p_programme)
   AND (p_province IS NULL OR b.location_province ILIKE replace(replace(p_province,'%',''),'_',''))
   AND (p_type IS NULL OR f.affiliation_type = p_type)
 )
 SELECT r.*, count(*) OVER () FROM rows r
 WHERE p_sponsored IS NULL OR r.sponsored = p_sponsored
 ORDER BY r.business_name
 LIMIT least(greatest(p_limit,1),48) OFFSET greatest(p_offset,0);
$$;

GRANT EXECUTE ON FUNCTION public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer,text,text) TO anon, authenticated, service_role;

DROP FUNCTION public.org_list_members(uuid,uuid);

CREATE FUNCTION public.org_list_members(p_user uuid, p_org uuid)
RETURNS TABLE(affiliation_id uuid, business_id uuid, business_name text, category text, city text, business_status text,
 programme_name text, confirmed_at timestamptz, sponsorship_id uuid, sponsorship_status text, sponsor_type text, sponsorship_ends_at timestamptz,
 affiliation_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT f.id, b.id, b.business_name::text, b.category::text, b.location_city::text, b.status::text, pr.name, f.confirmed_at,
  s.id, s.status, s.sponsor_type, s.ends_at, f.affiliation_type
 FROM public.organisation_affiliations f JOIN public.businesses b ON b.id = f.business_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
 LEFT JOIN public.organisation_sponsorships s ON s.affiliation_id = f.id AND s.status IN ('active','waitlisted')
 WHERE f.organisation_id = p_org AND f.status = 'active'
 ORDER BY b.business_name LIMIT 2000;
END;
$$;

REVOKE ALL ON FUNCTION public.org_list_members(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_list_members(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.manage_commercial_contract(p_actor uuid, p_contract uuid, p_action text, p_values jsonb, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.commercial_contracts; nxt public.commercial_contracts; member_count integer; target uuid; ent uuid;
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
 ELSIF p_action = 'mark_paid' THEN
  IF length(btrim(COALESCE(p_values->>'reference',''))) < 3 THEN RAISE EXCEPTION 'Record the invoice or payment reference'; END IF;
  UPDATE public.commercial_contracts SET features = features || jsonb_build_object('invoiceReference', p_values->>'reference', 'paidAt', now()),
   updated_at = now() WHERE id = p_contract;
  UPDATE public.slot_entitlements SET payment_status = 'paid', updated_at = now() WHERE contract_id = p_contract;
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
  activation_limit_per_period = nxt.activation_limit_per_period, notes = nxt.notes,
  status = CASE WHEN nxt.status = 'ended' THEN 'expired' WHEN p_action = 'extend' THEN 'active' ELSE status END, updated_at = now()
 WHERE contract_id = p_contract RETURNING id INTO ent;
 IF ent IS NOT NULL AND p_action IN ('extend','end') THEN
  PERFORM public.apply_entitlement_expiry(ent, nxt.ends_at, 'Programme ended');
 END IF;
 PERFORM public.commercial_audit(p_actor,'programme_' || p_action,'commercial_contract',p_contract,to_jsonb(prev),to_jsonb(nxt),p_reason,
  COALESCE(p_values,'{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_programme_contract(p_actor uuid, p_user uuid, p_type text, p_values jsonb, p_reason text,
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
  COALESCE((cfg->>'startsAt')::timestamptz, now()),COALESCE((cfg->>'startsAt')::timestamptz, now()) + make_interval(days => days),
  COALESCE(cfg->'features','{}'::jsonb),cfg->>'notes',p_actor)
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
  IF n >= (public.event_limits(NEW.owner_id)->>'maxActive')::integer THEN
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


REVOKE ALL ON FUNCTION public.manage_commercial_contract(uuid,uuid,text,jsonb,text), public.grant_programme_contract(uuid,uuid,text,jsonb,text,boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_commercial_contract(uuid,uuid,text,jsonb,text), public.grant_programme_contract(uuid,uuid,text,jsonb,text,boolean)
TO service_role;

UPDATE public.commercial_settings SET value = value || '{"storageQuotaMb":500}'::jsonb,
 description = 'Media limits: photos/videos per paid post; upload size ceilings (cannot exceed 5 MB images, 50 MB videos); storage quota per account.'
WHERE key = 'media' AND NOT value ? 'storageQuotaMb';

UPDATE public.commercial_settings SET value = value || '{"rules":""}'::jsonb,
 description = 'Public introductory trial durations and extra rules shown with the trial policy. Capacity and toggles live in intro_trial_campaigns.'
WHERE key = 'trials' AND NOT value ? 'rules';

-- ── Start notices: public trial and invitation programmes ─────────────────
CREATE FUNCTION public.notify_trial_started() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.user_id IS NULL OR NEW.activated_at IS NULL
  OR (TG_OP = 'UPDATE' AND OLD.activated_at IS NOT NULL) THEN RETURN NULL; END IF;
 INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (NEW.user_id,'success',
  CASE WHEN NEW.admin_granted THEN 'Your free post is live' ELSE 'Your introductory trial has started' END,
  'Your post is visible' || COALESCE(' until ' || to_char(NEW.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY'),'')
   || '. Nothing is charged automatically; afterwards it stays saved in your dashboard.','/dashboard/listings');
 RETURN NULL;
END;
$$;
CREATE TRIGGER intro_trial_started_notice AFTER INSERT OR UPDATE OF activated_at ON public.intro_trial_claims
 FOR EACH ROW EXECUTE FUNCTION public.notify_trial_started();

CREATE FUNCTION public.notify_programme_started() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.user_id IS NULL OR NEW.status <> 'active'
  OR NEW.source NOT IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER') THEN RETURN NULL; END IF;
 INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (NEW.user_id,'success',
  CASE WHEN NEW.source = 'STRATEGIC_INDIVIDUAL' THEN 'Your VerifyMzansi Strategic Trial has started'
   ELSE 'Your Founding Commercial Partner programme has started' END,
  NEW.slot_capacity || ' active posting slot' || CASE WHEN NEW.slot_capacity = 1 THEN '' ELSE 's' END
   || ' until ' || to_char(NEW.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY')
   || '. Invitation only; it does not renew automatically.','/dashboard/listings');
 RETURN NULL;
END;
$$;
CREATE TRIGGER slot_entitlement_programme_started AFTER INSERT ON public.slot_entitlements
 FOR EACH ROW EXECUTE FUNCTION public.notify_programme_started();
REVOKE ALL ON FUNCTION public.notify_trial_started(), public.notify_programme_started() FROM PUBLIC, anon, authenticated;

-- ── Owner traffic sources (aggregate counts only, never viewer identities) ─
CREATE FUNCTION public.content_traffic_sources(p_user uuid, p_days integer DEFAULT 30)
RETURNS TABLE(traffic_source text, events bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH owned AS (
  SELECT 'listings'::text t, id FROM public.listings WHERE owner_id = p_user
  UNION ALL SELECT 'businesses', id FROM public.businesses WHERE owner_id = p_user
  UNION ALL SELECT 'promotions', id FROM public.promotions WHERE owner_id = p_user)
 SELECT COALESCE(e.traffic_source,'direct'), count(*)
 FROM public.analytics_events e JOIN owned o ON o.id = e.content_id AND o.t = e.content_table
 WHERE e.event_type = 'detail_view' AND e.created_at > now() - make_interval(days => least(greatest(p_days,1),90))
 GROUP BY 1 ORDER BY 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.content_traffic_sources(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_traffic_sources(uuid,integer) TO service_role;

-- ── Step-up verification: organisation representatives ────────────────────
-- Organisation administrators decide affiliations and sponsorship, so they must
-- hold VerifyMzansi identity verification (ORGANISATION_REPRESENTATIVE_VERIFIED).
CREATE FUNCTION public.require_verified_organisation_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.account_profiles
  WHERE user_id = NEW.user_id AND account_verification_status::text = 'verified') THEN
  RAISE EXCEPTION 'ORGANISATION_ADMIN_UNVERIFIED: Organisation administrators must complete VerifyMzansi identity verification';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER organisation_admins_require_verified BEFORE INSERT ON public.organisation_admins
 FOR EACH ROW EXECUTE FUNCTION public.require_verified_organisation_admin();
REVOKE ALL ON FUNCTION public.require_verified_organisation_admin() FROM PUBLIC, anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
