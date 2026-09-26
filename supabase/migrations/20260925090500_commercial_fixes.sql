-- Fixes found in review of the commercial model.
--   * Extending/ending contracts and sponsorships now moves live posts with
--     them (previously posts expired on the old date, or stayed public after
--     a contract ended).
--   * Sponsorships past their end date are closed so they stop consuming the
--     organisation's sponsored capacity; waiting-list members are promoted.
--   * Founding organisations get their own capped posting slots, shared with
--     their administrators; pilots can be extended.
--   * Partnership reports read the daily roll-up (raw events are kept 90 days).
--   * The trial offer reports the configured trial durations to the UI.
--   * Commercial settings that nothing enforced are removed.
BEGIN;

-- Move every live post held by an entitlement to a new expiry, or withdraw it.
CREATE FUNCTION public.apply_entitlement_expiry(p_entitlement uuid, p_expires timestamptz, p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; n integer := 0;
BEGIN
 UPDATE public.slot_entitlements SET expires_at = greatest(starts_at + interval '1 second', p_expires), updated_at = now()
 WHERE id = p_entitlement;
 FOR r IN SELECT content_table, content_id FROM public.slot_assignments
  WHERE entitlement_id = p_entitlement AND released_at IS NULL LOOP
  IF p_expires <= now() + interval '1 minute' THEN
   EXECUTE format('UPDATE public.%I SET status = ''expired'', status_reason = $2 WHERE id = $1 AND status = ''live''', r.content_table)
    USING r.content_id, p_reason;
  ELSE
   EXECUTE format($q$UPDATE public.%I p SET expires_at = least($2, COALESCE((to_jsonb(p)->>'end_date')::timestamptz, $2))
    WHERE id = $1 AND status = 'live'$q$, r.content_table) USING r.content_id, p_expires;
  END IF;
  n := n + 1;
 END LOOP;
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_entitlement_expiry(uuid,timestamptz,text) FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.organisation_lifecycle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; d integer; m integer; inserted integer; total integer := 0; r record;
BEGIN
 -- Lapsed sponsorships stop consuming capacity; the waiting list moves up.
 FOR r IN SELECT id FROM public.organisation_sponsorships WHERE status = 'active' AND ends_at <= now() LOOP
  PERFORM public.end_sponsorship_internal(r.id,'ended','Sponsorship period ended');
 END LOOP;
 FOR o IN SELECT * FROM public.organisations WHERE programme_status = 'founding_trial' AND trial_ends_at IS NOT NULL LOOP
  IF o.trial_ends_at <= now() THEN
   FOR r IN SELECT id FROM public.organisation_sponsorships WHERE organisation_id = o.id AND sponsor_type = 'VERIFYMZANSI_FOUNDING' AND status IN ('active','waitlisted') LOOP
    PERFORM public.end_sponsorship_internal(r.id,'ended','Founding pilot ended');
   END LOOP;
   UPDATE public.organisations SET programme_status = 'affiliation_only', updated_at = now() WHERE id = o.id;
   UPDATE public.commercial_contracts SET status = 'ended', updated_at = now() WHERE id = o.contract_id AND status = 'active';
   m := 0;
  ELSE
   d := ceil(extract(epoch FROM o.trial_ends_at - now()) / 86400)::integer;
   SELECT min(x) INTO m FROM jsonb_array_elements_text(COALESCE((SELECT value->'alertDays' FROM public.commercial_settings WHERE key = 'founding_organisation'),'[60,30,14,7]')) x(x)
    WHERE x::integer >= d;
   IF m IS NULL THEN CONTINUE; END IF;
  END IF;
  INSERT INTO public.organisation_notices(organisation_id,milestone) VALUES (o.id,m) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN
   INSERT INTO public.notifications(user_id,type,title,message,href)
   SELECT a.user_id,'info',CASE WHEN m = 0 THEN 'Founding pilot has ended' ELSE 'Founding pilot ends in ' || m || ' days' END,
    CASE WHEN m = 0 THEN 'Affiliations remain. Your Partnership Performance Report is ready; there is no automatic charge.'
     ELSE 'Review your Partnership Performance Report. The pilot does not renew or charge automatically.' END,
    '/dashboard/organisation/' || o.slug
   FROM public.organisation_admins a WHERE a.organisation_id = o.id;
   total := total + 1;
  END IF;
 END LOOP;
 RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_organisation(p_actor uuid, p_org uuid, p_action text, p_values jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.organisations; nxt public.organisations; c uuid; days integer; target uuid; n integer; r record; result jsonb := '{}'::jsonb;
 new_end timestamptz; own_slots integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Organisation management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.organisations WHERE id = p_org FOR UPDATE;
 IF p_action = 'activate_trial' THEN
  IF prev.programme_status NOT IN ('invited','ended','affiliation_only') THEN RAISE EXCEPTION 'Organisation already has an active programme'; END IF;
  days := COALESCE((p_values->>'durationDays')::integer, public.commercial_setting_int('founding_organisation','durationDays',180));
  INSERT INTO public.commercial_contracts(contract_type,organisation_id,title,slot_capacity,admin_limit,starts_at,ends_at,notes,created_by)
  VALUES ('FOUNDING_ORGANISATION',p_org,'Founding Organisation Programme — ' || prev.name,prev.sponsored_capacity,prev.admin_limit,
   now(),now() + make_interval(days => days),'Six-month promotional pilot at no platform fee. No automatic charge and no automatic free renewal.',p_actor)
  RETURNING id INTO c;
  UPDATE public.organisations SET programme_status = 'founding_trial', trial_starts_at = now(), trial_ends_at = now() + make_interval(days => days),
   contract_id = c, updated_at = now() WHERE id = p_org;
  DELETE FROM public.organisation_notices WHERE organisation_id = p_org;
  own_slots := COALESCE((p_values->>'ownSlots')::integer, public.commercial_setting_int('founding_organisation','ownSlots',10));
  IF own_slots > 0 THEN
   INSERT INTO public.slot_entitlements(organisation_id,source,contract_id,slot_capacity,activation_limit_per_period,
    activation_period_days,starts_at,expires_at,payment_status,granted_by,notes)
   VALUES (p_org,'FOUNDING_ORGANISATION',c,own_slots,own_slots * 2,30,now(),now() + make_interval(days => days),'not_required',p_actor,
    'Organisation posting slots during the founding pilot');
   INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by)
   SELECT e.id, a.user_id, p_actor FROM public.slot_entitlements e CROSS JOIN public.organisation_admins a
   WHERE e.contract_id = c AND a.organisation_id = p_org ON CONFLICT DO NOTHING;
  END IF;
 ELSIF p_action = 'extend_trial' THEN
  IF prev.programme_status <> 'founding_trial' THEN RAISE EXCEPTION 'Only an active founding pilot can be extended'; END IF;
  new_end := (p_values->>'endsAt')::timestamptz;
  IF new_end IS NULL OR new_end <= COALESCE(prev.trial_ends_at, now()) THEN RAISE EXCEPTION 'New end date must be after the current end date'; END IF;
  UPDATE public.organisations SET trial_ends_at = new_end, updated_at = now() WHERE id = p_org;
  UPDATE public.commercial_contracts SET ends_at = new_end, updated_at = now() WHERE id = prev.contract_id;
  FOR r IN SELECT id FROM public.slot_entitlements WHERE contract_id = prev.contract_id LOOP
   PERFORM public.apply_entitlement_expiry(r.id, new_end, 'Programme ended');
  END LOOP;
  FOR r IN SELECT s.id, s.slot_entitlement_id FROM public.organisation_sponsorships s
   WHERE s.organisation_id = p_org AND s.status = 'active' LOOP
   UPDATE public.organisation_sponsorships SET ends_at = new_end WHERE id = r.id;
   IF r.slot_entitlement_id IS NOT NULL THEN PERFORM public.apply_entitlement_expiry(r.slot_entitlement_id, new_end, 'Sponsorship ended'); END IF;
  END LOOP;
  DELETE FROM public.organisation_notices WHERE organisation_id = p_org;
 ELSIF p_action = 'suspend' THEN
  UPDATE public.organisations SET programme_status = 'suspended', updated_at = now() WHERE id = p_org;
  FOR r IN SELECT id FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status IN ('active','waitlisted') LOOP
   PERFORM public.end_sponsorship_internal(r.id,'ended','Organisation suspended');
  END LOOP;
 ELSIF p_action = 'reinstate' THEN
  UPDATE public.organisations SET programme_status = COALESCE(p_values->>'status','affiliation_only'), updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'end_trial' THEN
  FOR r IN SELECT id FROM public.organisation_sponsorships WHERE organisation_id = p_org AND sponsor_type = 'VERIFYMZANSI_FOUNDING' AND status IN ('active','waitlisted') LOOP
   PERFORM public.end_sponsorship_internal(r.id,'ended','Founding pilot ended');
  END LOOP;
  UPDATE public.commercial_contracts SET status = 'ended', ends_at = least(ends_at, now() + interval '1 second'), updated_at = now() WHERE id = prev.contract_id;
  FOR r IN SELECT id FROM public.slot_entitlements WHERE contract_id = prev.contract_id AND source = 'FOUNDING_ORGANISATION' LOOP
   PERFORM public.apply_entitlement_expiry(r.id, now(), 'Founding pilot ended');
   UPDATE public.slot_entitlements SET status = 'expired' WHERE id = r.id;
  END LOOP;
  UPDATE public.organisations SET programme_status = COALESCE(p_values->>'status','affiliation_only'),
   trial_ends_at = least(COALESCE(trial_ends_at, now()), now()), updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'convert_paid' THEN
  INSERT INTO public.commercial_contracts(contract_type,organisation_id,title,slot_capacity,admin_limit,price_cents,starts_at,ends_at,features,notes,created_by)
  VALUES ('ENTERPRISE_CUSTOM',p_org,COALESCE(p_values->>'title','Organisation Network — ' || prev.name),
   COALESCE((p_values->>'sponsoredCapacity')::integer, prev.sponsored_capacity),COALESCE((p_values->>'adminLimit')::integer, prev.admin_limit),
   COALESCE((p_values->>'priceCents')::integer,0),COALESCE((p_values->>'startsAt')::timestamptz, now()),(p_values->>'endsAt')::timestamptz,
   COALESCE(p_values->'features','{}'::jsonb),p_values->>'notes',p_actor) RETURNING id INTO c;
  UPDATE public.organisations SET programme_status = 'active_paid', contract_id = c,
   sponsored_capacity = COALESCE((p_values->>'sponsoredCapacity')::integer, sponsored_capacity),
   admin_limit = COALESCE((p_values->>'adminLimit')::integer, admin_limit), updated_at = now() WHERE id = p_org;
  new_end := (p_values->>'endsAt')::timestamptz;
  FOR r IN SELECT s.id, s.slot_entitlement_id FROM public.organisation_sponsorships s
   WHERE s.organisation_id = p_org AND s.status = 'active' AND s.sponsor_type = 'ORGANISATION' LOOP
   UPDATE public.organisation_sponsorships SET ends_at = new_end WHERE id = r.id;
   IF r.slot_entitlement_id IS NOT NULL THEN PERFORM public.apply_entitlement_expiry(r.slot_entitlement_id, new_end, 'Sponsorship ended'); END IF;
  END LOOP;
 ELSIF p_action = 'approve_logo' THEN
  IF prev.logo_url IS NULL THEN RAISE EXCEPTION 'Upload a logo before recording permission'; END IF;
  IF length(btrim(COALESCE(p_values->>'reference',''))) < 3 THEN RAISE EXCEPTION 'Record the written permission reference'; END IF;
  UPDATE public.organisations SET logo_permission_at = now(), logo_permission_by = p_actor,
   logo_permission_reference = p_values->>'reference', updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'revoke_logo' THEN
  UPDATE public.organisations SET logo_permission_at = NULL, logo_permission_by = NULL, updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'add_admin' THEN
  target := (p_values->>'userId')::uuid;
  SELECT count(*) INTO n FROM public.organisation_admins WHERE organisation_id = p_org;
  IF n >= prev.admin_limit THEN RAISE EXCEPTION 'ORGANISATION_ADMIN_LIMIT: Administrator limit reached'; END IF;
  INSERT INTO public.organisation_admins(organisation_id,user_id,role,added_by)
  VALUES (p_org,target,CASE WHEN n = 0 THEN 'owner' ELSE 'admin' END,p_actor) ON CONFLICT DO NOTHING;
  INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by)
  SELECT id, target, p_actor FROM public.slot_entitlements WHERE organisation_id = p_org AND source = 'FOUNDING_ORGANISATION'
  ON CONFLICT DO NOTHING;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (target,'info','Organisation administrator access',
   'You can now manage affiliation requests for ' || prev.name || '.','/dashboard/organisation/' || prev.slug);
 ELSIF p_action = 'remove_admin' THEN
  DELETE FROM public.organisation_admins WHERE organisation_id = p_org AND user_id = (p_values->>'userId')::uuid;
  DELETE FROM public.slot_entitlement_members m USING public.slot_entitlements e
  WHERE e.id = m.entitlement_id AND e.organisation_id = p_org AND e.source = 'FOUNDING_ORGANISATION'
   AND m.user_id = (p_values->>'userId')::uuid;
 ELSIF p_action = 'add_programme' THEN
  INSERT INTO public.organisation_programmes(organisation_id,slug,name,description)
  VALUES (p_org,p_values->>'slug',p_values->>'name',p_values->>'description');
 ELSIF p_action = 'update_programme' THEN
  UPDATE public.organisation_programmes SET name = COALESCE(p_values->>'name',name),
   description = CASE WHEN p_values ? 'description' THEN p_values->>'description' ELSE description END,
   active = COALESCE((p_values->>'active')::boolean,active)
  WHERE id = (p_values->>'programmeId')::uuid AND organisation_id = p_org;
 ELSIF p_action = 'note' THEN
  INSERT INTO public.organisation_notes(organisation_id,author_id,note) VALUES (p_org,p_actor,p_values->>'note');
 ELSIF p_action = 'set_capacity' THEN
  UPDATE public.organisations SET sponsored_capacity = (p_values->>'sponsoredCapacity')::integer, updated_at = now() WHERE id = p_org;
  result := jsonb_build_object('promoted', public.promote_sponsorship_waitlist(p_org));
 ELSIF p_action = 'upsert_showcase' THEN
  IF p_values ? 'showcaseId' THEN
   UPDATE public.programme_showcases SET title = COALESCE(p_values->>'title',title), placement = COALESCE(p_values->>'placement',placement),
    enabled = COALESCE((p_values->>'enabled')::boolean,enabled), starts_at = COALESCE((p_values->>'startsAt')::timestamptz,starts_at),
    ends_at = COALESCE((p_values->>'endsAt')::timestamptz,ends_at), max_cards = COALESCE((p_values->>'maxCards')::integer,max_cards),
    province = CASE WHEN p_values ? 'province' THEN nullif(p_values->>'province','') ELSE province END,
    city = CASE WHEN p_values ? 'city' THEN nullif(p_values->>'city','') ELSE city END,
    display_order = COALESCE((p_values->>'displayOrder')::integer,display_order),
    sponsored_only = COALESCE((p_values->>'sponsoredOnly')::boolean,sponsored_only), updated_at = now()
   WHERE id = (p_values->>'showcaseId')::uuid AND organisation_id = p_org;
  ELSE
   INSERT INTO public.programme_showcases(organisation_id,title,placement,enabled,starts_at,ends_at,max_cards,province,city,display_order,sponsored_only,created_by)
   VALUES (p_org,p_values->>'title',COALESCE(p_values->>'placement','home'),COALESCE((p_values->>'enabled')::boolean,false),
    COALESCE((p_values->>'startsAt')::timestamptz,now()),(p_values->>'endsAt')::timestamptz,COALESCE((p_values->>'maxCards')::integer,12),
    nullif(p_values->>'province',''),nullif(p_values->>'city',''),COALESCE((p_values->>'displayOrder')::integer,100),
    COALESCE((p_values->>'sponsoredOnly')::boolean,false),p_actor);
  END IF;
 ELSE RAISE EXCEPTION 'Unknown organisation action';
 END IF;
 SELECT * INTO nxt FROM public.organisations WHERE id = p_org;
 PERFORM public.commercial_audit(p_actor,'organisation_' || p_action,'organisation',p_org,to_jsonb(prev),to_jsonb(nxt),p_reason,COALESCE(p_values,'{}'::jsonb));
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.organisation_performance_report(p_user uuid, p_org uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
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
 -- Daily roll-up (kept indefinitely); raw events are purged after 90 days.
 -- Today's activity comes from raw events (not rolled up yet).
 ev AS (
  SELECT d.event_type, d.day::timestamptz AS created_at, d.content_id, d.events::bigint AS n
  FROM public.analytics_daily d JOIN content c ON c.id = d.content_id AND c.t = d.content_table
  WHERE d.day >= (p_from AT TIME ZONE 'Africa/Johannesburg')::date
   AND d.day <= least((p_to AT TIME ZONE 'Africa/Johannesburg')::date, (now() AT TIME ZONE 'Africa/Johannesburg')::date - 1)
  UNION ALL
  SELECT e.event_type, e.created_at, e.content_id, 1::bigint
  FROM public.analytics_events e JOIN content c ON c.id = e.content_id AND c.t = e.content_table
  WHERE e.created_at >= greatest(p_from, date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
   AND e.created_at <= p_to)
 SELECT jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'participatingBusinesses', (SELECT count(*) FROM members),
  'activeBusinesses', (SELECT count(*) FROM members WHERE status = 'live'),
  'sponsoredBusinesses', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active'),
  'totalListings', (SELECT count(*) FROM content WHERE t <> 'businesses'),
  'events', (SELECT COALESCE(jsonb_object_agg(event_type, n),'{}'::jsonb) FROM (SELECT event_type, sum(n)::bigint n FROM ev GROUP BY 1) x),
  'profileViews', (SELECT COALESCE(sum(ev.n),0) FROM ev JOIN members m ON m.id = ev.content_id WHERE ev.event_type = 'detail_view'),
  'topCategories', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category',category,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT category, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'topLocations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city',city,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT city, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'weeklyTrend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week',wk,'views',v,'contacts',c) ORDER BY wk),'[]'::jsonb)
    FROM (SELECT date_trunc('week',created_at)::date wk,
      COALESCE(sum(n) FILTER (WHERE event_type IN ('impression','detail_view')),0) v,
      COALESCE(sum(n) FILTER (WHERE event_type IN ('whatsapp_click','phone_click','website_click')),0) c
     FROM ev GROUP BY 1) x))
 INTO result;
 RETURN result;
