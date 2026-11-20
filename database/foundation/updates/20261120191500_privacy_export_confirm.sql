-- Privacy (access) exports: tell the member only about an export the website
-- has checked and handed over.
--
-- Until now one command, internal.export_frontend_privacy_request
-- (api.export_frontend_privacy_request), built the export AND, in the same
-- call, recorded the 'exported' event, queued the "an export was made" email
-- and put a privacy_export_made notice in the member's bell. The website
-- checks the export only after that call returns, so an export it then
-- refused ("Nothing was exported") had still told the member that one was
-- made, and every retry added another 'exported' event.
--
-- This update is the expand step. It adds two staff commands and leaves the
-- old command exactly as it is, so the website deployed today keeps working;
-- a later update removes the old command once the website no longer calls it
-- (contract step).
--
-- 1. private.privacy_request_events gains export_id (uuid, nullable) and the
--    action 'export_prepared'. A 'export_prepared' row always has an
--    export_id; an 'exported' row may have one (rows written by the old
--    command have none); no other action has one. A unique index allows one
--    row per (export_id, action), so one preparation and at most one
--    confirmation per export.
-- 2. api.prepare_frontend_privacy_export(p_case, p_revision): the same checks
--    and the same export as the old command (dsar:manage with a second factor
--    from the last 15 minutes, a verified access request at the represented
--    revision, never the requester or the data subject, oversized exports
--    refused in full with PT413), plus a new export_id. It records only an
--    'export_prepared' event (who prepared which export, for the staff audit
--    trail). No email job, no notification, no 'exported' event.
-- 3. api.confirm_frontend_privacy_export(p_case, p_revision, p_export): called
--    by the website after it has checked the export and just before it hands
--    the file over. It needs the same staff member who prepared that export,
--    at the same request revision, within 15 minutes of preparing it. The
--    first confirmation records the 'exported' event (with the export_id),
--    queues the requester's email (at most once per request, as before) and,
--    when that email job is new and the request names an account, adds the
--    privacy_export_made notice. Confirming the same export again changes
--    nothing and returns the same answer, so a retry never repeats the event,
--    the email or the notice. A refused or abandoned export is never
--    confirmed: the member hears nothing about it.
--
-- Both commands are staff commands (authenticated with internal.staff_actor);
-- no visitor, member without the capability or service role can run them.
-- ORDER: apply first, then merge (the website that calls the new commands
-- needs them; the website deployed now does not call them).
-- Read-only preflight: ../preflight/20261120191500_privacy_export_confirm.check.sql.
-- Rollback: ../rollback/20261120191500_privacy_export_confirm.down.sql.
begin;
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does; the old
-- export command has its reviewed body (this update relies on its rules and
-- does not change it); the event action list is the reviewed one, or this
-- update's.
do $$
declare present integer;
begin
  select (to_regprocedure('internal.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('api.prepare_frontend_privacy_export(uuid,integer)') is not null)::integer
    + (to_regprocedure('internal.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (to_regprocedure('api.confirm_frontend_privacy_export(uuid,integer,uuid)') is not null)::integer
    + (exists(select 1 from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
        and a.attname='export_id' and not a.attisdropped))::integer
    + (to_regclass('private.privacy_events_export_idx') is not null)::integer
  into present;
  if present not in (0, 6) then
    raise exception 'privacy export confirm precondition: % of 6 objects exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.export_frontend_privacy_request(uuid,integer)'))
      is distinct from '939737e433fcf800d5e98a3dd1569e5d' then
    raise exception 'privacy export confirm drift: internal.export_frontend_privacy_request is not the reviewed body' using errcode='55000';
  end if;
  if (select array_agg(m[1] order by m[1])::text[] from pg_constraint c,
        regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m
      where c.conrelid='private.privacy_request_events'::regclass and c.conname='privacy_request_events_action_check')
      not in (array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[],
        array['assigned','completed','erasure_ordered','export_prepared','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[]) then
    raise exception 'privacy export confirm drift: privacy_request_events_action_check is not the reviewed list' using errcode='55000';
  end if;
  -- Run again: the new commands must still be this update's.
  if present=6 and exists(select 1 from (values
      ('internal.prepare_frontend_privacy_export(uuid,integer)','c4b947da9786fd3cc73657e6f8c6fc24'),
      ('api.prepare_frontend_privacy_export(uuid,integer)','001f2fc46398c56fd2ac6d7b3bf2cf11'),
      ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)','520bd0b42886eb8b1af5cfacfd242b99'),
      ('api.confirm_frontend_privacy_export(uuid,integer,uuid)','438d948a6a90a8fefd9c6bf49df8c99f')) v(sig,body)
    where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body) then
    raise exception 'privacy export confirm drift: a new command is not the reviewed body' using errcode='55000';
  end if;
end$$;

-- 1. The export id on the event log.
alter table private.privacy_request_events add column if not exists export_id uuid;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_action_check,
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered','export_prepared']));
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check,
  add constraint privacy_request_events_export_check check (case action when 'export_prepared' then export_id is not null
    when 'exported' then true else export_id is null end);
create unique index if not exists privacy_events_export_idx on private.privacy_request_events (export_id, action)
  where export_id is not null;

-- 2. Prepare: the export, with no message to the member.
CREATE OR REPLACE FUNCTION internal.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;new_export uuid:=gen_random_uuid();
begin
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  result:=jsonb_build_object('request_id',r.id,'export_id',new_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  -- Staff audit only: who prepared which export. The member is told nothing
  -- until the website confirms it handed this export over.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
    values(r.id,actor,'export_prepared',r.revision,new_export);
  return result;
end$function$;
alter function internal.prepare_frontend_privacy_export(uuid,integer) owner to postgres;
revoke all on function internal.prepare_frontend_privacy_export(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.prepare_frontend_privacy_export(uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION api.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.prepare_frontend_privacy_export(p_case,p_revision)$function$;
alter function api.prepare_frontend_privacy_export(uuid,integer) owner to postgres;
revoke all on function api.prepare_frontend_privacy_export(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function api.prepare_frontend_privacy_export(uuid,integer) to authenticated;

-- 3. Confirm: record the handed-over export and tell the member, once.
CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  -- A confirmed export answers the same again and changes nothing.
  select * into done from private.privacy_request_events e where e.export_id=p_export and e.action='exported';
  if not found then
    if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
      then raise exception 'prepared export expired' using errcode='PT409';end if;
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'exported',r.revision,p_export)
      on conflict (export_id,action) where export_id is not null do nothing
      returning * into done;
    if done.id is null then
      -- A concurrent confirmation of the same export won; it told the member.
      select * into done from private.privacy_request_events e where e.export_id=p_export and e.action='exported';
    else
      -- The requester is told once that an export was made (email), and the
      -- account the request names in its bell.
      insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
      if found and r.subject_user_id is not null then
        perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
      end if;
    end if;
  end if;
  return jsonb_build_object('request_id',r.id,'export_id',p_export,'confirmed_at',done.occurred_at);
end$function$;
alter function internal.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.confirm_frontend_privacy_export(p_case,p_revision,p_export)$function$;
alter function api.confirm_frontend_privacy_export(uuid,integer,uuid) owner to postgres;
revoke all on function api.confirm_frontend_privacy_export(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function api.confirm_frontend_privacy_export(uuid,integer,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
