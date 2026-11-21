-- Privacy (access) exports: the member's data leaves the database only
-- together with a notice to the member that an export was made.
--
-- Until now one command, internal.export_frontend_privacy_request
-- (api.export_frontend_privacy_request), built the export AND, in the same
-- call, recorded the 'exported' event, queued the "an export was made" email
-- and, for the first export only, put a privacy_export_made notice in the
-- member's bell. The website checks the export only after that call returns,
-- so an export it then refused ("Nothing was exported") had still told the
-- member that one was made, and later exports told the member nothing.
--
-- This update is the expand step: two new staff commands, and the old command
-- kept (same signature) with a notice on every export and an hourly limit,
-- until the contract step removes it once the website no longer calls it.
--
-- 1. private.privacy_request_events gains export_id (uuid) and export_digest
--    (64 hex characters, or none) and the actions 'export_prepared' and
--    'export_refused'. An 'export_prepared' row always has an export_id and a
--    digest until retention clears it; an 'export_refused' row has an
--    export_id and no digest; an 'exported' row may have an export_id (the old
--    command's rows have none) and never a digest; no other action has either.
--    A unique index allows one row per (export_id, action).
-- 2. Which requests can be exported (both new commands): a verified access
--    request at the represented revision that is open (in progress), or
--    completed less than 696 hours ago (a fixed length, whatever the session
--    time zone; a day before retention's 30 days) and not yet minimised (in
--    practice until retention closes it out, usually soon after completion);
--    at most 5 confirmed exports per request (PT429 'export limit for this
--    request reached'), counting the old command's exports. A member who
--    cannot see the bell (no account access, or a deleted account) can be
--    exported only while the export email is deliverable under the email
--    job's own rule (point 8); otherwise all three commands refuse with 55000
--    (detail member_not_notifiable) and staff contact the member first.
--    Requests with no account export no personal data and are not refused.
-- 3. api.prepare_frontend_privacy_export(p_case, p_revision): dsar:manage
--    with a second factor from the last 15 minutes, never the requester or the
--    data subject (as the old command). It builds the export and keeps its
--    SHA-256 digest in an 'export_prepared' event (staff audit), but answers
--    NO personal data and no digest or counts: the request's reference and
--    dates, a new export_id and the dataset names. An export too large for a
--    direct download is answered {refused:'too_large'} and recorded as an
--    'export_refused' event. One staff member may build at most 10 exports of
--    one request per hour, counting refused builds (PT429 'export preparation
--    limit reached'). Tells the member nothing.
-- 4. api.confirm_frontend_privacy_export(p_case, p_revision, p_export): the
--    only command that returns the data. The staff member who prepared that
--    export (and still not the requester or the data subject), at the same
--    revision, within 15 minutes, once. It builds the export again: if it is
--    too large or its digest differs from the prepared one, it answers
--    {refused:'too_large'|'changed'} and records an 'export_refused' event
--    (the build counts toward the hourly limit; that export id cannot be
--    confirmed any more; staff prepare again). Otherwise, in the same
--    transaction that returns the data, it records the 'exported' event (with
--    the export_id), queues the requester's email (at most once per request,
--    as before; see point 7) and adds a privacy_export_made notice to the
--    account the request names, for every confirmed export. A second confirmation of the
--    same export, even at the same moment, is refused (PT409 'export already
--    confirmed') and changes nothing.
-- 5. The old command (same signature, grants and owner): the same requests
--    as point 2 and the 5 exports per request counted together with the new
--    path, the same notices as point 4, and at most 10 exports per staff
--    member and request per hour (PT429 'export limit reached').
-- 6. internal.retention_privacy_requests (part of api.run_retention) also
--    clears the digest of prepared exports never confirmed, one day after
--    they expired (older than 1 day 15 minutes: the 15 minutes to confirm
--    plus a day), and reports 'export_digests_cleared'. It no longer
--    minimises a request exported in the last 24 hours or whose export email
--    is still being tried (undelivered, fewer than 8 attempts), and it locks
--    the requests it minimises (for update skip locked): a request an export
--    holds is left for the next run, and an export waiting for a request
--    retention holds then finds it minimised and refuses. Otherwise its
--    results are unchanged.
-- 7. The notices: every confirmed export (and every old-command export) adds
--    a privacy_export_made bell notice to the account the request names; its
--    insert must return the row, and the update refuses to install while
--    private.notifications has any trigger or rule but its reviewed update
--    guard. The requester's email goes once per request while that account
--    can sign in, and on every export when it cannot (or there is none),
--    since then nobody sees the bell.
--
-- 8. internal.privacy_notice_deliverable(request): the email job's rule for
--    a deliverable address (not minimised; a manual request, an erased
--    account's request, or a confirmed, non-anonymous, not deleted account
--    whose email is the request's address), now one function used by both
--    internal.claim_frontend_privacy_notice (same behaviour) and the exports.
--
-- The digest is stable between preparing and confirming because every
-- dataset of internal.frontend_privacy_export_data is ordered with a unique
-- tie-breaker or has at most one row: listing_drafts, signup_terms,
-- locality_verification, profile, acquisition and account_closure read
-- tables whose primary key is the account, account reads one auth.users row
-- and post_likes_summary is one aggregate row.
--
-- The new commands are staff commands (authenticated with
-- internal.staff_actor); no visitor, member without the capability or service
-- role can run them.
-- ORDER: apply first, then merge (the website that calls the new commands
-- needs them; the website deployed now keeps working with the old command).
-- Read-only preflight: ../preflight/20261120191500_privacy_export_confirm.check.sql.
-- Rollback: ../rollback/20261120191500_privacy_export_confirm.down.sql.
begin;
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does with its
-- reviewed definitions; the functions it relies on or replaces have their
-- reviewed bodies (or this update's); the event action list is the reviewed
-- one, or this update's.
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
    + (to_regprocedure('internal.privacy_notice_deliverable(private.privacy_requests)') is not null)::integer
  into present;
  if present not in (0, 9) then
    raise exception 'privacy export confirm precondition: % of 9 objects exist', present using errcode='55000';
  end if;
  if exists(select 1 from (values
      ('internal.signal_owner_inbox(uuid)','2a7742d89598d62117a9b7620e0271e9','2a7742d89598d62117a9b7620e0271e9'),
      ('api.export_frontend_privacy_request(uuid,integer)','251a62d1bb6d474172d02a2867b2556a','251a62d1bb6d474172d02a2867b2556a'),
      ('internal.export_frontend_privacy_request(uuid,integer)','939737e433fcf800d5e98a3dd1569e5d','46cc7ed7289c283e04804faaa38bb156'),
      ('internal.retention_privacy_requests(integer)','ae00ab54c00fd3f6f64ac6b8061ba929','036cf32ba918a30fa0480b7fcd4a6615'),
      ('internal.claim_frontend_privacy_notice()','ab583eeac94d2d46cee6344b5e0d6ef6','98f8a3f23b7509881aa6dfc8b1e7a335')) v(sig,reviewed,updated)
    where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
      not in (v.reviewed,v.updated)
      or to_regprocedure(v.sig) is null) then
    raise exception 'privacy export confirm drift: a function this update relies on is not the reviewed body' using errcode='55000';
  end if;
  -- The bell notice must not be dropped or changed on its way in: only the
  -- reviewed update guard on private.notifications, and no rule.
  if (select coalesce(string_agg(t.tgenabled::text||' '||pg_get_triggerdef(t.oid),';' order by t.tgname),'') from pg_trigger t
      where t.tgrelid='private.notifications'::regclass and not t.tgisinternal)
      is distinct from 'O CREATE TRIGGER notification_guard BEFORE UPDATE ON private.notifications FOR EACH ROW EXECUTE FUNCTION internal.notification_guard()'
    or exists(select 1 from pg_rewrite w where w.ev_class='private.notifications'::regclass) then
    raise exception 'privacy export confirm drift: private.notifications has an unreviewed trigger or rule' using errcode='55000';
  end if;
  if (select array_agg(m[1] order by m[1])::text[] from pg_constraint c,
        regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m
      where c.conrelid='private.privacy_request_events'::regclass and c.conname='privacy_request_events_action_check')
      not in (array['assigned','completed','erasure_ordered','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[],
        array['assigned','completed','erasure_ordered','export_prepared','export_refused','exported','extended','identity_verified','recorded','rejected','started','submitted','unassigned']::text[]) then
    raise exception 'privacy export confirm drift: privacy_request_events_action_check is not the reviewed list' using errcode='55000';
  end if;
  -- Run again: every new object must still be this update's definition.
  if present=9 and (exists(select 1 from (values
      ('internal.prepare_frontend_privacy_export(uuid,integer)','3d75ecc26ff4d4a499a1e2ca3b678a49','true'),
      ('api.prepare_frontend_privacy_export(uuid,integer)','001f2fc46398c56fd2ac6d7b3bf2cf11','false'),
      ('internal.confirm_frontend_privacy_export(uuid,integer,uuid)','5fbb8a6db23bbdb1b77e81a221ec6e4d','true'),
      ('api.confirm_frontend_privacy_export(uuid,integer,uuid)','438d948a6a90a8fefd9c6bf49df8c99f','false')) v(sig,body,definer)
    where (select md5(replace(p.prosrc,E'\r\n',E'\n'))||' '||p.prosecdef::text||' '||coalesce(array_to_string(p.proconfig,','),'')
          ||' '||p.proowner::regrole::text||' '||has_function_privilege('anon',p.oid,'execute')::text
          ||' '||has_function_privilege('authenticated',p.oid,'execute')::text
          ||' '||has_function_privilege('service_role',p.oid,'execute')::text
        from pg_proc p where p.oid=to_regprocedure(v.sig))
      is distinct from v.body||' '||v.definer||' search_path=pg_catalog postgres false true false')
    or (select md5(replace(p.prosrc,E'\r\n',E'\n'))||' '||p.prosecdef::text||' '||p.provolatile::text||' '
          ||coalesce(array_to_string(p.proconfig,','),'')||' '||p.proowner::regrole::text
          ||' '||has_function_privilege('anon',p.oid,'execute')::text
          ||' '||has_function_privilege('authenticated',p.oid,'execute')::text
          ||' '||has_function_privilege('service_role',p.oid,'execute')::text
        from pg_proc p where p.oid=to_regprocedure('internal.privacy_notice_deliverable(private.privacy_requests)'))
      is distinct from '07d09e5b62485aebc0bd4d1b16e04809 false s search_path=pg_catalog postgres false false false'
    or (select i.indisunique and i.indisvalid and pg_get_indexdef(i.indexrelid)='CREATE UNIQUE INDEX privacy_events_export_idx ON private.privacy_request_events USING btree (export_id, action) WHERE (export_id IS NOT NULL)' from pg_index i
        where i.indexrelid=to_regclass('private.privacy_events_export_idx')) is not true
    or (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c where c.conrelid='private.privacy_request_events'::regclass
        and c.conname='privacy_request_events_export_check') is distinct from 'ad76579f0398a3fa9bfda5d352b54e03'
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
  add constraint privacy_request_events_action_check check (action = any (array['submitted','recorded','assigned','unassigned','extended','identity_verified','started','rejected','completed','exported','erasure_ordered','export_prepared','export_refused']));
alter table private.privacy_request_events drop constraint if exists privacy_request_events_export_check,
  add constraint privacy_request_events_export_check check (case action
    when 'export_prepared' then export_id is not null and (export_digest is null or export_digest ~ '^[0-9a-f]{64}$')
    when 'export_refused' then export_id is not null and export_digest is null
    when 'exported' then export_digest is null
    else export_id is null and export_digest is null end);
create unique index if not exists privacy_events_export_idx on private.privacy_request_events (export_id, action)
  where export_id is not null;

-- 8. The email job's delivery rule, shared by the claim and the exports.
CREATE OR REPLACE FUNCTION internal.privacy_notice_deliverable(r private.privacy_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select r.minimised_at is null -- a minimised request has no address left
    -- An erased account's request goes to the address stored with it.
    and (r.identity_check='manual' or exists(select 1 from private.account_erasure_requests l where l.request_id=r.id)
      or exists(select 1 from auth.users u where u.id=r.subject_user_id and u.email_confirmed_at is not null
        and not u.is_anonymous and u.deleted_at is null and lower(u.email)=lower(r.requester_email)))
$function$;
alter function internal.privacy_notice_deliverable(private.privacy_requests) owner to postgres;
revoke all on function internal.privacy_notice_deliverable(private.privacy_requests) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with due as (
    select j.id from private.privacy_notice_jobs j join private.privacy_requests r on r.id=j.request_id
    where j.delivered_at is null and j.attempts<8 and j.next_attempt_at<=now_at
      and (j.locked_until is null or j.locked_until<now_at)
      and internal.privacy_notice_deliverable(r)
    order by j.next_attempt_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update private.privacy_notice_jobs j set claim_token=gen_random_uuid(),locked_until=now_at+interval '90 seconds',attempts=attempts+1
    from due where j.id=due.id returning j.*
  )
  select jsonb_build_object('id',j.id,'request_id',r.id,'kind',j.kind,'recipient',r.requester_email,'claim_token',j.claim_token,'locked_until',j.locked_until,
    'due',case when j.kind='extended' then r.extended_due_at when j.kind='submitted' then r.due_by end,
    'reason',case when j.kind='extended' then r.extension_reason end)
    into result from claimed j join private.privacy_requests r on r.id=j.request_id;
  return result;
end$function$;
alter function internal.claim_frontend_privacy_notice() owner to postgres;
revoke all on function internal.claim_frontend_privacy_notice() from public;
grant execute on function internal.claim_frontend_privacy_notice() to service_role;

-- 3. Prepare: dataset names only; the digest stays in the event row.
CREATE OR REPLACE FUNCTION internal.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;data jsonb;
  new_export uuid:=gen_random_uuid();
begin
  -- The row lock makes the limits below count one export at a time.
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or not r.identity_verified
      or not (r.status='in_progress' or (r.status='completed' and r.completed_at>clock_timestamp()-interval '696 hours'
        and r.minimised_at is null))
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  -- A member who cannot see the bell (no account access, or a deleted
  -- account) is told only by email: no export unless that email can be
  -- delivered under the email job's own rule.
  if r.subject_user_id is not null and not exists(select 1 from private.current_account_access a where a.id=r.subject_user_id)
      and not internal.privacy_notice_deliverable(r)
    then raise exception 'The member can''t be notified right now, so nothing was exported. Contact the member and update the request first.'
      using errcode='55000', detail='member_not_notifiable';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.actor_id=actor
      and e.action in('export_prepared','export_refused') and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export preparation limit reached' using errcode='PT429';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  begin
    data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  exception when sqlstate 'PT413' then data:=null;
  end;
  perform internal.staff_actor('dsar:manage');
  if data is null then
    -- Recorded (not raised) so that the build counts toward the limit.
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'export_refused',r.revision,new_export);
    return jsonb_build_object('request_id',r.id,'export_id',new_export,'refused','too_large');
  end if;
  -- Staff audit: who prepared which export, and its digest for the
  -- confirmation. The member is told nothing yet.
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id,export_digest)
    values(r.id,actor,'export_prepared',r.revision,new_export,encode(sha256(convert_to(data::text,'UTF8')),'hex'));
  return jsonb_build_object('request_id',r.id,'export_id',new_export,'reference','DSAR-'||upper(left(r.id::text,8)),
    'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',(select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(data) k));
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

-- 4. Confirm: the data, the record and the member's notice, together.
CREATE OR REPLACE FUNCTION internal.confirm_frontend_privacy_export(p_case uuid, p_revision integer, p_export uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;
  prepared private.privacy_request_events;done private.privacy_request_events;data jsonb;bell boolean;notice uuid;
begin
  if p_export is null then raise exception 'export id required' using errcode='22023';end if;
  -- The row lock makes confirmations of one request (and the limit on them)
  -- happen one at a time.
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or not r.identity_verified
      or not (r.status='in_progress' or (r.status='completed' and r.completed_at>clock_timestamp()-interval '696 hours'
        and r.minimised_at is null))
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  -- A member who cannot see the bell (no account access, or a deleted
  -- account) is told only by email: no export unless that email can be
  -- delivered under the email job's own rule.
  if r.subject_user_id is not null and not exists(select 1 from private.current_account_access a where a.id=r.subject_user_id)
      and not internal.privacy_notice_deliverable(r)
    then raise exception 'The member can''t be notified right now, so nothing was exported. Contact the member and update the request first.'
      using errcode='55000', detail='member_not_notifiable';end if;
  select * into prepared from private.privacy_request_events e
    where e.export_id=p_export and e.action='export_prepared' and e.request_id=r.id;
  if not found or prepared.actor_id is distinct from actor or prepared.represented_revision<>r.revision
    then raise exception 'prepared export required' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='exported')
    then raise exception 'export already confirmed' using errcode='PT409';end if;
  if exists(select 1 from private.privacy_request_events e where e.export_id=p_export and e.action='export_refused')
    then raise exception 'prepared export refused' using errcode='PT409';end if;
  if prepared.occurred_at<clock_timestamp()-interval '15 minutes'
    then raise exception 'prepared export expired' using errcode='PT409';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  -- Built again before anything is recorded (the notice below changes the
  -- notifications dataset); it must be exactly what was prepared.
  begin
    data:=case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end;
  exception when sqlstate 'PT413' then data:=null;
  end;
  perform internal.staff_actor('dsar:manage');
  if data is null or encode(sha256(convert_to(data::text,'UTF8')),'hex') is distinct from prepared.export_digest then
    -- Recorded (not raised): the build counts toward the hourly limit and
    -- this export id cannot be confirmed any more.
    insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
      values(r.id,actor,'export_refused',r.revision,p_export);
    return jsonb_build_object('request_id',r.id,'export_id',p_export,
      'refused',case when data is null then 'too_large' else 'changed' end);
  end if;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision,export_id)
    values(r.id,actor,'exported',r.revision,p_export)
    on conflict (export_id,action) where export_id is not null do nothing
    returning * into done;
  if done.id is null then raise exception 'export already confirmed' using errcode='PT409';end if;
  -- The member is told of every export. The account the request names gets
  -- a bell notice; the insert must return its row, so a trigger or rule that
  -- drops it aborts the whole export. The requester is emailed: once per
  -- request while the account can sign in (and so see the bell), on every
  -- export otherwise (no account, or closed, banned, suspended or
  -- restricted): a delivered (or abandoned) email is armed again, one still
  -- waiting covers this export too.
  bell:=r.subject_user_id is not null and exists(select 1 from private.current_account_access a where a.id=r.subject_user_id);
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported')
    on conflict(request_id,kind) do update set delivered_at=null,attempts=0,next_attempt_at=clock_timestamp(),
      claim_token=null,locked_until=null
    where not bell and (privacy_notice_jobs.delivered_at is not null or (privacy_notice_jobs.attempts>=8
      and (privacy_notice_jobs.locked_until is null or privacy_notice_jobs.locked_until<clock_timestamp())));
  if not bell and not exists(select 1 from private.privacy_notice_jobs j where j.request_id=r.id and j.kind='exported'
      and j.delivered_at is null and j.attempts<8)
    then raise exception 'export email could not be queued' using errcode='55000';end if;
  if r.subject_user_id is not null then
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_user_id,'privacy_export_made',r.id)
      returning id into notice;
    if notice is null then raise exception 'export notice could not be recorded' using errcode='55000';end if;
    perform internal.signal_owner_inbox(r.subject_user_id);
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

-- 5. The old command until the contract step: the same requests, limits and
-- notices as the new commands, and an hourly limit per staff member and
-- request.
CREATE OR REPLACE FUNCTION internal.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;result jsonb;bell boolean;notice uuid;
begin
  select * into r from private.privacy_requests where id=p_case for no key update;
  if not found or r.revision is distinct from p_revision or r.type<>'access' or not r.identity_verified
      or not (r.status='in_progress' or (r.status='completed' and r.completed_at>clock_timestamp()-interval '696 hours'
        and r.minimised_at is null))
    then raise exception 'represented verified access request required' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must export your request' using errcode='42501';end if;
  -- A member who cannot see the bell (no account access, or a deleted
  -- account) is told only by email: no export unless that email can be
  -- delivered under the email job's own rule.
  if r.subject_user_id is not null and not exists(select 1 from private.current_account_access a where a.id=r.subject_user_id)
      and not internal.privacy_notice_deliverable(r)
    then raise exception 'The member can''t be notified right now, so nothing was exported. Contact the member and update the request first.'
      using errcode='55000', detail='member_not_notifiable';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.actor_id=actor
      and e.action='exported' and e.occurred_at>clock_timestamp()-interval '1 hour')>=10
    then raise exception 'export limit reached' using errcode='PT429';end if;
  if (select count(*) from private.privacy_request_events e where e.request_id=r.id and e.action='exported')>=5
    then raise exception 'export limit for this request reached' using errcode='PT429';end if;
  result:=jsonb_build_object('request_id',r.id,'reference','DSAR-'||upper(left(r.id::text,8)),
    'generated_at',clock_timestamp(),'request_type',r.type,'received_at',r.received_at,'due_by',r.effective_due_at,
    'account_found',r.subject_user_id is not null,
    'datasets',case when r.subject_user_id is null then '{}'::jsonb else internal.frontend_privacy_export_data(r.subject_user_id) end);
  perform internal.staff_actor('dsar:manage');
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision) values(r.id,actor,'exported',r.revision);
  -- The member is told of every export. The account the request names gets
  -- a bell notice; the insert must return its row, so a trigger or rule that
  -- drops it aborts the whole export. The requester is emailed: once per
  -- request while the account can sign in (and so see the bell), on every
  -- export otherwise (no account, or closed, banned, suspended or
  -- restricted): a delivered (or abandoned) email is armed again, one still
  -- waiting covers this export too.
  bell:=r.subject_user_id is not null and exists(select 1 from private.current_account_access a where a.id=r.subject_user_id);
  insert into private.privacy_notice_jobs(request_id,kind) values(r.id,'exported')
    on conflict(request_id,kind) do update set delivered_at=null,attempts=0,next_attempt_at=clock_timestamp(),
      claim_token=null,locked_until=null
    where not bell and (privacy_notice_jobs.delivered_at is not null or (privacy_notice_jobs.attempts>=8
      and (privacy_notice_jobs.locked_until is null or privacy_notice_jobs.locked_until<clock_timestamp())));
  if not bell and not exists(select 1 from private.privacy_notice_jobs j where j.request_id=r.id and j.kind='exported'
      and j.delivered_at is null and j.attempts<8)
    then raise exception 'export email could not be queued' using errcode='55000';end if;
  if r.subject_user_id is not null then
    insert into private.notifications(account_id,kind,subject_id) values(r.subject_user_id,'privacy_export_made',r.id)
      returning id into notice;
    if notice is null then raise exception 'export notice could not be recorded' using errcode='55000';end if;
    perform internal.signal_owner_inbox(r.subject_user_id);
  end if;
  return result;
end$function$;
alter function internal.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function internal.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function internal.export_frontend_privacy_request(uuid,integer) to authenticated;

-- 6. Retention: the digest of a prepared export never confirmed is cleared a
-- day after the export expired.
CREATE OR REPLACE FUNCTION internal.retention_privacy_requests(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare minimised integer; purged integer; cleared integer;
begin
  with due as (
    select r.id from private.privacy_requests r
      cross join lateral (select coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at) c
    where r.status in ('completed', 'rejected') and r.minimised_at is null
      and (c.closed_at < statement_timestamp() - interval '30 days'
        or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = r.id and j.delivered_at is null))
      -- Never while an access export may still be telling the member: an
      -- export in the last 24 hours, or its email still being tried.
      and not exists (select 1 from private.privacy_request_events e where e.request_id = r.id
        and e.action = 'exported' and e.occurred_at > statement_timestamp() - interval '24 hours')
      and not exists (select 1 from private.privacy_notice_jobs j where j.request_id = r.id
        and j.kind = 'exported' and j.delivered_at is null and j.attempts < 8)
    order by c.closed_at limit p_limit
    -- A request an export holds is left for the next run.
    for update of r skip locked
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
  -- The digest of a prepared access export that was never confirmed, a day
  -- after the export expired (15 minutes after it was prepared).
  update private.privacy_request_events e set export_digest = null
  where e.id in (select p.id from private.privacy_request_events p
    where p.action = 'export_prepared' and p.export_digest is not null
      and p.occurred_at < statement_timestamp() - interval '1 day 15 minutes'
      and not exists (select 1 from private.privacy_request_events x
        where x.export_id = p.export_id and x.action = 'exported')
    order by p.occurred_at limit p_limit);
  get diagnostics cleared = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged, 'export_digests_cleared', cleared);
end;
$function$;
alter function internal.retention_privacy_requests(integer) owner to postgres;
revoke all on function internal.retention_privacy_requests(integer) from public, anon, authenticated, service_role;

notify pgrst,'reload schema';
commit;
