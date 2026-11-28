-- Contract step: remove eight superseded member and staff commands, and show
-- staff short names in the staff role review.
--
-- The website moved to the replacement commands in earlier updates, all
-- applied, and no website release calls the commands below (see
-- contract-steps.json):
--   api.execute_frontend_report_action      -> execute_frontend_report_action_v2
--   api.get_my_frontend_posting_allowance   -> get_my_frontend_posting_allowance_v2
--   api.get_frontend_report_queue           -> get_frontend_report_review_queue
--   api.list_my_frontend_notifications      -> list_my_frontend_notices
--   api.get_frontend_seen_queue             -> get_frontend_business_review_queue
--   api.get_my_frontend_business_checks     -> get_my_frontend_business_review_state
--   api.release_frontend_content_hold       -> resolve_frontend_appeal
--   api.open_identity_disclosure            -> open_authority_request
--
-- In one transaction it:
-- 1. drops those eight api commands;
-- 2. drops internal.get_my_frontend_posting_allowance,
--    internal.list_my_frontend_notifications and
--    internal.open_identity_disclosure, which nothing else calls;
-- 3. revokes execute from authenticated on the other five internal functions
--    behind them. Each is still called by the SECURITY DEFINER function behind
--    its replacement, which runs as the owner and needs no grant to the caller;
-- 4. changes internal.get_frontend_staff_role_review: each person in the
--    staff role review carries only the short name ("Thando D.", from
--    internal.profile_public_name), no longer the full name or the email
--    address. Nothing else in it changes.
--
-- It refuses (55000) when only some of the eleven dropped functions exist, or
-- when the role review is neither the reviewed body nor this update's. Running
-- it again once applied changes nothing. No other object changes.
--
-- ORDER: website first. Merge the pull request and let its release deploy,
-- then apply (a contract step). The release calls none of the eight commands,
-- and the deploy preflight probes only the commands in the release's runtime
-- manifest, so it passes while production still has them (it reports the
-- update as pending, "database behind by 1"). The release reads the role
-- review without the email address, so between the deploy and the apply the
-- staff roles page shows "Role management could not be loaded". After the
-- apply, a revert of this pull request cannot deploy (the earlier release's
-- probe needs the dropped commands); fix forward.
-- Read-only preflight: ../preflight/20261127222829_close_unused_commands.check.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare present integer; body text;
begin
  select count(to_regprocedure(sig)) into present from unnest(array[
    'api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)',
    'api.get_my_frontend_posting_allowance(text)','api.get_frontend_report_queue(text)',
    'api.list_my_frontend_notifications(integer,boolean,timestamptz)','api.get_frontend_seen_queue(text)',
    'api.get_my_frontend_business_checks(uuid)','api.release_frontend_content_hold(uuid,integer,text)',
    'api.open_identity_disclosure(text,text,text,text,text,boolean)',
    'internal.get_my_frontend_posting_allowance(text)',
    'internal.list_my_frontend_notifications(integer,boolean,timestamptz)',
    'internal.open_identity_disclosure(text,text,text,text,text,boolean)']) sig;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.get_frontend_staff_role_review(integer,text)');
  if present not in (0,11) or body is null or body not in('f2d542319179e14457c863d7392e7dd3','6e80f5cf89c78c9032bd42c3f2632ef4') then
    raise exception 'close unused commands precondition: % of 11 functions exist, role review body %',present,coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

drop function if exists api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean);
drop function if exists api.get_my_frontend_posting_allowance(text);
drop function if exists api.get_frontend_report_queue(text);
drop function if exists api.list_my_frontend_notifications(integer,boolean,timestamptz);
drop function if exists api.get_frontend_seen_queue(text);
drop function if exists api.get_my_frontend_business_checks(uuid);
drop function if exists api.release_frontend_content_hold(uuid,integer,text);
drop function if exists api.open_identity_disclosure(text,text,text,text,text,boolean);

drop function if exists internal.get_my_frontend_posting_allowance(text);
drop function if exists internal.list_my_frontend_notifications(integer,boolean,timestamptz);
drop function if exists internal.open_identity_disclosure(text,text,text,text,text,boolean);

revoke execute on function internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean) from authenticated;
revoke execute on function internal.get_frontend_report_queue(text) from authenticated;
revoke execute on function internal.get_frontend_seen_queue(text) from authenticated;
revoke execute on function internal.get_my_frontend_business_checks(uuid) from authenticated;
revoke execute on function internal.release_frontend_content_hold(uuid,integer,text) from authenticated;

create or replace function internal.get_frontend_staff_role_review(p_page integer default 1, p_role text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor uuid:=internal.staff_actor('role:review');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  if p_page is null or p_page not between 1 and 10000 or (p_role is not null and p_role not in('moderator','governor','admin'))
    then raise exception 'valid roster page required' using errcode='22023';end if;
  with roster as (
    select r.user_id,r.role,r.granted_at,r.frontend_mfa_not_before as mfa_required_after
    from private.staff_roles r where r.revoked_at is null and (p_role is null or r.role=p_role)
  ), staff as (
    select * from roster order by granted_at desc,user_id limit 50 offset (p_page-1)*50
  ), pending as (
    select id,target_id,from_role,to_role,proposer_id,reason,created_at,expires_at
      from private.frontend_staff_role_changes where status='proposed' and expires_at>now_at order by created_at,id limit 100
  ), history as (
    select id,target_id,from_role,to_role,reviewer_id,reason,decided_at
      from private.frontend_staff_role_changes where status='applied' order by decided_at desc,id desc limit 25
  ), involved as (
    select user_id from staff union select target_id from pending union select proposer_id from pending
      union select target_id from history union select reviewer_id from history
  )
  select jsonb_build_object('actor_id',actor,'staff_total',(select count(*) from roster),
    'staff',coalesce((select jsonb_agg(to_jsonb(s) order by granted_at desc,user_id) from staff s),'[]'::jsonb),
    'pending',coalesce((select jsonb_agg(to_jsonb(p) order by created_at,id) from pending p),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by decided_at desc,id desc) from history h),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'display_name',internal.profile_public_name(p.display_name)))
      from involved i join auth.users u on u.id=i.user_id and u.deleted_at is null left join private.profiles p on p.account_id=u.id),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('role:review');return result;
end$function$;
revoke all on function internal.get_frontend_staff_role_review(integer,text) from public;
grant execute on function internal.get_frontend_staff_role_review(integer,text) to authenticated;

notify pgrst,'reload schema';
commit;
