-- Privacy (access) exports: the member's data leaves the database only
-- together with the notice that an export was made.
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
-- 1. private.privacy_request_events gains export_id (uuid) and export_digest
--    (64 hex characters) and the action 'export_prepared'. An
--    'export_prepared' row always has both; an 'exported' row may have an
--    export_id (the old command's rows have none) and never a digest; no other
--    action has either. A unique index allows one row per (export_id,
--    action): one preparation and at most one confirmation per export.
-- 2. api.prepare_frontend_privacy_export(p_case, p_revision): the same checks
--    as the old command (dsar:manage with a second factor from the last 15
--    minutes, a verified access request at the represented revision, never
--    the requester or the data subject, oversized exports refused in full with
--    PT413). It builds the export but returns NO personal data: only the
--    request's reference and dates, a new export_id, each dataset's name and
--    row count, and the SHA-256 digest of the datasets. It records only an
--    'export_prepared' event with that digest (the staff audit of who
--    prepared which export). No email, no notice, no 'exported' event. One
--    staff member may prepare at most 10 exports of one request per hour
--    (PT429 'export preparation limit reached'), so direct calls cannot
--    repeat full builds without end.
-- 3. api.confirm_frontend_privacy_export(p_case, p_revision, p_export): the
--    only command that returns the data. It needs the staff member who
--    prepared that export, at the same request revision, within 15 minutes of
--    preparing it, and an export not yet confirmed. It builds the export again
--    and refuses (PT409 'export changed since it was prepared') unless its
--    digest equals the prepared one, so the website delivers exactly what it
--    checked; staff prepare again. Then, in the same transaction that returns
--    the data, it records the 'exported' event (with the export_id), queues
--    the requester's email (at most once per request, as before) and, when
--    that email job is new and the request names an account, adds the
--    privacy_export_made notice. A second confirmation of the same export,
--    even at the same moment, is refused (PT409 'export already confirmed')
--    and changes nothing: the data is returned once per export, and the
--    member is told once.
--
-- Both commands are staff commands (authenticated with internal.staff_actor);
-- no visitor, member without the capability or service role can run them.
-- ORDER: apply first, then merge (the website that calls the new commands
-- needs them; the website deployed now does not call them).
-- Read-only preflight: ../preflight/20261120191500_privacy_export_confirm.check.sql.
-- Rollback: ../rollback/20261120191500_privacy_export_confirm.down.sql.
begin;
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does with its
-- reviewed definitions; the old export command has its reviewed body (this
-- update relies on its rules and does not change it); the event action list is
-- the reviewed one, or this update's.
do $$
declare present integer;
begin
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
  into present;
  if present not in (0, 8) then
    raise exception 'privacy export confirm precondition: % of 8 objects exist', present using errcode='55000';
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
  -- Run again: every new object must still be this update's.
  if present=8 and (exists(select 1 from (values
      ('internal.prepare_frontend_privacy_export(uuid,integer)','a7a7c1431e6da1c18eda98b7e18245fd'),
      ('api.prepare_frontend_privacy_export(uuid,integer)','001f2fc46398c56fd2ac6d7b3bf2cf11'),
      ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)','f5fc946f1870f6516592dacf42ce90e1'),
      ('api.confirm_frontend_privacy_export(uuid,integer,uuid)','438d948a6a90a8fefd9c6bf49df8c99f')) v(sig,body)
    where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body)
    or (select i.indisunique and pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX privacy_events_export_idx ON private.privacy_request_events USING btree (export_id, action) WHERE (export_id IS NOT NULL)' from pg_index i
        where i.indexrelid=to_regclass('private.privacy_events_export_idx')) is not true
    or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.privacy_request_events'::regclass
        and c.conname='privacy_request_events_export_check') is distinct from '83e9c28122ad3bd5cc71b593251093c6'
    or (select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||' '||a.attnotnull,',' order by a.attname)
        from pg_attribute a where a.attrelid='private.privacy_request_events'::regclass
          and a.attname in ('export_id','export_digest') and not a.attisdropped)
        is distinct from 'export_digest text false,export_id uuid false') then
    raise exception 'privacy export confirm drift: an object of this update is not the reviewed definition' using errcode='55000';
  end if;
end$$;

-- 1. The export id and digest on the event log.
alter table private.privacy_request_events add column if not exists export_id uuid;
alter table private.privacy_request_events add column if not exists export_digest text;
alter table private.privacy_request_events drop constraint if exists privacy_request_events_action_check,
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered','export_prepared']));
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check,
  add constraint privacy_request_events_export_check check (case action
    when 'export_prepared' then export_id is not null and export_digest is not null and export_digest ~ '^[0-9a-f]{64}$'
    when 'exported' then export_digest is null
    else export_id is null and export_digest is null end);
create unique index if not exists privacy_events_export_idx on private.privacy_request_events (export_id, action)
  where export_id is not null;

-- 2. Prepare: names, row counts and a digest; no personal data, no message.
CREATE OR REPLACE FUNCTION internal.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;data jsonb;digest text;
  new_export uuid:=gen_random_uuid();
begin
  -- The row lock makes the hourly limit below count one preparation at a time.
  select * into r from private.privacy_requests where id=p_case for update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.actor_id=actor
      and e.action='export_prepared' and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export preparation limit reached' using errcode='PT429';end if;
  data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  digest:=encode(sha256(convert_to(data::text,'UTF8')),'hex');
  perform internal.staff_actor('dsar:manage');
  -- Staff audit only: who prepared which export. The member is told nothing
  -- until the export is confirmed, which is also the only way to its data.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
    values(r.id,actor,'export_prepared',r.revision,new_export,digest);
  return jsonb_build_object('request_id',r.id,'export_id',new_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,'digest',digest,
    'datasets',coalesce((select jsonb_object_agg(d.key,jsonb_array_length(d.value)) from jsonb_each(data) d),'{}'::jsonb));
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

-- 3. Confirm: the data, the record and the member's notice, together, once.
CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;data jsonb;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  select * into r from private.privacy_requests where id=p_case for share;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or r.status not in('in_progress','completed') or not r.identity_verified
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='exported')
    then raise exception 'export already confirmed' using errcode='PT409';end if;
  if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
    then raise exception 'prepared export expired' using errcode='PT409';end if;
  -- Built again before anything is recorded (the notice below would change
  -- the notifications dataset); it must be exactly what was prepared.
  data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  if encode(sha256(convert_to(data::text,'UTF8')),'hex') is distinct from prepared.export_digest
    then raise exception 'export changed since it was prepared' using errcode='PT409';end if;
  perform internal.staff_actor('dsar:manage');
  -- A concurrent confirmation of the same export waits here for the first
  -- and then finds its row: it is refused and returns nothing.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
    values(r.id,actor,'exported',r.revision,p_export)
    on conflict (export_id,action) where export_id is not null do nothing
    returning * into done;
  if done.id is null then raise exception 'export already confirmed' using errcode='PT409';end if;
  -- The requester is told once that an export was made (email), and the
  -- account the request names in its bell.
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported') on conflict(request_id,kind) do nothing;
  if found and r.subject_user_id is not null then
    perform internal.notify_account(r.subject_user_id,'privacy_export_made',r.id,null,null);
  end if;
  return jsonb_build_object('request_id',r.id,'export_id',p_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',done.occurred_at,'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,'datasets',data);
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
