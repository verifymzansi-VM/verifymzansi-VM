-- Organisations, affiliation and sponsorship (Founding Organisation Programme).
-- Affiliation ("this business participates in our programme") and sponsorship
-- ("someone pays for this business's visibility") are separate records.
-- Organisations never touch VerifyMzansi verification, moderation or ranking,
-- and never see identity documents: applications are read through RPCs that
-- return a fixed, minimal field set.
BEGIN;

CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  organisation_type text NOT NULL DEFAULT 'other' CHECK (organisation_type IN ('municipality','government_department',
   'led_programme','chamber_of_commerce','tourism_association','incubator','accelerator','enterprise_development','ngo',
   'supplier_development','mall','business_association','cooperative','professional_body','university_tvet','other')),
  logo_url text,
  logo_permission_at timestamptz,
  logo_permission_by uuid,
  logo_permission_reference text,
  description text,
  programme_description text,
  service_area text,
  province text,
  website text CHECK (website IS NULL OR website ~* '^https://'),
  public_email text,
  public_phone text,
  programme_status text NOT NULL DEFAULT 'invited' CHECK (programme_status IN
   ('invited','founding_trial','active_paid','affiliation_only','suspended','ended')),
  is_public boolean NOT NULL DEFAULT false,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  affiliation_wording text NOT NULL DEFAULT 'Programme Participant' CHECK (length(affiliation_wording) BETWEEN 3 AND 60),
  sponsorship_wording text NOT NULL DEFAULT 'Supported by' CHECK (length(sponsorship_wording) BETWEEN 3 AND 60),
  sponsored_capacity integer NOT NULL DEFAULT 50 CHECK (sponsored_capacity BETWEEN 0 AND 100000),
  admin_limit integer NOT NULL DEFAULT 3 CHECK (admin_limit BETWEEN 1 AND 50),
  accepting_applications boolean NOT NULL DEFAULT true,
  contract_id uuid REFERENCES public.commercial_contracts(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organisation_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, slug)
);

CREATE TABLE public.organisation_admins (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, user_id)
);
CREATE INDEX idx_organisation_admins_user ON public.organisation_admins(user_id);

CREATE TABLE public.organisation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organisation_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES public.organisation_programmes(id) ON DELETE SET NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  member_reference text CHECK (member_reference IS NULL OR length(member_reference) <= 120),
  consent_fields jsonb NOT NULL,
  consented_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','more_info_required','approved','declined','withdrawn')),
  info_request text,
  info_response text,
  decision_by uuid,
  decision_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organisation_applications_open_key ON public.organisation_applications(organisation_id, business_id)
  WHERE status IN ('submitted','more_info_required');
CREATE INDEX idx_organisation_applications_org ON public.organisation_applications(organisation_id, status, created_at DESC);

