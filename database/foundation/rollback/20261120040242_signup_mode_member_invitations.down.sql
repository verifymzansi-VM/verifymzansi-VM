-- Reviewed rollback for updates/20261120040242_signup_mode_member_invitations.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It restores the previous sign-up hook (only administrator invitations admit
-- a sign-up, whatever the mode was) and the previous retention job, and drops
-- the three member invitation commands, the mode read and change functions,
-- the member:invite capability and the four tables. Member invitations are
-- lost: invited members who have not signed up yet can no longer do so. It
-- refuses (55000) unless every part of the update is present, and once a mode
-- change has been recorded (the record of who opened or closed sign-up is
-- never dropped; undo such a state with a forward fix instead).
begin;
set local lock_timeout='5s';

do $$
begin
  if to_regclass('private.signup_settings') is null
    or to_regclass('private.signup_mode_events') is null
    or to_regclass('private.member_invitations') is null
    or to_regclass('private.signup_blocked_domains') is null
    or to_regprocedure('internal.signup_settings_guard()') is null
    or to_regprocedure('internal.set_signup_mode(text,text,text)') is null
    or to_regprocedure('internal.get_signup_mode()') is null
    or to_regprocedure('api.get_signup_mode()') is null
    or to_regprocedure('internal.invite_member(text)') is null
    or to_regprocedure('api.invite_member(text)') is null
    or to_regprocedure('internal.revoke_member_invitation(text)') is null
    or to_regprocedure('api.revoke_member_invitation(text)') is null
    or to_regprocedure('internal.list_member_invitations()') is null
    or to_regprocedure('api.list_member_invitations()') is null
    or to_regprocedure('internal.purge_member_invitations(integer)') is null then
    raise exception 'rollback precondition: the sign-up mode update is not fully present'
      using errcode='55000';
  end if;
  if exists (select 1 from private.signup_mode_events) then
    raise exception 'rollback precondition: a sign-up mode change is recorded'
      using errcode='55000';
  end if;
end$$;

-- The previous hook (20261103154538_owner_signup_access.sql).
CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when jsonb_typeof(p_event #> '{user,email}')='string'
    and exists(select 1 from private.owner_admin_invitations i
      where i.email=lower(p_event #>> '{user,email}') and i.revoked_at is null)
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;

-- The previous retention job (20261119172135_post_views_and_likes.sql).
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
    'engagement',internal.purge_post_engagement());
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

drop function api.get_signup_mode();
drop function internal.get_signup_mode();
drop function internal.set_signup_mode(text,text,text);
drop function api.invite_member(text);
drop function internal.invite_member(text);
drop function api.revoke_member_invitation(text);
drop function internal.revoke_member_invitation(text);
drop function api.list_member_invitations();
drop function internal.list_member_invitations();
drop function internal.purge_member_invitations(integer);
delete from private.staff_capabilities where role = 'admin' and capability = 'member:invite';
-- The record is empty (checked above); its append-only triggers go with it.
drop table private.signup_mode_events;
drop table private.signup_settings;
drop function internal.signup_settings_guard();
drop table private.member_invitations;
drop table private.signup_blocked_domains;

notify pgrst,'reload schema';
commit;
