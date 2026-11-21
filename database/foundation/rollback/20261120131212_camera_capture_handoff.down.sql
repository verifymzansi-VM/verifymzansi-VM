-- Reviewed rollback for updates/20261120131212_camera_capture_handoff.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. A website release that offers
-- "Continue on your phone" needs the update: deploy the release before it
-- first (its phone links then answer "not available"), then run this.
-- The rollback puts back internal.run_retention byte for byte, and drops the
-- five phone-link commands, their helpers, internal.purge_capture_handoffs and
-- private.capture_handoffs (with any open links and the ID number receipts
-- they hold). Uploads already completed from a phone are kept.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.run_retention(integer)'))
      is distinct from '1d51acbc8fb435ac6f9b1f12a9020c2b'
    or to_regclass('private.capture_handoffs') is null then
    raise exception 'rollback precondition: the camera capture handoff update is not applied' using errcode='55000';
  end if;
end$$;

-- The function as it was before the update.
CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement(),
    'member_invitations',internal.purge_member_invitations(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

drop function if exists api.start_capture_handoff(text,text,text,boolean);
drop function if exists internal.start_capture_handoff(text,text,text,boolean);
drop function if exists api.attach_capture_handoff_identity(uuid,text,jsonb);
drop function if exists internal.attach_capture_handoff_identity(uuid,text,jsonb);
drop function if exists api.redeem_capture_handoff(text,text,uuid);
drop function if exists internal.redeem_capture_handoff(text,text,uuid);
drop function if exists api.capture_handoff_context(text,uuid);
drop function if exists internal.capture_handoff_context(text,uuid);
drop function if exists api.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean);
drop function if exists internal.reserve_handoff_verification_upload(text,uuid,uuid,text,text,boolean);
drop function if exists internal.purge_capture_handoffs(integer);
drop function if exists internal.capture_handoff_by_grant(text,uuid);
drop function if exists internal.capture_handoff_signed_in(private.capture_handoffs,uuid);
drop function if exists internal.capture_handoff_usable(private.capture_handoffs,boolean);
drop function if exists internal.capture_handoff_state(private.capture_handoffs);
drop function if exists internal.capture_handoff_prior_id(uuid,uuid);
drop table if exists private.capture_handoffs;

notify pgrst,'reload schema';
commit;