END;
$$;

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
  'remaining',greatest(0,c.slot_limit-n),'launchEnabled',c.launch_enabled,
  'shortDays',public.intro_trial_days(7),'longDays',public.intro_trial_days(30));
END;
$$;


-- RLS fix: policies ran is_organisation_admin() as anon/authenticated, which
-- have no EXECUTE on it, so every public read of organisations failed. Use a
-- caller-scoped helper that only answers for the current user.
CREATE FUNCTION public.is_current_organisation_admin(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_organisation_admin(p_org, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_current_organisation_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_organisation_admin(uuid) TO anon, authenticated, service_role;

DROP POLICY "Public reads listed organisations" ON public.organisations;
CREATE POLICY "Public reads listed organisations" ON public.organisations FOR SELECT USING (
  public.organisation_is_listed(organisations)
  OR public.is_current_organisation_admin(id)
  OR public.has_any_role(ARRAY['admin','governance_controller']));
DROP POLICY "Public reads programmes of listed organisations" ON public.organisation_programmes;
CREATE POLICY "Public reads programmes of listed organisations" ON public.organisation_programmes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = organisation_id AND (public.organisation_is_listed(o)
   OR public.is_current_organisation_admin(o.id)))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
DROP POLICY "Organisation admins read own admin list" ON public.organisation_admins;
CREATE POLICY "Organisation admins read own admin list" ON public.organisation_admins FOR SELECT USING (
  public.is_current_organisation_admin(organisation_id) OR public.has_any_role(ARRAY['admin','governance_controller']));
DROP POLICY "Public reads active affiliations of listed organisations" ON public.organisation_affiliations;
CREATE POLICY "Public reads active affiliations of listed organisations" ON public.organisation_affiliations FOR SELECT USING (
  (status = 'active' AND EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = organisation_id AND public.organisation_is_listed(o)))
  OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_current_organisation_admin(organisation_id)
  OR public.has_any_role(ARRAY['admin','governance_controller']));
