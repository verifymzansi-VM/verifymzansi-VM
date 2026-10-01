-- Consent-based trial extensions (Document 08 §6, §7).
--
-- Free access is never lengthened silently. An admin with the trials
-- capability offers 1-30 extra days with a reason; the extension applies only
-- when the recipient accepts before the respond-by time. A second extension
-- for the same trial, or a no-consent correction, needs a different admin to
-- approve (four-eyes). Every step is audited and notified; emails go through
-- the durable operation_jobs queue and never accept an offer by link alone.
--
-- Targets: Group 3 founding programmes (organisations), Group 1 / Group 2
-- founding contracts (zero-price STRATEGIC_INDIVIDUAL / FOUNDING_COMMERCIAL_PARTNER)
-- and 30-day introductory trials. The instant extension paths are retired.
BEGIN;

INSERT INTO public.commercial_settings(key, value, description)
VALUES ('extensions', '{"defaultDays":14,"respondDays":14,"groupOneEligible":true}'::jsonb,
  'Trial extension offers: default length, response window and whether individual (Group 1) trials are eligible')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.trial_extension_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('organisation_trial','founding_contract','intro_trial_claim')),
  target_id uuid NOT NULL,
  target_label text NOT NULL CHECK (length(target_label) BETWEEN 1 AND 200),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- consent: the recipient must accept. correction: applies on approval (four-eyes only).
  kind text NOT NULL DEFAULT 'consent' CHECK (kind IN ('consent','correction')),
  days integer NOT NULL CHECK (days BETWEEN 1 AND 30),
  current_ends_at timestamptz NOT NULL,
  proposed_ends_at timestamptz NOT NULL,
  respond_by timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 500),
  approval_required_because text,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('pending_approval','offered','accepted','declined','expired','withdrawn')),
  offered_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  responded_by uuid,
  responded_at timestamptz,
  email_sends integer NOT NULL DEFAULT 0 CHECK (email_sends BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposed_ends_at = current_ends_at + make_interval(days => days)),
  CHECK (approved_by IS NULL OR approved_by <> offered_by),
  CHECK (status <> 'offered' OR respond_by IS NOT NULL)
);
-- One open offer per trial.
CREATE UNIQUE INDEX IF NOT EXISTS trial_extension_offers_open_key ON public.trial_extension_offers(target_type, target_id)
  WHERE status IN ('pending_approval','offered');
CREATE INDEX IF NOT EXISTS idx_trial_extension_offers_recipient ON public.trial_extension_offers(recipient_user_id, status);
CREATE INDEX IF NOT EXISTS idx_trial_extension_offers_status ON public.trial_extension_offers(status, respond_by);

ALTER TABLE public.trial_extension_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_extension_offers FROM anon, authenticated;
GRANT SELECT ON public.trial_extension_offers TO authenticated;
DROP POLICY IF EXISTS "Recipients and staff read extension offers" ON public.trial_extension_offers;
CREATE POLICY "Recipients and staff read extension offers" ON public.trial_extension_offers FOR SELECT TO authenticated USING (
  recipient_user_id = (SELECT auth.uid()) OR public.has_any_role(ARRAY['admin','governance_controller']));

