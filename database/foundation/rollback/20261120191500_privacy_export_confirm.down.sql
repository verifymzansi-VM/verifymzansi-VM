-- Reviewed rollback for updates/20261120191500_privacy_export_confirm.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and only while the website deployed does not call
-- api.prepare_frontend_privacy_export or api.confirm_frontend_privacy_export
-- (revert the website first).
--
-- It refuses (55000), changing nothing, when the old export command or the
-- privacy request retention is missing or is neither its body before the
-- update nor the update's (a later update, such as the step that removes the
-- old command, has run: undo that first), when none of the update's objects
-- exist, or when a new command that exists is not the update's body (a later
-- update changed it). It runs when only some of the update's objects exist,
-- so a half-applied or partly removed state can be cleared.
--
-- The rollback drops the two new commands; puts back the old export command
-- (one notice for the first export only, no hourly limit) and the privacy
-- request retention byte for byte; deletes the 'export_prepared' and
-- 'export_refused' events (the staff audit of prepared and refused exports;
-- the 'exported' events stay, without their export id); drops the unique
-- index, the export check and the export_id and export_digest columns of
-- private.privacy_request_events; and puts the action list back as it was.
-- Notices already in members' bells stay.
begin;
set local lock_timeout='5s';

do $$
declare present integer;
begin
  if exists(select 1 from (values
      ('internal.export_frontend_privacy_request(uuid,integer)','939737e433fcf800d5e98a3dd1569e5d','8da19ec4f773a51f9b67fdf02996be3c'),
      ('api.export_frontend_privacy_request(uuid,integer)','251a62d1bb6d474172d02a2867b2556a','251a62d1bb6d474172d02a2867b2556a'),
      ('internal.retention_privacy_requests(integer)','ae00ab54c00fd3f6f64ac6b8061ba929','65ca200080c2e6d9cf57ebc20bed96f7')) v(sig,reviewed,updated)
    where to_regprocedure(v.sig) is null
      or (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
        not in (v.reviewed,v.updated)) then
    raise exception 'rollback precondition: the old export command or the privacy retention is missing or changed' using errcode='55000';
  end if;
  select (to_regprocedure('internal.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('api.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('internal.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (to_regprocedure('api.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
        and a.attname='export_id' and not a.attisdropped))::integer
    + (exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
        and a.attname='export_digest' and not a.attisdropped))::integer
    + (to_regclass('private.privacy_events_export_idx') is not null)::integer
    + (exists(select 1 from pg_constraint c where c.conrelid='private.privacy_request_events'::regclass
        and c.conname='privacy_request_events_export_check'))::integer
    + ((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)'))='8da19ec4f773a51f9b67fdf02996be3c')::integer
    + ((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure('internal.retention_privacy_requests(integer)'))='65ca200080c2e6d9cf57ebc20bed96f7')::integer
  into present;
  if present=0 then
    raise exception 'rollback precondition: the privacy export confirm update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from (values
      ('internal.prepare_frontend_privacy_export(uuid,integer)','321e0c77d2b5c4b6399ee9a9aafe1932'),
      ('api.prepare_frontend_privacy_export(uuid,integer)','001f2fc46398c56fd2ac6d7b3bf2cf11'),
      ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)','8e6432f134027e6b71dd1a7d58b73c4e'),
      ('api.confirm_frontend_privacy_export(uuid,integer,uuid)','438d948a6a90a8fefd9c6bf49df8c99f')) v(sig,body)
    where to_regprocedure(v.sig) is not null
      and (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body) then
    raise exception 'rollback precondition: a new export command is not the reviewed body' using errcode='55000';
  end if;
end$$;

drop function if exists api.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists internal.confirm_frontend_privacy_export(uuid,integer,uuid);
drop function if exists api.prepare_frontend_privacy_export(uuid,integer);
drop function if exists internal.prepare_frontend_privacy_export(uuid,integer);

-- The old export command as it was before the update.
CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;
begin
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  -- The requester is told once that the export was made (email), and the
  -- account named by the request in its bell.
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
  if found and r.subject_user_id is not null then
    perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
  end if;
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;

-- The privacy request retention as it was before the update.
CREATE OR REPLACE FUNCTION internal.retention_privacy_requests(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare minimised integer; purged integer;
begin
  with closed as (
    select r.id, coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at
    from private.privacy_requests r
    where r.status in ('completed', 'rejected') and r.minimised_at is null
  ), due as (
    select c.id from closed c
    where c.closed_at < statement_timestamp() - interval '30 days'
      or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = c.id and j.delivered_at is null)
    order by c.closed_at limit p_limit
  )
  update private.privacy_requests r
    set requester_email = 'removed',
      requester_phone = 'not_provided', description = 'Removed after the request was closed.',
      minimised_at = statement_timestamp()
  from due where r.id = due.id;
  get diagnostics minimised = row_count;
  delete from private.privacy_requests r where r.id in (select x.id from private.privacy_requests x
    where x.minimised_at is not null
      -- Never while it explains an erasure that has not run (a rejection).
      and not exists (select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id = l.user_id
        where l.request_id = x.id and e.erased_at is null)
      and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '5 years'
    order by x.minimised_at limit p_limit for update skip locked);
  get diagnostics purged = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged);
end;
$function$;
alter function internal.retention_privacy_requests(integer) owner to postgres;
revoke all on function internal.retention_privacy_requests(integer) from public, anon, authenticated, service_role;

delete from private.privacy_request_events where action in ('export_prepared','export_refused');
drop index if exists private.privacy_events_export_idx;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check;
alter table private.privacy_request_events drop column if exists export_digest;
alter table private.privacy_request_events drop column if exists export_id;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_action_check,
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered']));

notify pgrst,'reload schema';
commit;