DROP POLICY "Owners and admins read sponsorships" ON public.organisation_sponsorships;
CREATE POLICY "Owners and admins read sponsorships" ON public.organisation_sponsorships FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_current_organisation_admin(organisation_id)
  OR public.has_any_role(ARRAY['admin','governance_controller']));

CREATE OR REPLACE FUNCTION public.update_plan_pricing(p_actor uuid, p_plan_id uuid, p_values jsonb, p_reason text) RETURNS void
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
  public = COALESCE((p_values->>'public')::boolean, public),
  -- Taking a plan off sale records when, so checkouts already in flight are honoured.
  retired_at = CASE
   WHEN (p_values->>'active')::boolean IS FALSE AND active THEN now()
   WHEN (p_values->>'active')::boolean IS TRUE THEN NULL
   ELSE retired_at END
 WHERE id = p_plan_id RETURNING * INTO nxt;
 IF nxt.price_cents < 0 OR nxt.price_cents > 100000000 THEN RAISE EXCEPTION 'Invalid price'; END IF;
 PERFORM public.commercial_audit(p_actor,'plan_pricing_updated','plan',p_plan_id,to_jsonb(prev),to_jsonb(nxt),p_reason);
END;
$$;

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
         -- The price quoted at checkout is honoured if an admin repriced the plan since.
         OR (v_plan.price_cents IS DISTINCT FROM v_payment.amount_cents
             AND (v_meta->>'price_cents')::integer IS DISTINCT FROM v_payment.amount_cents)
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