-- ── Target resolution ──────────────────────────────────────────────────
-- Locks the trial row and returns its current end, recipient and label, or
-- raises when the trial cannot be extended.
CREATE OR REPLACE FUNCTION public.trial_extension_target(p_type text, p_target uuid)
RETURNS TABLE(ends_at timestamptz, recipient uuid, label text, group_one boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; c public.commercial_contracts; t public.intro_trial_claims; owner uuid;
BEGIN
 IF p_type = 'organisation_trial' THEN
  SELECT * INTO o FROM public.organisations WHERE id = p_target FOR UPDATE;
  IF o.id IS NULL OR o.programme_status <> 'founding_trial' OR o.trial_ends_at IS NULL OR o.trial_ends_at <= now() THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_INELIGIBLE: Only an active founding programme can be extended'; END IF;
  SELECT user_id INTO owner FROM public.organisation_admins WHERE organisation_id = o.id ORDER BY (role = 'owner') DESC, created_at LIMIT 1;
  IF owner IS NULL THEN RAISE EXCEPTION 'TRIAL_EXTENSION_NO_RECIPIENT: Add a programme administrator first'; END IF;
  RETURN QUERY SELECT o.trial_ends_at, owner, o.name, false;
 ELSIF p_type = 'founding_contract' THEN
  SELECT * INTO c FROM public.commercial_contracts WHERE id = p_target FOR UPDATE;
  IF c.id IS NULL OR c.contract_type NOT IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER') OR c.price_cents <> 0
   OR c.status <> 'active' OR c.ends_at <= now() OR c.user_id IS NULL THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_INELIGIBLE: Only an active free founding contract can be extended'; END IF;
  RETURN QUERY SELECT c.ends_at, c.user_id, c.title, c.contract_type = 'STRATEGIC_INDIVIDUAL';
 ELSIF p_type = 'intro_trial_claim' THEN
  SELECT * INTO t FROM public.intro_trial_claims WHERE id = p_target FOR UPDATE;
  IF t.id IS NULL OR t.activated_at IS NULL OR t.converted_at IS NOT NULL OR t.released_at IS NOT NULL
   OR t.expires_at <= now() OR t.user_id IS NULL THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_INELIGIBLE: Only an active, unconverted introductory trial can be extended'; END IF;
  -- A seven-day trial must never turn into an unallocated launch offer.
  IF t.duration_days = 7 THEN RAISE EXCEPTION 'TRIAL_EXTENSION_INELIGIBLE: Seven-day introductory trials cannot be extended'; END IF;
  RETURN QUERY SELECT t.expires_at, t.user_id, 'Introductory trial', true;
 ELSE
  RAISE EXCEPTION 'Unknown trial type';
 END IF;
END;
$$;

-- Moves the end date (and everything that shares it) by the offered days.
CREATE OR REPLACE FUNCTION public.apply_trial_extension_internal(p_offer public.trial_extension_offers)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE o public.organisations; t public.intro_trial_claims; r record; new_end timestamptz := p_offer.proposed_ends_at;
BEGIN
 IF p_offer.target_type = 'organisation_trial' THEN
  SELECT * INTO STRICT o FROM public.organisations WHERE id = p_offer.target_id;
  UPDATE public.organisations SET trial_ends_at = new_end, updated_at = now() WHERE id = o.id;
  UPDATE public.commercial_contracts SET ends_at = new_end, updated_at = now() WHERE id = o.contract_id;
  FOR r IN SELECT id FROM public.slot_entitlements WHERE contract_id = o.contract_id LOOP
   PERFORM public.apply_entitlement_expiry(r.id, new_end, 'Programme ended');
  END LOOP;
  -- Sponsored places that share the programme end move with it; paid ones do not.
  FOR r IN SELECT s.id, s.slot_entitlement_id FROM public.organisation_sponsorships s
   WHERE s.organisation_id = o.id AND s.status = 'active' AND s.ends_at = p_offer.current_ends_at LOOP
   UPDATE public.organisation_sponsorships SET ends_at = new_end WHERE id = r.id;
   IF r.slot_entitlement_id IS NOT NULL THEN PERFORM public.apply_entitlement_expiry(r.slot_entitlement_id, new_end, 'Sponsorship ended'); END IF;
  END LOOP;
  -- Countdown notices restart against the new end date.
  DELETE FROM public.organisation_notices WHERE organisation_id = o.id;
  DELETE FROM public.commercial_notices WHERE milestone LIKE 'expiring%' AND subject_id IN (
   SELECT id FROM public.slot_entitlements WHERE contract_id = o.contract_id
   UNION SELECT slot_entitlement_id FROM public.organisation_sponsorships
    WHERE organisation_id = o.id AND status = 'active' AND ends_at = new_end);
 ELSIF p_offer.target_type = 'founding_contract' THEN
  UPDATE public.commercial_contracts SET ends_at = new_end, updated_at = now() WHERE id = p_offer.target_id;
  FOR r IN SELECT id FROM public.slot_entitlements WHERE contract_id = p_offer.target_id LOOP
   PERFORM public.apply_entitlement_expiry(r.id, new_end, 'Programme ended');
  END LOOP;
  -- "Ends soon" reminders restart against the new end date.
  DELETE FROM public.commercial_notices WHERE milestone LIKE 'expiring%'
   AND subject_id IN (SELECT id FROM public.slot_entitlements WHERE contract_id = p_offer.target_id);
 ELSE
  SELECT * INTO STRICT t FROM public.intro_trial_claims WHERE id = p_offer.target_id;
  UPDATE public.intro_trial_claims SET expires_at = new_end WHERE id = t.id;
  -- "Ends soon" reminders restart against the new end date.
  DELETE FROM public.intro_trial_notices WHERE claim_id = t.id AND milestone > 0;
  IF t.content_table IS NOT NULL THEN
   EXECUTE format('UPDATE public.%I SET expires_at = $1 WHERE id = $2 AND status = ''live''', t.content_table) USING new_end, t.content_id;
  END IF;
 END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trial_extension_email(p_offer uuid, p_event text, p_seq integer DEFAULT 0)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT public.enqueue_operation_job('trial-extension:' || p_offer::text || ':' || p_event || ':' || p_seq::text, 'email_notice',
  jsonb_build_object('template', 'trial_extension_' || p_event, 'offer_id', p_offer,
   'user_id', (SELECT recipient_user_id FROM public.trial_extension_offers WHERE id = p_offer)), NULL);
$$;

CREATE OR REPLACE FUNCTION public.notify_trial_extension_offered(p_offer public.trial_extension_offers)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 INSERT INTO public.notifications(user_id,type,title,message,href)
 VALUES (p_offer.recipient_user_id,'info','Free access extension offered',
  'VerifyMzansi has offered to extend ' || p_offer.target_label || ' by ' || p_offer.days || ' days. Accept or decline by '
   || to_char(p_offer.respond_by AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST.',
  CASE WHEN p_offer.target_type = 'organisation_trial'
   THEN '/dashboard/organisation/' || (SELECT slug FROM public.organisations WHERE id = p_offer.target_id) ELSE '/dashboard' END);
 PERFORM public.trial_extension_email(p_offer.id, 'offered', 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_trial_extension_staff(p_except uuid, p_title text, p_message text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 INSERT INTO public.notifications(user_id,type,title,message,href)
 SELECT sr.user_id, 'warning', p_title, p_message, '/admin/trials'
 FROM public.staff_roles sr
 WHERE public.staff_role_of(sr.user_id) IN ('admin','governance_controller') AND sr.user_id IS DISTINCT FROM p_except;
$$;

-- ── Admin: offer ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_offer_trial_extension(p_actor uuid, p_type text, p_target uuid, p_days integer,
  p_reason text, p_kind text DEFAULT 'consent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tg record; prior integer; why text; st text; offer public.trial_extension_offers; cfg jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Trial management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'TRIAL_EXTENSION_DAYS: Offer between 1 and 30 days'; END IF;
 IF p_kind NOT IN ('consent','correction') THEN RAISE EXCEPTION 'Unknown extension kind'; END IF;
 SELECT * INTO STRICT tg FROM public.trial_extension_target(p_type, p_target);
 cfg := COALESCE((SELECT value FROM public.commercial_settings WHERE key = 'extensions'), '{}'::jsonb);
 IF tg.group_one AND NOT COALESCE((cfg->>'groupOneEligible')::boolean, true) THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_INELIGIBLE: Individual trials are not eligible for extensions'; END IF;
 IF p_type = 'intro_trial_claim' AND tg.ends_at + make_interval(days => p_days)
   > (SELECT activated_at FROM public.intro_trial_claims WHERE id = p_target) + interval '60 days' THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_DAYS: An introductory trial must end within 60 days of activation'; END IF;
 IF EXISTS (SELECT 1 FROM public.trial_extension_offers WHERE target_type = p_type AND target_id = p_target
   AND status IN ('pending_approval','offered')) THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_OPEN: This trial already has an open extension offer'; END IF;
 SELECT count(*) INTO prior FROM public.trial_extension_offers WHERE target_type = p_type AND target_id = p_target AND status = 'accepted';
 why := CASE WHEN p_kind = 'correction' THEN 'Applies without the participant''s acceptance'
  WHEN prior > 0 THEN 'This trial has already been extended' END;
 st := CASE WHEN why IS NULL THEN 'offered' ELSE 'pending_approval' END;
 INSERT INTO public.trial_extension_offers(target_type,target_id,target_label,recipient_user_id,kind,days,current_ends_at,proposed_ends_at,
  respond_by,reason,approval_required_because,status,offered_by)
 VALUES (p_type,p_target,tg.label,tg.recipient,p_kind,p_days,tg.ends_at,tg.ends_at + make_interval(days => p_days),
  CASE WHEN st = 'offered' THEN least(now() + make_interval(days => COALESCE((cfg->>'respondDays')::integer, 14)), tg.ends_at) END,
  btrim(p_reason),why,st,p_actor)
 RETURNING * INTO offer;
 IF st = 'offered' THEN
  PERFORM public.notify_trial_extension_offered(offer);
 ELSE
  PERFORM public.notify_trial_extension_staff(p_actor,'Trial extension needs approval',
   tg.label || ': ' || p_days || ' extra days. ' || why || '. A different administrator must approve it.');
 END IF;
 PERFORM public.commercial_audit(p_actor,'trial_extension_offered','trial_extension_offer',offer.id,NULL,to_jsonb(offer),p_reason,
  jsonb_build_object('targetType',p_type,'targetId',p_target,'status',st));
 RETURN jsonb_build_object('offerId',offer.id,'status',st,'proposedEndsAt',offer.proposed_ends_at,'respondBy',offer.respond_by);
END;
$$;

-- ── Admin: four-eyes approval ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_decide_trial_extension(p_actor uuid, p_offer uuid, p_approve boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE offer public.trial_extension_offers; tg record; cfg jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Trial management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO offer FROM public.trial_extension_offers WHERE id = p_offer FOR UPDATE;
 IF offer.id IS NULL OR offer.status <> 'pending_approval' THEN RAISE EXCEPTION 'TRIAL_EXTENSION_ANSWERED: This offer is not waiting for approval'; END IF;
 IF offer.offered_by = p_actor THEN RAISE EXCEPTION 'TRIAL_EXTENSION_SECOND_ADMIN: A different administrator must approve this extension'; END IF;
 IF NOT p_approve THEN
  UPDATE public.trial_extension_offers SET status = 'withdrawn', responded_at = now(), responded_by = p_actor, updated_at = now()
  WHERE id = offer.id RETURNING * INTO offer;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (offer.offered_by,'info','Trial extension not approved',
   offer.target_label || ': the extension was not approved. ' || btrim(p_reason),'/admin/trials');
 ELSE
  SELECT * INTO STRICT tg FROM public.trial_extension_target(offer.target_type, offer.target_id);
  IF tg.ends_at IS DISTINCT FROM offer.current_ends_at THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_STALE: The trial end date changed after this offer was made; withdraw it and offer again'; END IF;
  IF offer.kind = 'correction' THEN
   PERFORM public.apply_trial_extension_internal(offer);
   UPDATE public.trial_extension_offers SET status = 'accepted', approved_by = p_actor, approved_at = now(),
    responded_at = now(), responded_by = p_actor, updated_at = now() WHERE id = offer.id RETURNING * INTO offer;
   INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (offer.recipient_user_id,'success','Free access extended',
    offer.target_label || ' now ends on ' || to_char(offer.proposed_ends_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI')
     || ' SAST. Nothing is charged and nothing renews automatically.','/dashboard');
   PERFORM public.trial_extension_email(offer.id, 'accepted', 0);
  ELSE
   cfg := COALESCE((SELECT value FROM public.commercial_settings WHERE key = 'extensions'), '{}'::jsonb);
   UPDATE public.trial_extension_offers SET status = 'offered', approved_by = p_actor, approved_at = now(),
    respond_by = least(now() + make_interval(days => COALESCE((cfg->>'respondDays')::integer, 14)), offer.current_ends_at),
    updated_at = now() WHERE id = offer.id RETURNING * INTO offer;
   PERFORM public.notify_trial_extension_offered(offer);
  END IF;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (offer.offered_by,'info','Trial extension approved',
   offer.target_label || ': your extension was approved.','/admin/trials');
 END IF;
 PERFORM public.commercial_audit(p_actor,CASE WHEN p_approve THEN 'trial_extension_approved' ELSE 'trial_extension_rejected' END,
  'trial_extension_offer',offer.id,NULL,to_jsonb(offer),p_reason);
 RETURN jsonb_build_object('offerId',offer.id,'status',offer.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_withdraw_trial_extension(p_actor uuid, p_offer uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE offer public.trial_extension_offers; was text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Trial management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO offer FROM public.trial_extension_offers WHERE id = p_offer FOR UPDATE;
 IF offer.id IS NULL OR offer.status NOT IN ('pending_approval','offered') THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_ANSWERED: Only an unanswered offer can be withdrawn'; END IF;
 was := offer.status;
 UPDATE public.trial_extension_offers SET status = 'withdrawn', responded_at = now(), responded_by = p_actor, updated_at = now()
 WHERE id = offer.id;
 IF was = 'offered' THEN
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (offer.recipient_user_id,'info','Extension offer withdrawn',
   'The extension offer for ' || offer.target_label || ' was withdrawn. Your access ends on '
    || to_char(offer.current_ends_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST as planned.','/dashboard');
 END IF;
 PERFORM public.commercial_audit(p_actor,'trial_extension_withdrawn','trial_extension_offer',offer.id,
  jsonb_build_object('status',was),jsonb_build_object('status','withdrawn'),p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resend_trial_extension(p_actor uuid, p_offer uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE offer public.trial_extension_offers;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Trial management permission required' USING ERRCODE='42501'; END IF;
 SELECT * INTO offer FROM public.trial_extension_offers WHERE id = p_offer FOR UPDATE;
 IF offer.id IS NULL OR offer.status <> 'offered' OR offer.respond_by <= now() THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_ANSWERED: Only an open offer can be resent'; END IF;
 IF offer.email_sends >= 3 THEN RAISE EXCEPTION 'TRIAL_EXTENSION_RESEND_LIMIT: This offer has been resent the maximum number of times'; END IF;
 UPDATE public.trial_extension_offers SET email_sends = email_sends + 1, updated_at = now() WHERE id = offer.id
 RETURNING * INTO offer;
 PERFORM public.trial_extension_email(offer.id, 'offered', offer.email_sends);
 PERFORM public.commercial_audit(p_actor,'trial_extension_resent','trial_extension_offer',offer.id,NULL,
  jsonb_build_object('emailSends',offer.email_sends),'Offer email resent');
 RETURN offer.email_sends;
END;
$$;

-- ── Recipient: accept or decline ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_trial_extension(p_user uuid, p_offer uuid, p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE offer public.trial_extension_offers; tg record;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO offer FROM public.trial_extension_offers WHERE id = p_offer FOR UPDATE;
 -- Programme offers are answered by whoever owns the programme now (a removed
 -- former owner cannot); every other offer only by its recipient.
 IF offer.id IS NULL
  OR (offer.target_type = 'organisation_trial' AND NOT EXISTS (SELECT 1 FROM public.organisation_admins
       WHERE organisation_id = offer.target_id AND user_id = p_user AND role = 'owner'))
  OR (offer.target_type <> 'organisation_trial' AND offer.recipient_user_id IS DISTINCT FROM p_user) THEN
  RAISE EXCEPTION 'TRIAL_EXTENSION_NOT_FOUND: Offer not found'; END IF;
 IF offer.status <> 'offered' THEN RAISE EXCEPTION 'TRIAL_EXTENSION_ANSWERED: This offer has already been answered'; END IF;
 IF offer.respond_by <= now() THEN RAISE EXCEPTION 'TRIAL_EXTENSION_EXPIRED: This offer has expired'; END IF;
 IF p_accept THEN
  SELECT * INTO STRICT tg FROM public.trial_extension_target(offer.target_type, offer.target_id);
  IF tg.ends_at IS DISTINCT FROM offer.current_ends_at THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_STALE: Your access changed after this offer was made; contact VerifyMzansi'; END IF;
  PERFORM public.apply_trial_extension_internal(offer);
  UPDATE public.trial_extension_offers SET status = 'accepted', responded_at = now(), responded_by = p_user, updated_at = now()
  WHERE id = offer.id RETURNING * INTO offer;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (p_user,'success','Extension accepted',
   offer.target_label || ' now ends on ' || to_char(offer.proposed_ends_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI')
    || ' SAST. Nothing is charged and nothing renews automatically.','/dashboard');
  PERFORM public.trial_extension_email(offer.id, 'accepted', 0);
  IF offer.target_type = 'organisation_trial' THEN
   PERFORM public.notify_organisation_admins(offer.target_id,'Programme extended',
    offer.target_label || ' now ends on ' || to_char(offer.proposed_ends_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI') || ' SAST.', p_user);
  END IF;
 ELSE
  UPDATE public.trial_extension_offers SET status = 'declined', responded_at = now(), responded_by = p_user, updated_at = now()
  WHERE id = offer.id RETURNING * INTO offer;
 END IF;
 INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (offer.offered_by,'info',
  CASE WHEN p_accept THEN 'Extension accepted' ELSE 'Extension declined' END,
  offer.target_label || CASE WHEN p_accept THEN ' accepted ' ELSE ' declined ' END || 'the ' || offer.days || '-day extension.','/admin/trials');
 PERFORM public.commercial_audit(p_user,CASE WHEN p_accept THEN 'trial_extension_accepted' ELSE 'trial_extension_declined' END,
  'trial_extension_offer',offer.id,NULL,to_jsonb(offer),CASE WHEN p_accept THEN 'Participant accepted' ELSE 'Participant declined' END);
 RETURN jsonb_build_object('status',offer.status,'endsAt',CASE WHEN p_accept THEN offer.proposed_ends_at ELSE offer.current_ends_at END);
END;
$$;

-- ── Hourly expiry ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_trial_extension_offers() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record; n integer := 0;
BEGIN
 FOR r IN SELECT * FROM public.trial_extension_offers
  WHERE (status = 'offered' AND respond_by <= now())
   OR (status = 'pending_approval' AND (created_at < now() - interval '7 days' OR current_ends_at <= now()))
  FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.trial_extension_offers SET status = 'expired', updated_at = now() WHERE id = r.id;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (r.offered_by,'info','Extension offer expired',
   r.target_label || ': the ' || r.days || '-day extension was not answered in time. The trial ends as planned.','/admin/trials');
  n := n + 1;
 END LOOP;
 RETURN n;
END;
$$;

-- ── Retire instant extensions ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manage_commercial_contract(p_actor uuid, p_contract uuid, p_action text, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE prev public.commercial_contracts; nxt public.commercial_contracts; member_count integer; target uuid; ent uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.is_commercial_admin(p_actor) THEN
  RAISE EXCEPTION 'Programme management permission required' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 SELECT * INTO STRICT prev FROM public.commercial_contracts WHERE id = p_contract FOR UPDATE;
 IF p_action = 'extend' THEN
  -- Free founding time is only added through a consented extension offer.
  IF prev.price_cents = 0 AND prev.contract_type IN ('STRATEGIC_INDIVIDUAL','FOUNDING_COMMERCIAL_PARTNER','FOUNDING_ORGANISATION') THEN
   RAISE EXCEPTION 'TRIAL_EXTENSION_OFFER_REQUIRED: Offer an extension from Admin › Trials; it applies only after the participant accepts'; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.manage_intro_trial(p_actor_id uuid, p_action text, p_target text, p_values jsonb, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE t public.intro_trial_claims;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
  SELECT 1 FROM auth.users WHERE id = p_actor_id AND public.staff_role_of(auth.users.id) IN ('admin','governance_controller')
 ) THEN RAISE EXCEPTION 'Trial management permission required' USING ERRCODE = '42501'; END IF;
 IF length(btrim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'An audit reason is required'; END IF;
 IF p_action = 'configure' THEN
  UPDATE public.intro_trial_campaigns SET slot_limit = (p_values->>'slotLimit')::integer,
   launch_enabled = (p_values->>'launchEnabled')::boolean, seven_day_enabled = (p_values->>'sevenDayEnabled')::boolean
  WHERE area = p_target::public.marketplace_area;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
 ELSIF p_action = 'extend' THEN
  -- Free time is only added through a consented extension offer.
  RAISE EXCEPTION 'TRIAL_EXTENSION_OFFER_REQUIRED: Offer an extension instead; it applies only after the member accepts';
 ELSIF p_action = 'revoke' THEN
  SELECT * INTO STRICT t FROM public.intro_trial_claims WHERE id = p_target::uuid FOR UPDATE;
  -- Hide first. The content trigger releases capacity in the same transaction.
  IF t.content_table IS NOT NULL THEN
   EXECUTE format('UPDATE public.%I SET status = ''hidden'', status_reason = ''Introductory trial revoked'' WHERE id = $1 AND status = ''live''', t.content_table) USING t.content_id;
  END IF;
  UPDATE public.intro_trial_claims SET released_at = COALESCE(released_at,now()), release_reason = 'admin_revoked' WHERE id = t.id;
 ELSE RAISE EXCEPTION 'Unknown trial management action';
 END IF;
 INSERT INTO public.intro_trial_audit(actor_id,action,target_id,reason,details) VALUES(p_actor_id,p_action,p_target,p_reason,p_values);
END;
$function$;

REVOKE ALL ON FUNCTION public.trial_extension_target(text,uuid), public.apply_trial_extension_internal(public.trial_extension_offers),
 public.trial_extension_email(uuid,text,integer), public.notify_trial_extension_offered(public.trial_extension_offers),
 public.notify_trial_extension_staff(uuid,text,text),
 public.admin_offer_trial_extension(uuid,text,uuid,integer,text,text), public.admin_decide_trial_extension(uuid,uuid,boolean,text),
 public.admin_withdraw_trial_extension(uuid,uuid,text), public.admin_resend_trial_extension(uuid,uuid),
 public.respond_trial_extension(uuid,uuid,boolean), public.expire_trial_extension_offers()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_offer_trial_extension(uuid,text,uuid,integer,text,text),
 public.admin_decide_trial_extension(uuid,uuid,boolean,text), public.admin_withdraw_trial_extension(uuid,uuid,text),
 public.admin_resend_trial_extension(uuid,uuid), public.respond_trial_extension(uuid,uuid,boolean),
 public.expire_trial_extension_offers()
TO service_role;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  -- cron.schedule replaces a job with the same name, so re-running is safe.
  PERFORM cron.schedule('expire-trial-extension-offers','45 * * * *','SELECT public.expire_trial_extension_offers()');
 END IF;
END $$;

COMMIT;
NOTIFY pgrst, 'reload schema';
