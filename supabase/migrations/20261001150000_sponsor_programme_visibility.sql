-- Sponsor visibility and sponsor administration (Document 08, Phases 1-2).
--
-- 1. One eligibility function, public_sponsor_directory(), decides which
--    programme partners appear on the strip, the home section and /sponsors.
--    Logos only ever appear with recorded written permission.
-- 2. Admin toggles per sponsor: show on strip, show on home, display order.
-- 3. Sponsor-surface analytics (impressions, clicks, page views) feed the
--    sponsor's activity report.
-- 4. Email invitations for sponsor administrators: single use, 7 days, bound
--    to the invited email, stored as a SHA-256 hash only.
-- 5. Every administrator change notifies all administrators; the founding
--    pilot defaults to exactly 90 days; free time is never added instantly
--    (trial_extension_offers, next migration, replaces extend_trial).
BEGIN;

-- ── Visibility controls ────────────────────────────────────────────────
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS show_on_strip boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100 CHECK (display_order BETWEEN 0 AND 10000);

INSERT INTO public.commercial_settings(key, value, description)
VALUES ('sponsors', '{"stripMinLive":5}'::jsonb,
  'Minimum live supported businesses before a programme partner appears on the strip and home section')
ON CONFLICT (key) DO NOTHING;

-- Public fields only. Paid programmes first, then founding pilots, then the
-- admin-set order. Visibility flags are computed here so every surface
-- applies the same rule.
CREATE OR REPLACE FUNCTION public.public_sponsor_directory()
RETURNS TABLE(id uuid, slug text, name text, organisation_type text, service_area text, province text,
  logo_url text, programme_status text, live_businesses integer, accepting_applications boolean,
  places_available boolean, on_strip boolean, on_home boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH cfg AS (
  SELECT COALESCE((SELECT (value->>'organisationsPublic')::boolean FROM public.commercial_settings WHERE key = 'features'), true) AS enabled,
         public.commercial_setting_int('sponsors','stripMinLive',5) AS min_live),
 live AS (
  SELECT f.organisation_id, count(DISTINCT f.business_id)::integer AS n
  FROM public.organisation_affiliations f JOIN public.businesses b ON b.id = f.business_id
  WHERE f.status = 'active' AND b.status = 'live' AND (b.expires_at IS NULL OR b.expires_at > now())
  GROUP BY 1),
 used AS (
  SELECT organisation_id, count(*)::integer AS n FROM public.organisation_sponsorships WHERE status = 'active' GROUP BY 1)
 SELECT o.id, o.slug, o.name, o.organisation_type, o.service_area, o.province,
  CASE WHEN o.logo_permission_at IS NOT NULL THEN o.logo_url END,
  o.programme_status, COALESCE(l.n, 0), o.accepting_applications,
  COALESCE(u.n, 0) < o.sponsored_capacity,
  o.show_on_strip AND o.logo_permission_at IS NOT NULL AND o.logo_url IS NOT NULL AND COALESCE(l.n, 0) >= cfg.min_live,
  o.show_on_home AND o.logo_permission_at IS NOT NULL AND o.logo_url IS NOT NULL AND COALESCE(l.n, 0) >= cfg.min_live
 FROM public.organisations o CROSS JOIN cfg
 LEFT JOIN live l ON l.organisation_id = o.id
 LEFT JOIN used u ON u.organisation_id = o.id
 WHERE cfg.enabled AND o.is_public AND o.programme_status IN ('founding_trial','active_paid')
 ORDER BY CASE o.programme_status WHEN 'active_paid' THEN 0 ELSE 1 END, o.display_order, o.name
 LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.public_sponsor_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_sponsor_directory() TO anon, authenticated, service_role;

-- Sponsor showcase filters match Mzansi Business (adds subcategory).
DROP FUNCTION IF EXISTS public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer,text,text);
CREATE FUNCTION public.organisation_directory(p_org uuid, p_search text DEFAULT NULL, p_category text DEFAULT NULL,
 p_city text DEFAULT NULL, p_programme uuid DEFAULT NULL, p_sponsored boolean DEFAULT NULL, p_limit integer DEFAULT 24,
 p_offset integer DEFAULT 0, p_province text DEFAULT NULL, p_type text DEFAULT NULL, p_subcategory text DEFAULT NULL)