-- Settings that no code path enforced are removed; organisation own slots added.
UPDATE public.commercial_settings SET value = value - 'labels' - 'periodDays',
 description = 'Default fair-use activations per 30 days for sponsored members. Retail plans set their own limit.'
WHERE key = 'retail';
UPDATE public.commercial_settings SET value = value - 'storageQuotaMb',
 description = 'Media limits: photos/videos per paid post; upload size ceilings (cannot exceed platform limits of 5 MB images, 50 MB videos).'
WHERE key = 'media';
UPDATE public.commercial_settings SET value = value - 'partnerProgramme' - 'qualityScore' WHERE key = 'features';
UPDATE public.commercial_settings SET value = value || '{"ownSlots":10}'::jsonb WHERE key = 'founding_organisation' AND NOT value ? 'ownSlots';

REVOKE ALL ON FUNCTION public.update_plan_pricing(uuid,uuid,jsonb,text), public.manage_commercial_contract(uuid,uuid,text,jsonb,text), public.admin_manage_organisation(uuid,uuid,text,jsonb,text),
 public.organisation_lifecycle(), public.organisation_performance_report(uuid,uuid,timestamptz,timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_plan_pricing(uuid,uuid,jsonb,text), public.manage_commercial_contract(uuid,uuid,text,jsonb,text), public.admin_manage_organisation(uuid,uuid,text,jsonb,text),
 public.organisation_lifecycle(), public.organisation_performance_report(uuid,uuid,timestamptz,timestamptz)
TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
