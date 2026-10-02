-- Group 2 multi-listing plans include two named administrators (Document 03 §3):
-- the buyer plus one more. Until now a self-checkout buyer had no way to add
-- the second one (only staff could, and only on contracts). The buyer can now
-- add or remove one identity-reviewed account by email; that account then
-- posts from the plan's shared live slots (slot_entitlement_members).
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_manage_plan_admin(p_owner uuid, p_entitlement uuid, p_action text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE e public.slot_entitlements; target uuid; n integer; owner_name text;
 -- Buyer + one named administrator.
 max_extra CONSTANT integer := 1;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.slot_entitlements WHERE id = p_entitlement AND user_id = p_owner FOR UPDATE;
 IF e.id IS NULL OR e.source <> 'ENTERPRISE_PLAN' THEN
  RAISE EXCEPTION 'PLAN_ADMIN_NOT_FOUND: Only the buyer of a multi-listing plan can manage its administrators'; END IF;
 IF e.status NOT IN ('active','pending_verification') OR e.expires_at <= now() THEN
  RAISE EXCEPTION 'PLAN_ADMIN_INACTIVE: This plan has ended'; END IF;
 SELECT id INTO target FROM auth.users WHERE lower(email) = lower(btrim(COALESCE(p_email,''))) LIMIT 1;
 owner_name := COALESCE(nullif(btrim((SELECT display_name FROM public.account_profiles WHERE user_id = p_owner)),''), 'The plan owner');
 IF p_action = 'add' THEN
  IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.account_profiles
    WHERE user_id = target AND account_verification_status::text = 'verified') THEN
   RAISE EXCEPTION 'PLAN_ADMIN_UNAVAILABLE: That email does not belong to an identity-reviewed VerifyMzansi account'; END IF;
  IF target = p_owner THEN RAISE EXCEPTION 'PLAN_ADMIN_SELF: You are already this plan''s owner'; END IF;
  IF EXISTS (SELECT 1 FROM public.slot_entitlement_members WHERE entitlement_id = e.id AND user_id = target) THEN
   RAISE EXCEPTION 'PLAN_ADMIN_EXISTS: This person is already an administrator'; END IF;
  SELECT count(*) INTO n FROM public.slot_entitlement_members WHERE entitlement_id = e.id;
  IF n >= max_extra THEN RAISE EXCEPTION 'PLAN_ADMIN_LIMIT: This plan includes two named administrators'; END IF;
  INSERT INTO public.slot_entitlement_members(entitlement_id,user_id,added_by) VALUES (e.id,target,p_owner);
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (target,'info','Multi-listing administrator access',
   owner_name || ' added you as an administrator of a ' || e.slot_capacity || '-slot plan until '
    || to_char(e.expires_at AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY') || '. You can post from its shared slots.','/dashboard/listings');
 ELSIF p_action = 'remove' THEN
  DELETE FROM public.slot_entitlement_members WHERE entitlement_id = e.id AND user_id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_ADMIN_NOT_FOUND: That person is not an administrator of this plan'; END IF;
  INSERT INTO public.notifications(user_id,type,title,message,href) VALUES (target,'info','Multi-listing administrator access removed',
   owner_name || ' removed your administrator access to a multi-listing plan. Posts already live stay live until they end.','/dashboard/listings');
 ELSE
  RAISE EXCEPTION 'Unknown action';
 END IF;
 PERFORM public.commercial_audit(p_owner,'plan_admin_' || p_action,'slot_entitlement',e.id,NULL,
  jsonb_build_object('userId',target),'Owner managed plan administrators');
 RETURN jsonb_build_object('entitlementId',e.id,'userId',target);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_manage_plan_admin(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_manage_plan_admin(uuid,uuid,text,text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
