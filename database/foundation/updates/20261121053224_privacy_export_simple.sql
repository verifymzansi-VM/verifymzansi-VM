-- Privacy (access) exports: only while the request is in progress, at most 5
-- per request, and the member is told about every export.
--
-- Replaces only internal.export_frontend_privacy_request (same signature,
-- owner and grants; api.export_frontend_privacy_request is unchanged). From
-- this update the export:
-- 1. Locks the request row FOR NO KEY UPDATE (was FOR SHARE). Parallel exports
--    of one request run one at a time, so the cap below is exact, and
--    completing the request (which bumps its revision under FOR UPDATE) waits
--    for a running export.
-- 2. Accepts only an access request that is in progress (no longer a
--    completed one), identity verified, at the stated revision. A request that
--    is not in progress is refused with PT409 detail
--    privacy_export_not_in_progress; the other refusals are as before.
-- 3. Keeps the staff, second-factor and self-export checks as before.
-- 4. Refuses a 6th export of one request with PT429 detail
--    privacy_export_limit.
-- 5. Builds the data as before: a too large export (PT413) is raised before
--    anything is recorded.
-- 6. Records the 'exported' event and queues the requester's email once per
--    request, as before, and now adds a bell notice for the account named by
--    the request on every export (before, only on the first).
-- Retention is unchanged: it minimises only completed or rejected requests,
-- which this export no longer reads.
--
-- Accepted risks:
-- - If the website refuses the answer after it was recorded (a dataset-name
--   mismatch), the member gets one extra notice for an export staff never got.
-- - A completed request cannot be exported again; open a new request.
--
-- A website release without the matching code shows its generic refusal for
-- the two new reasons. ORDER: any time (apply first, then merge, as usual).
-- Read-only preflight: ../preflight/20261121053224_privacy_export_simple.check.sql.
-- Rollback: ../rollback/20261121053224_privacy_export_simple.down.sql.
begin;
set local lock_timeout='5s';

-- Precondition: the function has its reviewed body, or this update's.
do $$begin
  if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)')),'missing')
      not in('939737e433fcf800d5e98a3dd1569e5d','87d2eed178e199afc407b4236ffed816') then
    raise exception 'privacy export simple drift: internal.export_frontend_privacy_request is not the reviewed body' using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;
begin
  -- Parallel exports wait for each other; completing the request waits too.
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.type<>'access'
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  if r.status<>'in_progress'
    then raise exception 'access request is not in progress' using errcode='PT409',detail='privacy_export_not_in_progress';end if;
  if r.revision is distinct from p_revision or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit reached for this request' using errcode='PT429',detail='privacy_export_limit';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  -- The requester is emailed once per request; the account named by the
  -- request gets a bell notice for every export.
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
  if r.subject_user_id is not null then
    perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
  end if;
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;

commit;