RETURNS TABLE(business_id uuid, business_name text, slug text, category text, subcategory text, city text, province text,
 logo_url text, cover_image text, programme_name text, confirmed_at timestamptz, sponsored boolean,
 affiliation_type text, affiliation_label text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH rows AS (
  SELECT b.id, b.business_name::text AS business_name, b.slug::text AS slug, b.category::text AS category, b.subcategory::text AS subcategory,
   b.location_city::text AS city, b.location_province::text AS province, b.logo_url::text AS logo_url,
   (to_jsonb(b)->>'cover_photo') AS cover_image, pr.name AS programme_name, f.confirmed_at,
   EXISTS (SELECT 1 FROM public.organisation_sponsorships s WHERE s.affiliation_id = f.id AND s.status = 'active'
           AND s.starts_at <= now() AND s.ends_at > now()) AS sponsored,
   f.affiliation_type, public.affiliation_label(f.affiliation_type, o.affiliation_wording) AS affiliation_label
  FROM public.organisation_affiliations f
  JOIN public.organisations o ON o.id = f.organisation_id
  JOIN public.businesses b ON b.id = f.business_id
  LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
  WHERE f.organisation_id = p_org AND f.status = 'active' AND public.organisation_is_listed(o)
   AND b.status = 'live' AND (b.expires_at IS NULL OR b.expires_at > now())
   AND (p_search IS NULL OR b.business_name ILIKE '%' || replace(replace(p_search,'%',''),'_','') || '%')
   AND (p_category IS NULL OR b.category::text = p_category)
   AND (p_subcategory IS NULL OR b.subcategory::text = p_subcategory)
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
REVOKE ALL ON FUNCTION public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer,text,text,text)
 TO anon, authenticated, service_role;

-- ── Sponsor-surface analytics ──────────────────────────────────────────
ALTER TABLE public.analytics_events DROP CONSTRAINT IF EXISTS analytics_events_event_type_check;
ALTER TABLE public.analytics_events ADD CONSTRAINT analytics_events_event_type_check CHECK (event_type IN ('impression','detail_view',
  'whatsapp_click','phone_click','website_click','share','save','search_appearance','homepage_appearance','showroom_appearance',
  'organisation_directory_appearance','sponsor_click'));

CREATE OR REPLACE FUNCTION public.organisation_performance_report(p_user uuid, p_org uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  UNION ALL SELECT 'promotions', p.id, p.owner_id FROM public.promotions p WHERE p.owner_id IN (SELECT owner_id FROM members)
  -- The sponsor's own strip, home tile, index card and showcase page.
  UNION ALL SELECT 'organisations', p_org, NULL::uuid),
 -- Daily roll-up (kept indefinitely); raw events are purged after 90 days.
 -- Today's activity comes from raw events (not rolled up yet).
 ev AS (
  SELECT d.content_table, d.event_type, d.day::timestamptz AS created_at, d.content_id, d.events::bigint AS n
  FROM public.analytics_daily d JOIN content c ON c.id = d.content_id AND c.t = d.content_table
  WHERE d.day >= (p_from AT TIME ZONE 'Africa/Johannesburg')::date
   AND d.day <= least((p_to AT TIME ZONE 'Africa/Johannesburg')::date, (now() AT TIME ZONE 'Africa/Johannesburg')::date - 1)
  UNION ALL
  SELECT e.content_table, e.event_type, e.created_at, e.content_id, 1::bigint
  FROM public.analytics_events e JOIN content c ON c.id = e.content_id AND c.t = e.content_table
  WHERE e.created_at >= greatest(p_from, date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg')
   AND e.created_at <= p_to),
 member_ev AS (SELECT * FROM ev WHERE content_table <> 'organisations'),
 sponsor_ev AS (SELECT * FROM ev WHERE content_table = 'organisations')
 SELECT jsonb_build_object(
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'participatingBusinesses', (SELECT count(*) FROM members),
  'activeBusinesses', (SELECT count(*) FROM members WHERE status = 'live'),
  'sponsoredBusinesses', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active'),
  'totalListings', (SELECT count(*) FROM content WHERE t NOT IN ('businesses','organisations')),
  'events', (SELECT COALESCE(jsonb_object_agg(event_type, n),'{}'::jsonb) FROM (SELECT event_type, sum(n)::bigint n FROM member_ev GROUP BY 1) x),
  'profileViews', (SELECT COALESCE(sum(member_ev.n),0) FROM member_ev JOIN members m ON m.id = member_ev.content_id WHERE member_ev.event_type = 'detail_view'),
  'sponsorVisibility', jsonb_build_object(
    'impressions', (SELECT COALESCE(sum(n),0) FROM sponsor_ev WHERE event_type = 'impression'),
    'clicks', (SELECT COALESCE(sum(n),0) FROM sponsor_ev WHERE event_type = 'sponsor_click'),
    'pageViews', (SELECT COALESCE(sum(n),0) FROM sponsor_ev WHERE event_type = 'detail_view'),
    -- Per-surface split is only available for the last 90 days of raw events.
    'bySurface', (SELECT COALESCE(jsonb_object_agg(surface, jsonb_build_object('impressions', i, 'clicks', c, 'views', v)),'{}'::jsonb)
      FROM (SELECT COALESCE(surface,'other') AS surface,
        count(*) FILTER (WHERE event_type = 'impression') i, count(*) FILTER (WHERE event_type = 'sponsor_click') c,
        count(*) FILTER (WHERE event_type = 'detail_view') v
       FROM public.analytics_events WHERE content_table = 'organisations' AND content_id = p_org
        AND created_at BETWEEN p_from AND p_to GROUP BY 1) s)),
  'topCategories', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category',category,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT category, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'topLocations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('city',city,'businesses',n) ORDER BY n DESC),'[]'::jsonb)
    FROM (SELECT city, count(*) n FROM members GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
  'weeklyTrend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('week',wk,'views',v,'contacts',c) ORDER BY wk),'[]'::jsonb)
    FROM (SELECT date_trunc('week',created_at)::date wk,
      COALESCE(sum(n) FILTER (WHERE event_type IN ('impression','detail_view')),0) v,
      COALESCE(sum(n) FILTER (WHERE event_type IN ('whatsapp_click','phone_click','website_click')),0) c
     FROM member_ev GROUP BY 1) x))
 INTO result;
 RETURN result;