CREATE TABLE public.organisation_affiliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES public.organisation_programmes(id) ON DELETE SET NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.organisation_applications(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','ended')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organisation_affiliations_active_key ON public.organisation_affiliations(organisation_id, business_id) WHERE status = 'active';
CREATE INDEX idx_organisation_affiliations_business ON public.organisation_affiliations(business_id) WHERE status = 'active';

CREATE TABLE public.organisation_sponsorships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  affiliation_id uuid NOT NULL REFERENCES public.organisation_affiliations(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sponsor_type text NOT NULL CHECK (sponsor_type IN ('VERIFYMZANSI_FOUNDING','ORGANISATION')),
  status text NOT NULL CHECK (status IN ('active','waitlisted','ended','revoked')),
  starts_at timestamptz,
  ends_at timestamptz,
  slot_entitlement_id uuid REFERENCES public.slot_entitlements(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text
);
CREATE UNIQUE INDEX organisation_sponsorships_open_key ON public.organisation_sponsorships(affiliation_id) WHERE status IN ('active','waitlisted');
CREATE INDEX idx_organisation_sponsorships_org ON public.organisation_sponsorships(organisation_id, status, created_at);

CREATE TABLE public.organisation_notices (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  milestone integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, milestone)
);

CREATE TABLE public.programme_showcases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES public.organisation_programmes(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  placement text NOT NULL DEFAULT 'home' CHECK (placement IN ('home','business','tourism','market')),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  max_cards integer NOT NULL DEFAULT 12 CHECK (max_cards BETWEEN 1 AND 48),
  province text,
  city text,
  display_order integer NOT NULL DEFAULT 100,
  sponsored_only boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

ALTER TABLE public.slot_entitlements ADD CONSTRAINT slot_entitlements_organisation_fk
  FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;
ALTER TABLE public.slot_entitlements ADD CONSTRAINT slot_entitlements_sponsorship_fk
  FOREIGN KEY (sponsorship_id) REFERENCES public.organisation_sponsorships(id) ON DELETE SET NULL;
ALTER TABLE public.commercial_contracts ADD CONSTRAINT commercial_contracts_organisation_fk
  FOREIGN KEY (organisation_id) REFERENCES public.organisations(id) ON DELETE CASCADE;

-- ── Access helpers ───────────────────────────────────────────────────────
CREATE FUNCTION public.is_organisation_admin(p_org uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.organisation_admins a JOIN public.organisations o ON o.id = a.organisation_id
  WHERE a.organisation_id = p_org AND a.user_id = p_user AND o.programme_status <> 'ended');
$$;

CREATE FUNCTION public.organisation_is_listed(o public.organisations) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT o.is_public AND o.programme_status IN ('founding_trial','active_paid','affiliation_only');
$$;

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_sponsorships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_showcases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads listed organisations" ON public.organisations FOR SELECT USING (
  public.organisation_is_listed(organisations)
  OR public.is_organisation_admin(id, (SELECT auth.uid()))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Public reads programmes of listed organisations" ON public.organisation_programmes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = organisation_id AND (public.organisation_is_listed(o)
   OR public.is_organisation_admin(o.id, (SELECT auth.uid()))))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Organisation admins read own admin list" ON public.organisation_admins FOR SELECT USING (
  public.is_organisation_admin(organisation_id, (SELECT auth.uid())) OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Staff read organisation notes" ON public.organisation_notes FOR SELECT USING (
  public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Applicants read own applications" ON public.organisation_applications FOR SELECT USING (
  applicant_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Public reads active affiliations of listed organisations" ON public.organisation_affiliations FOR SELECT USING (
  (status = 'active' AND EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = organisation_id AND public.organisation_is_listed(o)))
  OR EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_organisation_admin(organisation_id, (SELECT auth.uid()))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Owners and admins read sponsorships" ON public.organisation_sponsorships FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = business_id AND b.owner_id = (SELECT auth.uid()))
  OR public.is_organisation_admin(organisation_id, (SELECT auth.uid()))
  OR public.has_any_role(ARRAY['admin','governance_controller']));
CREATE POLICY "Public reads live showcases" ON public.programme_showcases FOR SELECT USING (
  (enabled AND starts_at <= now() AND ends_at > now()) OR public.has_any_role(ARRAY['admin','governance_controller']));