END;
$function$;

-- ── Administrator notices ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_organisation_admins(p_org uuid, p_title text, p_message text, p_except uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 INSERT INTO public.notifications(user_id,type,title,message,href)
 SELECT a.user_id, 'info', p_title, p_message, '/dashboard/organisation/' || o.slug
 FROM public.organisation_admins a JOIN public.organisations o ON o.id = a.organisation_id
 WHERE a.organisation_id = p_org AND a.user_id IS DISTINCT FROM p_except;
$$;

CREATE OR REPLACE FUNCTION public.organisation_admin_label(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT COALESCE(nullif(btrim((SELECT display_name FROM public.account_profiles WHERE user_id = p_user)),''), 'An administrator');
$$;

-- Owner hand-over: a programme always keeps one owner while it has admins.
CREATE OR REPLACE FUNCTION public.ensure_organisation_owner(p_org uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 UPDATE public.organisation_admins SET role = 'owner'
 WHERE organisation_id = p_org AND NOT EXISTS (SELECT 1 FROM public.organisation_admins WHERE organisation_id = p_org AND role = 'owner')
  AND user_id = (SELECT user_id FROM public.organisation_admins WHERE organisation_id = p_org ORDER BY created_at, user_id LIMIT 1);
$$;

-- ── Sponsor administrator invitations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organisation_admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 5 AND 254 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organisation_admin_invites_open_key ON public.organisation_admin_invites(organisation_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
-- Service role only: no policies, no API grants.
ALTER TABLE public.organisation_admin_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organisation_admin_invites FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.organisation_open_seats(p_org uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT o.admin_limit
  - (SELECT count(*) FROM public.organisation_admins WHERE organisation_id = p_org)::integer
  - (SELECT count(*) FROM public.organisation_admin_invites
     WHERE organisation_id = p_org AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::integer
 FROM public.organisations o WHERE o.id = p_org;
$$;

-- Creates (or re-issues) an invitation. The caller generates the token and
-- emails it; only the hash reaches the database.
CREATE OR REPLACE FUNCTION public.admin_invite_organisation_admin(p_actor uuid, p_org uuid, p_email text, p_token_hash text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; e text := lower(btrim(COALESCE(p_email,''))); inv public.organisation_admin_invites;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Organisation management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT o FROM public.organisations WHERE id = p_org FOR UPDATE;
 IF o.programme_status IN ('suspended','ended') THEN RAISE EXCEPTION 'ORGANISATION_INACTIVE: This programme is not active'; END IF;
 IF EXISTS (SELECT 1 FROM public.organisation_admins a JOIN auth.users u ON u.id = a.user_id
   WHERE a.organisation_id = p_org AND lower(u.email) = e) THEN
  RAISE EXCEPTION 'ORGANISATION_ADMIN_EXISTS: This person is already an administrator'; END IF;
 -- Re-inviting the same address replaces its open invitation (new link, old link revoked).
 UPDATE public.organisation_admin_invites SET revoked_at = now(), revoked_by = p_actor
 WHERE organisation_id = p_org AND email = e AND accepted_at IS NULL AND revoked_at IS NULL;
 IF public.organisation_open_seats(p_org) <= 0 THEN
  RAISE EXCEPTION 'ORGANISATION_ADMIN_LIMIT: Administrator limit reached'; END IF;
 INSERT INTO public.organisation_admin_invites(organisation_id,email,token_hash,invited_by,expires_at)
 VALUES (p_org, e, p_token_hash, p_actor, now() + interval '7 days') RETURNING * INTO inv;
 PERFORM public.commercial_audit(p_actor,'organisation_admin_invited','organisation',p_org,NULL,
  jsonb_build_object('inviteId',inv.id,'expiresAt',inv.expires_at),p_reason,jsonb_build_object('email',e));
 RETURN jsonb_build_object('inviteId',inv.id,'expiresAt',inv.expires_at,'organisationName',o.name,'organisationSlug',o.slug);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_organisation_invite(p_actor uuid, p_invite uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE inv public.organisation_admin_invites;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Organisation management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 UPDATE public.organisation_admin_invites SET revoked_at = now(), revoked_by = p_actor
 WHERE id = p_invite AND accepted_at IS NULL AND revoked_at IS NULL RETURNING * INTO inv;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'Open invitation not found'; END IF;
 PERFORM public.commercial_audit(p_actor,'organisation_admin_invite_revoked','organisation',inv.organisation_id,NULL,
  jsonb_build_object('inviteId',inv.id),p_reason);
END;
$$;

-- What the invite page may show before the person accepts.
CREATE OR REPLACE FUNCTION public.organisation_invite_preview(p_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT jsonb_build_object('organisationName', o.name, 'organisationSlug', o.slug, 'email', i.email, 'expiresAt', i.expires_at,
  'status', CASE WHEN i.accepted_at IS NOT NULL THEN 'used' WHEN i.revoked_at IS NOT NULL THEN 'revoked'
   WHEN i.expires_at <= now() THEN 'expired' WHEN o.programme_status IN ('suspended','ended') THEN 'inactive' ELSE 'open' END)
 FROM public.organisation_admin_invites i JOIN public.organisations o ON o.id = i.organisation_id
 WHERE i.token_hash = p_token_hash;
$$;

CREATE OR REPLACE FUNCTION public.accept_organisation_admin_invite(p_user uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE inv public.organisation_admin_invites; o public.organisations; n integer; r text; who text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 -- Lock the programme before the invitation, in the same order as
 -- admin_invite_organisation_admin, so concurrent invite/accept cannot deadlock.
 SELECT * INTO inv FROM public.organisation_admin_invites WHERE token_hash = p_token_hash;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'ORGANISATION_INVITE_INVALID: This invitation link is no longer valid'; END IF;
 PERFORM 1 FROM public.organisations WHERE id = inv.organisation_id FOR UPDATE;
 SELECT * INTO inv FROM public.organisation_admin_invites WHERE id = inv.id FOR UPDATE;
 IF inv.revoked_at IS NOT NULL OR inv.accepted_at IS NOT NULL OR inv.expires_at <= now() THEN
  RAISE EXCEPTION 'ORGANISATION_INVITE_INVALID: This invitation link is no longer valid'; END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user AND lower(email) = inv.email) THEN
  RAISE EXCEPTION 'ORGANISATION_INVITE_EMAIL: Sign in with the email address the invitation was sent to'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.account_profiles WHERE user_id = p_user AND account_verification_status::text = 'verified') THEN
  RAISE EXCEPTION 'ORGANISATION_ADMIN_UNVERIFIED: Complete VerifyMzansi identity verification before accepting'; END IF;
 SELECT * INTO STRICT o FROM public.organisations WHERE id = inv.organisation_id;
 IF o.programme_status IN ('suspended','ended') THEN RAISE EXCEPTION 'ORGANISATION_INACTIVE: This programme is not active'; END IF;
 IF EXISTS (SELECT 1 FROM public.organisation_admins WHERE organisation_id = o.id AND user_id = p_user) THEN
  UPDATE public.organisation_admin_invites SET accepted_at = now(), accepted_by = p_user WHERE id = inv.id;
  RETURN jsonb_build_object('organisationSlug', o.slug, 'alreadyAdmin', true);
 END IF;
 SELECT count(*) INTO n FROM public.organisation_admins WHERE organisation_id = o.id;
 IF n >= o.admin_limit THEN RAISE EXCEPTION 'ORGANISATION_ADMIN_LIMIT: Administrator limit reached'; END IF;
 r := CASE WHEN n = 0 THEN 'owner' ELSE 'admin' END;
 INSERT INTO public.organisation_admins(organisation_id,user_id,role,added_by) VALUES (o.id,p_user,r,inv.invited_by);
 INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by)
 SELECT id, p_user, inv.invited_by FROM public.slot_entitlements WHERE organisation_id = o.id AND source = 'FOUNDING_ORGANISATION'
 ON CONFLICT DO NOTHING;
 UPDATE public.organisation_admin_invites SET accepted_at = now(), accepted_by = p_user WHERE id = inv.id;
 who := public.organisation_admin_label(p_user);
 PERFORM public.notify_organisation_admins(o.id,'Administrator added', who || ' is now an administrator (' || r || ') of ' || o.name || '.');
 PERFORM public.commercial_audit(p_user,'organisation_admin_invite_accepted','organisation',o.id,NULL,
  jsonb_build_object('inviteId',inv.id,'role',r),'Accepted administrator invitation');
 RETURN jsonb_build_object('organisationSlug', o.slug, 'role', r);
END;
$$;

-- ── Supported business goes live / stops being live ───────────────────
CREATE OR REPLACE FUNCTION public.notify_sponsor_member_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW.status::text = 'live' OR OLD.status::text = 'live' THEN
  INSERT INTO public.notifications(user_id,type,title,message,href)
  SELECT a.user_id, 'info',
   CASE WHEN NEW.status::text = 'live' THEN 'A supported business is live' ELSE 'A supported business is no longer live' END,
   COALESCE(NEW.business_name::text,'A business') || CASE WHEN NEW.status::text = 'live'
    THEN ' is now visible in your programme showcase.' ELSE ' is no longer visible (' || replace(NEW.status::text,'_',' ') || ').' END,
   '/dashboard/organisation/' || o.slug
  FROM public.organisation_sponsorships s
  JOIN public.organisations o ON o.id = s.organisation_id
  JOIN public.organisation_admins a ON a.organisation_id = o.id AND a.role = 'owner'
  WHERE s.business_id = NEW.id AND s.status = 'active';
 END IF;
 RETURN NULL;
END;
$$;
-- The trigger runs on every business status change: keep its lookup indexed.
CREATE INDEX IF NOT EXISTS idx_organisation_sponsorships_business_active
  ON public.organisation_sponsorships(business_id) WHERE status = 'active';
DROP TRIGGER IF EXISTS trg_businesses_sponsor_status ON public.businesses;
CREATE TRIGGER trg_businesses_sponsor_status AFTER UPDATE OF status ON public.businesses
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.notify_sponsor_member_status();

-- ── Admin: profile fields incl. visibility toggles ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_upsert_organisation(p_actor uuid, p_id uuid, p_values jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE prev public.organisations; nxt public.organisations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Organisation management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.organisations(slug,name,organisation_type,description,programme_description,service_area,province,
   website,public_email,public_phone,sponsored_capacity,admin_limit,created_by)
  VALUES (p_values->>'slug',p_values->>'name',COALESCE(p_values->>'organisationType','other'),p_values->>'description',
   p_values->>'programmeDescription',p_values->>'serviceArea',p_values->>'province',nullif(p_values->>'website',''),
   nullif(p_values->>'publicEmail',''),nullif(p_values->>'publicPhone',''),
   COALESCE((p_values->>'sponsoredCapacity')::integer, public.commercial_setting_int('founding_organisation','sponsoredCapacity',25)),
   COALESCE((p_values->>'adminLimit')::integer, public.commercial_setting_int('founding_organisation','adminLimit',3)),p_actor)
  RETURNING * INTO nxt;
 ELSE
  SELECT * INTO STRICT prev FROM public.organisations WHERE id = p_id FOR UPDATE;
  UPDATE public.organisations SET
   slug = COALESCE(p_values->>'slug', slug), name = COALESCE(p_values->>'name', name),
   organisation_type = COALESCE(p_values->>'organisationType', organisation_type),
   description = CASE WHEN p_values ? 'description' THEN p_values->>'description' ELSE description END,
   programme_description = CASE WHEN p_values ? 'programmeDescription' THEN p_values->>'programmeDescription' ELSE programme_description END,
   service_area = CASE WHEN p_values ? 'serviceArea' THEN p_values->>'serviceArea' ELSE service_area END,
   province = CASE WHEN p_values ? 'province' THEN p_values->>'province' ELSE province END,
   website = CASE WHEN p_values ? 'website' THEN nullif(p_values->>'website','') ELSE website END,
   public_email = CASE WHEN p_values ? 'publicEmail' THEN nullif(p_values->>'publicEmail','') ELSE public_email END,
   public_phone = CASE WHEN p_values ? 'publicPhone' THEN nullif(p_values->>'publicPhone','') ELSE public_phone END,
   logo_url = CASE WHEN p_values ? 'logoUrl' THEN nullif(p_values->>'logoUrl','') ELSE logo_url END,
   -- A new logo file needs fresh written permission.
   logo_permission_at = CASE WHEN p_values ? 'logoUrl' AND nullif(p_values->>'logoUrl','') IS DISTINCT FROM logo_url THEN NULL ELSE logo_permission_at END,
   affiliation_wording = COALESCE(p_values->>'affiliationWording', affiliation_wording),
   sponsorship_wording = COALESCE(p_values->>'sponsorshipWording', sponsorship_wording),
   sponsored_capacity = COALESCE((p_values->>'sponsoredCapacity')::integer, sponsored_capacity),
   admin_limit = COALESCE((p_values->>'adminLimit')::integer, admin_limit),
   is_public = COALESCE((p_values->>'isPublic')::boolean, is_public),
   accepting_applications = COALESCE((p_values->>'acceptingApplications')::boolean, accepting_applications),
   show_on_strip = COALESCE((p_values->>'showOnStrip')::boolean, show_on_strip),
   show_on_home = COALESCE((p_values->>'showOnHome')::boolean, show_on_home),
   display_order = COALESCE((p_values->>'displayOrder')::integer, display_order),
   updated_at = now()
  WHERE id = p_id RETURNING * INTO nxt;
  IF nxt.sponsored_capacity IS DISTINCT FROM prev.sponsored_capacity THEN
   PERFORM public.notify_organisation_admins(p_id,'Programme capacity changed',
    'Supported places for ' || nxt.name || ' changed from ' || prev.sponsored_capacity || ' to ' || nxt.sponsored_capacity || '.');
  END IF;
 END IF;
 PERFORM public.commercial_audit(p_actor,CASE WHEN p_id IS NULL THEN 'organisation_created' ELSE 'organisation_updated' END,
  'organisation',nxt.id,to_jsonb(prev),to_jsonb(nxt),p_reason);
 RETURN nxt.id;
END;
$function$;

-- ── Admin: lifecycle actions ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_manage_organisation(p_actor uuid, p_org uuid, p_action text, p_values jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE prev public.organisations; nxt public.organisations; c uuid; days integer; target uuid; n integer; r record; result jsonb := '{}'::jsonb;
 new_end timestamptz; own_slots integer; removed_role text; who text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Organisation management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.organisations WHERE id = p_org FOR UPDATE;
 IF p_action = 'activate_trial' THEN
  IF prev.programme_status NOT IN ('invited','ended','affiliation_only') THEN RAISE EXCEPTION 'Organisation already has an active programme'; END IF;
  -- Founding packages are exactly 90 days from the recorded activation (Document 03 §6).
  days := COALESCE((p_values->>'durationDays')::integer, public.commercial_setting_int('founding_organisation','durationDays',90));
  INSERT INTO public.commercial_contracts(contract_type,organisation_id,title,slot_capacity,admin_limit,starts_at,ends_at,notes,created_by)
  VALUES ('FOUNDING_ORGANISATION',p_org,'Founding Organisation Programme — ' || prev.name,prev.sponsored_capacity,prev.admin_limit,
   now(),now() + make_interval(days => days),
   days || '-day founding pilot at no platform fee. No automatic charge and no automatic free renewal.',p_actor)
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
  -- Free time is only added through a consented extension offer.
  RAISE EXCEPTION 'TRIAL_EXTENSION_OFFER_REQUIRED: Offer an extension from Admin › Trials; it applies only after the programme accepts';
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
  PERFORM public.notify_organisation_admins(p_org,'Programme converted to paid',
   prev.name || ' is now a paid programme until ' || to_char(new_end AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST.');
 ELSIF p_action = 'approve_logo' THEN
  IF prev.logo_url IS NULL THEN RAISE EXCEPTION 'Upload a logo before recording permission'; END IF;
  IF length(btrim(COALESCE(p_values->>'reference',''))) < 3 THEN RAISE EXCEPTION 'Record the written permission reference'; END IF;
  UPDATE public.organisations SET logo_permission_at = now(), logo_permission_by = p_actor,
   logo_permission_reference = p_values->>'reference', updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'revoke_logo' THEN
  UPDATE public.organisations SET logo_permission_at = NULL, logo_permission_by = NULL, updated_at = now() WHERE id = p_org;
 ELSIF p_action = 'add_admin' THEN
  target := (p_values->>'userId')::uuid;
  IF EXISTS (SELECT 1 FROM public.organisation_admins WHERE organisation_id = p_org AND user_id = target) THEN
   RAISE EXCEPTION 'ORGANISATION_ADMIN_EXISTS: This person is already an administrator'; END IF;
  -- Open invitations hold seats too.
  IF public.organisation_open_seats(p_org) <= 0 THEN RAISE EXCEPTION 'ORGANISATION_ADMIN_LIMIT: Administrator limit reached'; END IF;
  SELECT count(*) INTO n FROM public.organisation_admins WHERE organisation_id = p_org;
  INSERT INTO public.organisation_admins(organisation_id,user_id,role,added_by)
  VALUES (p_org,target,CASE WHEN n = 0 THEN 'owner' ELSE 'admin' END,p_actor);
  INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by)
  SELECT id, target, p_actor FROM public.slot_entitlements WHERE organisation_id = p_org AND source = 'FOUNDING_ORGANISATION'
  ON CONFLICT DO NOTHING;
  who := public.organisation_admin_label(target);
  PERFORM public.notify_organisation_admins(p_org,'Administrator added',
   who || ' can now manage applications for ' || prev.name || '.');
 ELSIF p_action = 'remove_admin' THEN
  target := (p_values->>'userId')::uuid;
  who := public.organisation_admin_label(target);
  DELETE FROM public.organisation_admins WHERE organisation_id = p_org AND user_id = target RETURNING role INTO removed_role;
  IF removed_role IS NULL THEN RAISE EXCEPTION 'Administrator not found'; END IF;
  DELETE FROM public.slot_entitlement_members m USING public.slot_entitlements e
  WHERE e.id = m.entitlement_id AND e.organisation_id = p_org AND e.source = 'FOUNDING_ORGANISATION'
   AND m.user_id = target;
  PERFORM public.ensure_organisation_owner(p_org);
  INSERT INTO public.notifications(user_id,type,title,message,href)
  VALUES (target,'info','Administrator access removed','You are no longer an administrator of ' || prev.name || '.','/dashboard');
  PERFORM public.notify_organisation_admins(p_org,'Administrator removed',
   who || ' is no longer an administrator of ' || prev.name || '.');
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
  PERFORM public.notify_organisation_admins(p_org,'Programme capacity changed',
   'Supported places for ' || prev.name || ' changed from ' || prev.sponsored_capacity || ' to ' || (p_values->>'sponsoredCapacity') || '.');
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
$function$;

REVOKE ALL ON FUNCTION public.notify_organisation_admins(uuid,text,text,uuid), public.organisation_admin_label(uuid),
 public.ensure_organisation_owner(uuid), public.organisation_open_seats(uuid),
 public.admin_invite_organisation_admin(uuid,uuid,text,text,text), public.admin_revoke_organisation_invite(uuid,uuid,text),
 public.organisation_invite_preview(text), public.accept_organisation_admin_invite(uuid,text),
 public.notify_sponsor_member_status()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organisation_open_seats(uuid),
 public.admin_invite_organisation_admin(uuid,uuid,text,text,text), public.admin_revoke_organisation_invite(uuid,uuid,text),
 public.organisation_invite_preview(text), public.accept_organisation_admin_invite(uuid,text)
TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