-- ── Admin: create / edit / lifecycle ─────────────────────────────────────
CREATE FUNCTION public.admin_upsert_organisation(p_actor uuid, p_id uuid, p_values jsonb, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
   COALESCE((p_values->>'sponsoredCapacity')::integer, public.commercial_setting_int('founding_organisation','sponsoredCapacity',50)),
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
   updated_at = now()
  WHERE id = p_id RETURNING * INTO nxt;
 END IF;
 PERFORM public.commercial_audit(p_actor,CASE WHEN p_id IS NULL THEN 'organisation_created' ELSE 'organisation_updated' END,
  'organisation',nxt.id,to_jsonb(prev),to_jsonb(nxt),p_reason);
 RETURN nxt.id;
END;
$$;

CREATE FUNCTION public.end_sponsorship_internal(p_sponsorship uuid, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.organisation_sponsorships; r record;
BEGIN
 SELECT * INTO s FROM public.organisation_sponsorships WHERE id = p_sponsorship FOR UPDATE;
 IF s.id IS NULL OR s.status NOT IN ('active','waitlisted') THEN RETURN; END IF;
 UPDATE public.organisation_sponsorships SET status = p_status, ended_at = now(), end_reason = p_reason WHERE id = s.id;
 IF s.slot_entitlement_id IS NOT NULL THEN
  -- Sponsored visibility ends; content returns to the owner's dashboard for
  -- their own trial or paid plan. The affiliation itself is untouched.
  FOR r IN SELECT content_table, content_id FROM public.slot_assignments WHERE entitlement_id = s.slot_entitlement_id AND released_at IS NULL LOOP
   EXECUTE format('UPDATE public.%I SET status = ''expired'', status_reason = ''Sponsorship ended'' WHERE id = $1 AND status = ''live''', r.content_table) USING r.content_id;
  END LOOP;
  UPDATE public.slot_entitlements SET status = 'expired', expires_at = greatest(starts_at + interval '1 second', least(expires_at, now())), updated_at = now()
  WHERE id = s.slot_entitlement_id;
 END IF;
 IF s.status = 'active' THEN
  INSERT INTO public.notifications(user_id,type,title,message,href)
  SELECT b.owner_id,'info','Sponsored visibility has ended',
   'Your affiliation remains active. Reactivate your listing from R50 / 30 days in your dashboard.','/dashboard/listings'
  FROM public.businesses b WHERE b.id = s.business_id;
  PERFORM public.promote_sponsorship_waitlist(s.organisation_id);
 END IF;
END;
$$;

CREATE FUNCTION public.activate_sponsorship_internal(p_sponsorship uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.organisation_sponsorships; o public.organisations; b record; ent uuid; h text; ends timestamptz;
BEGIN
 SELECT * INTO STRICT s FROM public.organisation_sponsorships WHERE id = p_sponsorship FOR UPDATE;
 SELECT * INTO STRICT o FROM public.organisations WHERE id = s.organisation_id;
 SELECT id, owner_id, area INTO STRICT b FROM public.businesses WHERE id = s.business_id;
 ends := COALESCE(s.ends_at, o.trial_ends_at, (SELECT ends_at FROM public.commercial_contracts WHERE id = o.contract_id), now() + interval '180 days');
 IF ends <= now() THEN RAISE EXCEPTION 'Sponsorship period has already ended'; END IF;
 INSERT INTO public.slot_entitlements(user_id,organisation_id,area,source,sponsorship_id,slot_capacity,activation_limit_per_period,
  activation_period_days,starts_at,expires_at,payment_status,notes)
 VALUES (b.owner_id,o.id,b.area,'SPONSORED_ORGANISATION_MEMBER',s.id,1,
  public.commercial_setting_int('retail','activationsPerPeriod',10),30,now(),ends,'not_required',
  'Sponsored by ' || o.name)
 RETURNING id INTO ent;
 UPDATE public.organisation_sponsorships SET status = 'active', starts_at = now(), ends_at = ends, slot_entitlement_id = ent WHERE id = s.id;
 -- A sponsored member never later receives a public introductory trial.
 h := public.intro_trial_identity(b.owner_id);
 IF h IS NOT NULL THEN
  INSERT INTO public.intro_trial_identities(identity_hmac,programme_kind,user_id) VALUES (h,'SPONSORED_ORGANISATION_MEMBER',b.owner_id)
  ON CONFLICT (identity_hmac) DO NOTHING;
 END IF;
 INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (b.owner_id,'success','Sponsored visibility activated',
  o.sponsorship_wording || ' ' || o.name || ' until ' || to_char(ends AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY') || '. It does not renew automatically.',
  '/dashboard/businesses');
END;
$$;

CREATE FUNCTION public.promote_sponsorship_waitlist(p_org uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; used integer; w uuid; promoted integer := 0;
BEGIN
 SELECT * INTO STRICT o FROM public.organisations WHERE id = p_org FOR UPDATE;
 IF o.programme_status NOT IN ('founding_trial','active_paid') THEN RETURN 0; END IF;
 LOOP
  SELECT count(*) INTO used FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active';
  EXIT WHEN used >= o.sponsored_capacity;
  SELECT id INTO w FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'waitlisted' ORDER BY created_at LIMIT 1;
  EXIT WHEN w IS NULL;
  PERFORM public.activate_sponsorship_internal(w);
  promoted := promoted + 1;
 END LOOP;
 RETURN promoted;
END;
$$;

CREATE FUNCTION public.admin_manage_organisation(p_actor uuid, p_org uuid, p_action text, p_values jsonb, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prev public.organisations; nxt public.organisations; c uuid; days integer; target uuid; n integer; r record; result jsonb := '{}'::jsonb;
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
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (target,'info','Organisation administrator access',
   'You can now manage affiliation requests for ' || prev.name || '.','/dashboard/organisation/' || prev.slug);
 ELSIF p_action = 'remove_admin' THEN
  DELETE FROM public.organisation_admins WHERE organisation_id = p_org AND user_id = (p_values->>'userId')::uuid;
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

-- ── Member: request affiliation ──────────────────────────────────────────
CREATE FUNCTION public.submit_affiliation_application(p_user uuid, p_business uuid, p_org uuid, p_programme uuid,
 p_reason text, p_reference text, p_consent jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; app uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = p_business AND owner_id = p_user) THEN
  RAISE EXCEPTION 'AFFILIATION_NOT_OWNER: You can only request affiliation for your own business'; END IF;
 SELECT * INTO o FROM public.organisations WHERE id = p_org;
 IF o.id IS NULL OR NOT public.organisation_is_listed(o) OR NOT o.accepting_applications THEN
  RAISE EXCEPTION 'AFFILIATION_CLOSED: This organisation is not accepting affiliation requests'; END IF;
 IF p_programme IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organisation_programmes WHERE id = p_programme AND organisation_id = p_org AND active) THEN
  RAISE EXCEPTION 'Programme not found'; END IF;
 IF COALESCE((p_consent->>'accepted')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'AFFILIATION_CONSENT_REQUIRED: Consent is required'; END IF;
 IF EXISTS (SELECT 1 FROM public.organisation_affiliations WHERE organisation_id = p_org AND business_id = p_business AND status = 'active') THEN
  RAISE EXCEPTION 'AFFILIATION_EXISTS: This business is already affiliated'; END IF;
 IF (SELECT count(*) FROM public.organisation_applications WHERE applicant_id = p_user AND created_at > now() - interval '1 day') >= 10 THEN
  RAISE EXCEPTION 'AFFILIATION_RATE_LIMIT: Too many requests today'; END IF;
 INSERT INTO public.organisation_applications(organisation_id,programme_id,business_id,applicant_id,reason,member_reference,consent_fields,consented_at)
 VALUES (p_org,p_programme,p_business,p_user,nullif(btrim(p_reason),''),nullif(btrim(p_reference),''),p_consent,now())
 RETURNING id INTO app;
 INSERT INTO public.notifications(user_id,type,title,message,href)
 SELECT a.user_id,'info','New affiliation request','A business has asked to be confirmed as a participant in your programme.',
  '/dashboard/organisation/' || o.slug || '/applications'
 FROM public.organisation_admins a WHERE a.organisation_id = p_org;
 RETURN app;
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'AFFILIATION_PENDING: A request for this organisation is already open';
END;
$$;

CREATE FUNCTION public.member_affiliation_action(p_user uuid, p_application uuid, p_action text, p_response text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.organisation_applications; o public.organisations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.organisation_applications WHERE id = p_application AND applicant_id = p_user FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Application not found'; END IF;
 SELECT * INTO o FROM public.organisations WHERE id = a.organisation_id;
 IF p_action = 'respond' THEN
  IF a.status <> 'more_info_required' THEN RAISE EXCEPTION 'No information was requested'; END IF;
  IF length(btrim(COALESCE(p_response,''))) NOT BETWEEN 2 AND 2000 THEN RAISE EXCEPTION 'A response is required'; END IF;
  UPDATE public.organisation_applications SET status = 'submitted', info_response = p_response, updated_at = now() WHERE id = a.id;
  INSERT INTO public.notifications(user_id,type,title,message,href)
  SELECT user_id,'info','Affiliation request updated','An applicant has supplied the requested information.','/dashboard/organisation/' || o.slug || '/applications'
  FROM public.organisation_admins WHERE organisation_id = a.organisation_id;
 ELSIF p_action = 'withdraw' THEN
  IF a.status NOT IN ('submitted','more_info_required') THEN RAISE EXCEPTION 'Only open requests can be withdrawn'; END IF;
  UPDATE public.organisation_applications SET status = 'withdrawn', updated_at = now() WHERE id = a.id;
 ELSE RAISE EXCEPTION 'Unknown action';
 END IF;
END;
$$;

-- ── Organisation administrators ──────────────────────────────────────────
CREATE FUNCTION public.org_list_applications(p_user uuid, p_org uuid, p_status text DEFAULT NULL)
RETURNS TABLE(id uuid, status text, business_id uuid, business_name text, category text, city text, province text,
 business_phone text, business_email text, business_website text, representative_name text, identity_verified boolean,
 programme_name text, reason text, member_reference text, info_request text, info_response text, submitted_at timestamptz,
 decision_at timestamptz, decision_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 -- Deliberately minimal: no ID documents, selfies, hashes, risk or fraud data.
 RETURN QUERY
 SELECT a.id, a.status, b.id, b.business_name::text, b.category::text, b.location_city::text, b.location_province::text,
  b.phone::text, b.email::text, b.website::text,
  CASE WHEN COALESCE((a.consent_fields->>'shareRepresentativeName')::boolean,false)
   THEN nullif(btrim(concat_ws(' ', p.legal_first_name, p.legal_last_name)),'') END,
  p.account_verification_status::text = 'verified',
  pr.name, a.reason, a.member_reference, a.info_request, a.info_response, a.created_at, a.decision_at, a.decision_note
 FROM public.organisation_applications a
 JOIN public.businesses b ON b.id = a.business_id
 LEFT JOIN public.account_profiles p ON p.user_id = a.applicant_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = a.programme_id
 WHERE a.organisation_id = p_org AND (p_status IS NULL OR a.status = p_status)
 ORDER BY a.created_at DESC LIMIT 500;
END;
$$;

CREATE FUNCTION public.org_decide_application(p_user uuid, p_application uuid, p_decision text, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.organisation_applications; o public.organisations; aff uuid; owner uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.organisation_applications WHERE id = p_application FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Application not found'; END IF;
 IF NOT (public.is_organisation_admin(a.organisation_id,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 IF a.status NOT IN ('submitted','more_info_required') THEN RAISE EXCEPTION 'Application already decided'; END IF;
 SELECT * INTO o FROM public.organisations WHERE id = a.organisation_id;
 IF o.programme_status IN ('suspended','ended') THEN RAISE EXCEPTION 'Organisation programme is not active'; END IF;
 SELECT owner_id INTO owner FROM public.businesses WHERE id = a.business_id;
 IF p_decision = 'approve' THEN
  UPDATE public.organisation_applications SET status = 'approved', decision_by = p_user, decision_at = now(), decision_note = p_note, updated_at = now() WHERE id = a.id;
  INSERT INTO public.organisation_affiliations(organisation_id,programme_id,business_id,application_id,confirmed_by)
  VALUES (a.organisation_id,a.programme_id,a.business_id,a.id,p_user)
  ON CONFLICT (organisation_id,business_id) WHERE status = 'active' DO NOTHING RETURNING id INTO aff;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (owner,'success','Affiliation confirmed',
   o.name || ' confirmed your business as a programme participant.','/dashboard/businesses');
 ELSIF p_decision = 'decline' THEN
  UPDATE public.organisation_applications SET status = 'declined', decision_by = p_user, decision_at = now(), decision_note = p_note, updated_at = now() WHERE id = a.id;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (owner,'info','Affiliation not confirmed',
   o.name || ' could not confirm this affiliation. Your VerifyMzansi account and listings are unaffected.','/dashboard/businesses');
 ELSIF p_decision = 'request_info' THEN
  IF length(btrim(COALESCE(p_note,''))) < 5 THEN RAISE EXCEPTION 'Describe the information required'; END IF;
  UPDATE public.organisation_applications SET status = 'more_info_required', info_request = p_note, updated_at = now() WHERE id = a.id;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (owner,'warning','More information requested',
   o.name || ' needs more information about your affiliation request.','/dashboard/businesses');
 ELSE RAISE EXCEPTION 'Unknown decision';
 END IF;
 PERFORM public.commercial_audit(p_user,'affiliation_' || p_decision,'organisation_application',a.id,
  jsonb_build_object('status',a.status),jsonb_build_object('decision',p_decision,'note',p_note),p_note,
  jsonb_build_object('organisationId',a.organisation_id,'businessId',a.business_id));
 RETURN aff;
END;
$$;

CREATE FUNCTION public.org_revoke_affiliation(p_user uuid, p_affiliation uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f public.organisation_affiliations; r record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.organisation_affiliations WHERE id = p_affiliation FOR UPDATE;
 IF f.id IS NULL OR f.status <> 'active' THEN RAISE EXCEPTION 'Active affiliation not found'; END IF;
 IF NOT (public.is_organisation_admin(f.organisation_id,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'A reason is required'; END IF;
 UPDATE public.organisation_affiliations SET status = 'revoked', revoked_at = now(), revoked_by = p_user, revoke_reason = p_reason WHERE id = f.id;
 FOR r IN SELECT id FROM public.organisation_sponsorships WHERE affiliation_id = f.id AND status IN ('active','waitlisted') LOOP
  PERFORM public.end_sponsorship_internal(r.id,'revoked','Affiliation revoked');
 END LOOP;
 INSERT INTO public.notifications(user_id,type,title,message,href)
 SELECT b.owner_id,'info','Affiliation ended','An organisation affiliation was removed. Your VerifyMzansi account and business profile are unaffected.','/dashboard/businesses'
 FROM public.businesses b WHERE b.id = f.business_id;
 PERFORM public.commercial_audit(p_user,'affiliation_revoked','organisation_affiliation',f.id,to_jsonb(f),jsonb_build_object('status','revoked'),p_reason);
END;
$$;

-- Sponsor an affiliated business. Capacity is enforced under the organisation
-- row lock; overflow joins a waiting list and is promoted automatically.
CREATE FUNCTION public.sponsor_business(p_user uuid, p_affiliation uuid, p_sponsor_type text, p_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE f public.organisation_affiliations; o public.organisations; used integer; s uuid; st text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.organisation_affiliations WHERE id = p_affiliation;
 IF f.id IS NULL OR f.status <> 'active' THEN RAISE EXCEPTION 'SPONSORSHIP_REQUIRES_AFFILIATION: Only active affiliations can be sponsored'; END IF;
 IF NOT (public.is_organisation_admin(f.organisation_id,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 IF p_sponsor_type NOT IN ('VERIFYMZANSI_FOUNDING','ORGANISATION') THEN RAISE EXCEPTION 'Unknown sponsor type'; END IF;
 -- Only VerifyMzansi may record its own founding sponsorship.
 IF p_sponsor_type = 'VERIFYMZANSI_FOUNDING' AND NOT public.is_commercial_admin(p_user) AND
  (SELECT programme_status FROM public.organisations WHERE id = f.organisation_id) <> 'founding_trial' THEN
  RAISE EXCEPTION 'Founding sponsorship is only available during the founding pilot'; END IF;
 SELECT * INTO STRICT o FROM public.organisations WHERE id = f.organisation_id FOR UPDATE;
 IF o.programme_status NOT IN ('founding_trial','active_paid') THEN RAISE EXCEPTION 'SPONSORSHIP_INACTIVE: Organisation has no active sponsorship programme'; END IF;
 SELECT count(*) INTO used FROM public.organisation_sponsorships WHERE organisation_id = o.id AND status = 'active';
 st := CASE WHEN used < o.sponsored_capacity THEN 'active' ELSE 'waitlisted' END;
 INSERT INTO public.organisation_sponsorships(organisation_id,affiliation_id,business_id,sponsor_type,status,created_by)
 VALUES (o.id,f.id,f.business_id,p_sponsor_type,'waitlisted',p_user) RETURNING id INTO s;
 IF st = 'active' THEN PERFORM public.activate_sponsorship_internal(s); END IF;
 PERFORM public.commercial_audit(p_user,'sponsorship_' || st,'organisation_sponsorship',s,NULL,
  jsonb_build_object('status',st,'sponsorType',p_sponsor_type,'used',used,'capacity',o.sponsored_capacity),p_reason,
  jsonb_build_object('organisationId',o.id,'businessId',f.business_id));
 RETURN st;
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'SPONSORSHIP_EXISTS: This business is already sponsored or waitlisted';
END;
$$;

CREATE FUNCTION public.end_sponsorship(p_user uuid, p_sponsorship uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s public.organisation_sponsorships;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.organisation_sponsorships WHERE id = p_sponsorship;
 IF s.id IS NULL THEN RAISE EXCEPTION 'Sponsorship not found'; END IF;
 IF NOT (public.is_organisation_admin(s.organisation_id,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'A reason is required'; END IF;
 PERFORM public.end_sponsorship_internal(s.id,'ended',p_reason);
 PERFORM public.commercial_audit(p_user,'sponsorship_ended','organisation_sponsorship',s.id,to_jsonb(s),jsonb_build_object('status','ended'),p_reason);
END;
$$;

-- ── Public reads ─────────────────────────────────────────────────────────
-- Affiliation chips for cards/profiles. Logo only with recorded permission;
-- "sponsored" only where an active sponsorship exists.
CREATE FUNCTION public.public_business_affiliations(p_business_ids uuid[])
RETURNS TABLE(business_id uuid, organisation_id uuid, organisation_slug text, organisation_name text, logo_url text,
 label text, programme_name text, confirmed_at timestamptz, sponsored boolean, sponsorship_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT f.business_id, o.id, o.slug, o.name, CASE WHEN o.logo_permission_at IS NOT NULL THEN o.logo_url END,
  o.affiliation_wording, pr.name, f.confirmed_at,
  s.id IS NOT NULL, CASE WHEN s.id IS NOT NULL THEN o.sponsorship_wording || ' ' || o.name END
 FROM public.organisation_affiliations f
 JOIN public.organisations o ON o.id = f.organisation_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
 LEFT JOIN public.organisation_sponsorships s ON s.affiliation_id = f.id AND s.status = 'active'
  AND s.sponsor_type = 'ORGANISATION' AND s.ends_at > now()
 WHERE f.business_id = ANY(p_business_ids[1:200]) AND f.status = 'active' AND public.organisation_is_listed(o)
 ORDER BY f.business_id, (s.id IS NOT NULL) DESC, f.confirmed_at;
$$;

CREATE FUNCTION public.organisation_directory(p_org uuid, p_search text DEFAULT NULL, p_category text DEFAULT NULL,
 p_city text DEFAULT NULL, p_programme uuid DEFAULT NULL, p_sponsored boolean DEFAULT NULL, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
RETURNS TABLE(business_id uuid, business_name text, slug text, category text, subcategory text, city text, province text,
 logo_url text, cover_image text, programme_name text, confirmed_at timestamptz, sponsored boolean, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 WITH rows AS (
  SELECT b.id, b.business_name::text AS business_name, b.slug::text AS slug, b.category::text AS category, b.subcategory::text AS subcategory,
   b.location_city::text AS city, b.location_province::text AS province, b.logo_url::text AS logo_url,
   (to_jsonb(b)->>'cover_photo') AS cover_image, pr.name AS programme_name, f.confirmed_at,
   EXISTS (SELECT 1 FROM public.organisation_sponsorships s WHERE s.affiliation_id = f.id AND s.status = 'active') AS sponsored
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
 )
 SELECT r.*, count(*) OVER () FROM rows r
 WHERE p_sponsored IS NULL OR r.sponsored = p_sponsored
 ORDER BY r.business_name
 LIMIT least(greatest(p_limit,1),48) OFFSET greatest(p_offset,0);
$$;

CREATE FUNCTION public.organisation_public_stats(p_org uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT jsonb_build_object(
  'affiliatedCount', (SELECT count(*) FROM public.organisation_affiliations f JOIN public.businesses b ON b.id = f.business_id
    WHERE f.organisation_id = p_org AND f.status = 'active' AND b.status = 'live'),
  'sponsoredCount', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active'));
$$;

CREATE FUNCTION public.organisation_admin_summary(p_user uuid, p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT o FROM public.organisations WHERE id = p_org;
 RETURN jsonb_build_object(
  'programmeStatus', o.programme_status, 'trialEndsAt', o.trial_ends_at, 'sponsoredCapacity', o.sponsored_capacity,
  'adminLimit', o.admin_limit,
  'pending', (SELECT count(*) FROM public.organisation_applications WHERE organisation_id = p_org AND status = 'submitted'),
  'moreInfo', (SELECT count(*) FROM public.organisation_applications WHERE organisation_id = p_org AND status = 'more_info_required'),
  'approved', (SELECT count(*) FROM public.organisation_applications WHERE organisation_id = p_org AND status = 'approved'),
  'declined', (SELECT count(*) FROM public.organisation_applications WHERE organisation_id = p_org AND status = 'declined'),
  'affiliated', (SELECT count(*) FROM public.organisation_affiliations WHERE organisation_id = p_org AND status = 'active'),
  'sponsored', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'active'),
  'waitlisted', (SELECT count(*) FROM public.organisation_sponsorships WHERE organisation_id = p_org AND status = 'waitlisted'),
  'daysRemaining', CASE WHEN o.trial_ends_at IS NULL THEN NULL ELSE greatest(0, ceil(extract(epoch FROM o.trial_ends_at - now()) / 86400))::integer END);
END;
$$;

CREATE FUNCTION public.org_list_members(p_user uuid, p_org uuid)
RETURNS TABLE(affiliation_id uuid, business_id uuid, business_name text, category text, city text, business_status text,
 programme_name text, confirmed_at timestamptz, sponsorship_id uuid, sponsorship_status text, sponsor_type text, sponsorship_ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT (public.is_organisation_admin(p_org,p_user) OR public.is_commercial_admin(p_user)) THEN
  RAISE EXCEPTION 'Organisation access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT f.id, b.id, b.business_name::text, b.category::text, b.location_city::text, b.status::text, pr.name, f.confirmed_at,
  s.id, s.status, s.sponsor_type, s.ends_at
 FROM public.organisation_affiliations f JOIN public.businesses b ON b.id = f.business_id
 LEFT JOIN public.organisation_programmes pr ON pr.id = f.programme_id
 LEFT JOIN public.organisation_sponsorships s ON s.affiliation_id = f.id AND s.status IN ('active','waitlisted')
 WHERE f.organisation_id = p_org AND f.status = 'active'
 ORDER BY b.business_name LIMIT 2000;
END;
$$;

-- ── Lifecycle: expiry alerts (60/30/14/7 days) and pilot end ─────────────
CREATE FUNCTION public.organisation_lifecycle() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; d integer; m integer; inserted integer; total integer := 0; r record;
BEGIN
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

REVOKE ALL ON FUNCTION public.is_organisation_admin(uuid,uuid), public.admin_upsert_organisation(uuid,uuid,jsonb,text),
 public.end_sponsorship_internal(uuid,text,text), public.activate_sponsorship_internal(uuid), public.promote_sponsorship_waitlist(uuid),
 public.admin_manage_organisation(uuid,uuid,text,jsonb,text), public.submit_affiliation_application(uuid,uuid,uuid,uuid,text,text,jsonb),
 public.member_affiliation_action(uuid,uuid,text,text), public.org_list_applications(uuid,uuid,text),
 public.org_decide_application(uuid,uuid,text,text), public.org_revoke_affiliation(uuid,uuid,text),
 public.sponsor_business(uuid,uuid,text,text), public.end_sponsorship(uuid,uuid,text),
 public.organisation_admin_summary(uuid,uuid), public.org_list_members(uuid,uuid), public.organisation_lifecycle()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_organisation_admin(uuid,uuid), public.admin_upsert_organisation(uuid,uuid,jsonb,text),
 public.admin_manage_organisation(uuid,uuid,text,jsonb,text), public.submit_affiliation_application(uuid,uuid,uuid,uuid,text,text,jsonb),
 public.member_affiliation_action(uuid,uuid,text,text), public.org_list_applications(uuid,uuid,text),
 public.org_decide_application(uuid,uuid,text,text), public.org_revoke_affiliation(uuid,uuid,text),
 public.sponsor_business(uuid,uuid,text,text), public.end_sponsorship(uuid,uuid,text),
 public.organisation_admin_summary(uuid,uuid), public.org_list_members(uuid,uuid), public.organisation_lifecycle()
TO service_role;
GRANT EXECUTE ON FUNCTION public.public_business_affiliations(uuid[]), public.organisation_directory(uuid,text,text,text,uuid,boolean,integer,integer),
 public.organisation_public_stats(uuid) TO anon, authenticated, service_role;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  PERFORM cron.schedule('organisation-lifecycle','35 * * * *','SELECT public.organisation_lifecycle()');
 END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
