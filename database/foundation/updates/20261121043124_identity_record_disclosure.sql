-- Authority requests: a staff member opens a member's kept identity record to
-- answer a police or court request, and every opening is logged first.
--
-- From this update:
-- 1. New staff capability identity:disclose, held by the governor and admin
--    roles only, with a recent second factor (internal.staff_actor: an
--    authenticator code from the last 15 minutes). Moderators never hold it.
-- 2. New append-only log private.identity_disclosures: one row per opening,
--    written before anything about the person is returned. It records who
--    opened it, when, the request (type from a
--    closed list, reference and reason, and the staff member's confirmation that the request is genuine
--    and signed), what was searched (kind and value: a post id or link, the ID
--    number's one-way fingerprint made by the website's server, a phone number
--    or an email address; never a name) and the outcome: record, no_record (an
--    account was found but no identity is kept for it), attempt_only (the ID
--    number was only ever tried, never accepted) or no_match. A search that
--    finds nobody is logged too. At most five accounts are named (the most
--    recent); match_count keeps the total. Each row closes 15 minutes after it
--    was opened (closes_at, fixed by a check).
-- 3. New append-only log private.identity_disclosure_events: every later look
--    at an open disclosure (viewed, printed, selfie_viewed).
--    Both logs refuse update, delete and truncate (internal.append_only_guard);
--    a delete is possible only under the retention setting vm.retention, and
--    no retention job deletes them yet (their keeping period is for the owner
--    to decide).
-- 4. Commands, all through internal.staff_actor('identity:disclose'):
--    - api.open_identity_disclosure(...) writes the log row and returns only
--      its id, number, outcome, match count and closing time: no personal
--      data.
--    - api.read_identity_disclosure(disclosure, purpose, subject) returns the
--      record of an open disclosure (full names as on the ID, whether the ID
--      number and the selfie are still kept, the ID photo's state, every
--      verified phone number with its dates, the verification date) and logs
--      the look first (purpose view, print or selfie). Only the staff member
--      who opened it, until it closes (PT409,
--      details disclosure_unavailable and disclosure_closed). For an ID number
--      that was only tried, it returns the accounts and dates of the attempts
--      and nothing more.
--    - api.list_identity_disclosures() lists the latest 50 openings for staff
--      holding the capability: number, date, who opened it, request type and
--      reference, outcome, whether it was viewed or printed; no personal data
--      about the person.
--    - api.identity_disclosure_material(disclosure, staff) (service only) gives
--      the website's server the encrypted ID number and the selfie's stored
--      object of an open disclosure opened by that staff member, so it can
--      decrypt the number and show the selfie. Browsers never receive object
--      keys or ciphertext.
-- 5. The staff audit trail (private.frontend_staff_audit_events) lists each
--    opening and each later look, with the disclosure number, the request type
--    and reference: never the search value or the record.
--
-- New commands only (expand); no existing command changes. The audit trail
-- uses the existing target type 'account', so the live website reads it
-- before its release. ORDER: apply first, then merge.
-- Read-only preflight: ../preflight/20261121043124_identity_record_disclosure.check.sql.
-- Rollback: ../rollback/20261121043124_identity_record_disclosure.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does; the
-- functions it relies on have their reviewed bodies; the audit trail is the
-- reviewed view (or this update's).
do $$
declare present integer;
begin
  select (to_regclass('private.identity_disclosures') is not null)::integer
    + (to_regclass('private.identity_disclosure_events') is not null)::integer
    + (to_regprocedure('api.open_identity_disclosure(text,text,text,text,text,boolean)') is not null)::integer
    + (to_regprocedure('api.read_identity_disclosure(uuid,text,uuid)') is not null)::integer
    + (to_regprocedure('api.list_identity_disclosures()') is not null)::integer
    + (to_regprocedure('api.identity_disclosure_material(uuid,uuid)') is not null)::integer
  into present;
  if present not in (0, 6) then
    raise exception 'identity record disclosure precondition: % of 6 objects exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.staff_actor(text)')) is distinct from '269f0871f156f57c029cedcab72f6c3f' then
    raise exception 'identity record disclosure drift: internal.staff_actor is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.append_only_guard()')) is distinct from 'dfac5657b00f4d86a399e04e44d2ea59' then
    raise exception 'identity record disclosure drift: internal.append_only_guard is not the reviewed body' using errcode='55000';
  end if;
  if md5(pg_get_viewdef('private.frontend_staff_audit_events'::regclass)) not in ('6dc98a28338eefafbd8316660243f70d', '79d4c93c1637629c23a46f077320addb') then
    raise exception 'identity record disclosure drift: private.frontend_staff_audit_events is not the reviewed view' using errcode='55000';
  end if;
end$$;

-- 1. The capability: governors and admins, recent second factor.
insert into private.staff_capabilities(role, capability, requires_recent_mfa)
  values ('governor', 'identity:disclose', true), ('admin', 'identity:disclose', true)
  on conflict (role, capability) do update set requires_recent_mfa = true;

-- 2. The log of openings.
create table if not exists private.identity_disclosures (
  id uuid not null default gen_random_uuid(),
  number bigint generated always as identity,
  opened_by uuid not null,
  opened_at timestamptz not null,
  closes_at timestamptz not null,
  request_type text not null,
  request_reference text not null,
  reason text not null,
  attested boolean not null,
  lookup_kind text not null,
  lookup_value text not null,
  outcome text not null,
  subject_ids uuid[] not null default '{}',
  match_count integer not null,
  constraint identity_disclosures_pkey primary key (id),
  constraint identity_disclosures_number_key unique (number),
  constraint identity_disclosures_opened_by_fkey foreign key (opened_by)
    references auth.users(id) on delete restrict,
  constraint identity_disclosures_closes_check check (closes_at = opened_at + interval '15 minutes'),
  constraint identity_disclosures_request_type_check
    check (request_type in ('subpoena','court_order','warrant','police_case','regulator')),
  constraint identity_disclosures_reference_check check (length(request_reference) between 3 and 100),
  constraint identity_disclosures_reason_check check (length(reason) between 10 and 2000),
  constraint identity_disclosures_attested_check check (attested),
  constraint identity_disclosures_lookup_kind_check check (lookup_kind in ('post','id_number','phone','email')),
  constraint identity_disclosures_lookup_value_check check (length(lookup_value) between 3 and 254),
  constraint identity_disclosures_outcome_check
    check (outcome in ('record','no_record','attempt_only','no_match')),
  constraint identity_disclosures_subjects_check check (cardinality(subject_ids) <= 5
    and (outcome = 'no_match') = (cardinality(subject_ids) = 0)
    and (outcome <> 'attempt_only' or lookup_kind = 'id_number')),
  constraint identity_disclosures_match_count_check check (match_count >= cardinality(subject_ids))
);
alter table private.identity_disclosures owner to postgres;
alter table private.identity_disclosures enable row level security;
revoke all on private.identity_disclosures from public, anon, authenticated, service_role;
create index if not exists identity_disclosures_opened_by_idx
  on private.identity_disclosures using btree (opened_by, opened_at desc);
create index if not exists identity_disclosures_opened_at_idx
  on private.identity_disclosures using btree (opened_at desc, id desc);
comment on table private.identity_disclosures is 'Authority requests: one append-only row per opening of a member''s kept identity record by a governor or admin, written before anything is shown; a search that finds nobody is logged too. Closes 15 minutes after opening.';
drop trigger if exists identity_disclosures_append_only on private.identity_disclosures;
create trigger identity_disclosures_append_only before delete or update on private.identity_disclosures
  for each row execute function internal.append_only_guard();
drop trigger if exists identity_disclosures_no_truncate on private.identity_disclosures;
create trigger identity_disclosures_no_truncate before truncate on private.identity_disclosures
  for each statement execute function internal.append_only_guard();

-- 3. Every later look at an open disclosure, and an early close.
create table if not exists private.identity_disclosure_events (
  id uuid not null default gen_random_uuid(),
  disclosure_id uuid not null,
  staff_id uuid not null,
  kind text not null,
  subject_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint identity_disclosure_events_pkey primary key (id),
  constraint identity_disclosure_events_disclosure_id_fkey foreign key (disclosure_id)
    references private.identity_disclosures(id) on delete cascade,
  constraint identity_disclosure_events_staff_id_fkey foreign key (staff_id)
    references auth.users(id) on delete restrict,
  constraint identity_disclosure_events_kind_check check (kind in ('viewed','printed','selfie_viewed')),
  constraint identity_disclosure_events_subject_check check ((kind = 'selfie_viewed') = (subject_id is not null))
);
alter table private.identity_disclosure_events owner to postgres;
alter table private.identity_disclosure_events enable row level security;
revoke all on private.identity_disclosure_events from public, anon, authenticated, service_role;
create index if not exists identity_disclosure_events_disclosure_idx
  on private.identity_disclosure_events using btree (disclosure_id, kind);
create index if not exists identity_disclosure_events_staff_idx
  on private.identity_disclosure_events using btree (staff_id);
comment on table private.identity_disclosure_events is 'Authority requests: append-only record of every look at an open disclosure (viewed, printed, selfie_viewed) and of an early close.';
drop trigger if exists identity_disclosure_events_append_only on private.identity_disclosure_events;
create trigger identity_disclosure_events_append_only before delete or update on private.identity_disclosure_events
  for each row execute function internal.append_only_guard();
drop trigger if exists identity_disclosure_events_no_truncate on private.identity_disclosure_events;
create trigger identity_disclosure_events_no_truncate before truncate on private.identity_disclosure_events
  for each statement execute function internal.append_only_guard();

-- Helpers.
-- Whether a request text is usable: trimmed length within bounds and no
-- hidden formatting characters (the privacy request rule).
CREATE OR REPLACE FUNCTION internal.identity_disclosure_text_ok(p_value text, p_min integer, p_max integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.privacy_text(p_value,p_min,p_max);
  return true;
exception when invalid_parameter_value then
  return false;
end;
$function$;
alter function internal.identity_disclosure_text_ok(text,integer,integer) owner to postgres;
revoke all on function internal.identity_disclosure_text_ok(text,integer,integer) from public, anon, authenticated, service_role;

-- The disclosure, still open, for the staff member who opened it while that
-- staff member still holds identity:disclose. Another staff member's
-- disclosure and an unknown one give the same answer.
CREATE OR REPLACE FUNCTION internal.identity_disclosure_open_for(p_disclosure uuid, p_staff uuid)
 RETURNS private.identity_disclosures
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare d private.identity_disclosures;
begin
  select x.* into d from private.identity_disclosures x where x.id=p_disclosure;
  if not found or d.opened_by is distinct from p_staff or not exists(select 1 from private.staff_roles r
      join private.staff_capabilities c on c.role=r.role
      where r.user_id=p_staff and r.revoked_at is null and c.capability='identity:disclose') then
    raise exception 'disclosure unavailable' using errcode='PT409',detail='disclosure_unavailable'; end if;
  if d.closes_at<=clock_timestamp() then
    raise exception 'disclosure closed' using errcode='PT409',detail='disclosure_closed'; end if;
  return d;
end;
$function$;
alter function internal.identity_disclosure_open_for(uuid,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_open_for(uuid,uuid) from public, anon, authenticated, service_role;

-- What a disclosure shows about one named account. A kept record: the newest
-- accepted identity of the account. An ID number that was only tried: the
-- dates it was tried on this account, nothing more.
CREATE OR REPLACE FUNCTION internal.identity_disclosure_record(p_disclosure private.identity_disclosures, p_subject uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_disclosure.outcome='attempt_only' then jsonb_build_object(
      'account_id',p_subject,'kept',false,
      'attempts',coalesce((select jsonb_agg(t.created_at order by t.created_at desc)
        from (select x.created_at from private.verification_identity_submissions x
          where x.owner_id=p_subject and x.identity_hmac=p_disclosure.lookup_value
          order by x.created_at desc limit 20) t),'[]'::jsonb))
    else coalesce((select jsonb_build_object(
      'account_id',p_subject,'kept',true,
      'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject),
      'legal_first_name',coalesce(n.legal_first_name,case when p.legal_name_fact_id=f.id then p.legal_first_name end),
      'legal_last_name',coalesce(n.legal_last_name,case when p.legal_name_fact_id=f.id then p.legal_last_name end),
      'verified_at',f.reviewed_at,
      'verification_revoked_at',f.revoked_at,
      'checked_by',case s.recipe when 'manual-id-selfie-v1' then 'staff_review' else 'other' end,
      'id_number_kept',s.number_erased_at is null,
      'id_number_erased_at',s.number_erased_at,
      'selfie',jsonb_build_object('kept',coalesce(sa.state in ('uploaded','clean'),false),'taken_at',sa.created_at,
        'deleted_at',case when sa.state not in ('uploaded','clean') then coalesce(sa.deleted_at,sa.state_changed_at) end),
      'id_photo',jsonb_build_object('kept',coalesce(ia.state in ('uploaded','clean'),false),'taken_at',ia.created_at,
        'deleted_at',case when ia.state not in ('uploaded','clean') then coalesce(ia.deleted_at,ia.state_changed_at) end),
      'phones',coalesce((select jsonb_agg(jsonb_build_object('phone',v.phone,'verified_at',v.verified_at,
          'revoked_at',v.revoked_at) order by v.verified_at desc)
        from (select y.phone,y.verified_at,y.revoked_at from private.verification_phone_proofs y
          where y.owner_id=p_subject order by y.verified_at desc limit 20) v),'[]'::jsonb))
      from private.accepted_identity_facts f
      join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
      left join private.identity_submission_names n on n.submission_id=s.id
      left join private.profiles p on p.account_id=f.owner_id
      left join private.evidence_artifacts sa on sa.id=s.selfie_artifact_id
      left join private.evidence_artifacts ia on ia.id=s.id_artifact_id
      where f.owner_id=p_subject
      order by f.reviewed_at desc, f.id desc limit 1),
      jsonb_build_object('account_id',p_subject,'kept',false,
        'account_closed_at',(select c.closed_at from private.account_closures c where c.user_id=p_subject)))
  end;
$function$;
alter function internal.identity_disclosure_record(private.identity_disclosures,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_record(private.identity_disclosures,uuid) from public, anon, authenticated, service_role;

-- 4a. Open a record: check the request, find the person, log, then answer
-- with the log row's id only.
CREATE OR REPLACE FUNCTION internal.open_identity_disclosure(p_request_type text, p_reference text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose');
  v_value text; post uuid; matched uuid[]; outcome text; made timestamptz; d private.identity_disclosures;
begin
  if p_request_type is null or p_request_type not in ('subpoena','court_order','warrant','police_case','regulator') then
    raise exception 'valid request type required' using errcode='22023',detail='disclosure_request_type_invalid'; end if;
  if not internal.identity_disclosure_text_ok(p_reference,3,100) then
    raise exception 'request reference required' using errcode='22023',detail='disclosure_reference_required'; end if;
  if not internal.identity_disclosure_text_ok(p_reason,10,2000) then
    raise exception 'reason required' using errcode='22023',detail='disclosure_reason_required'; end if;
  if p_attested is distinct from true then
    raise exception 'confirm that the request is genuine and signed' using errcode='22023',detail='disclosure_attestation_required'; end if;
  -- Never by name: only these four kinds exist.
  if p_lookup_kind is null or p_lookup_kind not in ('post','id_number','phone','email') then
    raise exception 'search by post link, ID number, phone or email' using errcode='22023',detail='disclosure_lookup_invalid'; end if;
  v_value:=btrim(p_lookup_value);
  if p_lookup_kind='email' then v_value:=lower(v_value); end if;
  if v_value is null or not (case p_lookup_kind
      when 'post' then v_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or v_value ~ '^[a-z0-9-]{3,60}$'
      when 'id_number' then v_value ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      when 'phone' then v_value ~ '^[+]27[0-9]{9}$'
      else length(v_value)<=254 and v_value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' end) then
    raise exception 'valid search value required' using errcode='22023',detail='disclosure_lookup_value_invalid'; end if;


  if p_lookup_kind='post' then
    if v_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then post:=v_value::uuid;
    else select s.post_id into post from private.post_slugs s where s.slug=v_value; end if;
    select coalesce(array_agg(p.owner_id),'{}') into matched from private.posts p where p.id=post;
  elsif p_lookup_kind='id_number' then
    select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
      from (select f.owner_id,max(f.reviewed_at) last_at from private.accepted_identity_facts f
        where f.identity_hmac=v_value group by f.owner_id) x;
    if cardinality(matched)=0 then
      select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
        from (select s.owner_id,max(s.created_at) last_at from private.verification_identity_submissions s
          where s.identity_hmac=v_value group by s.owner_id) x;
      outcome:=case when cardinality(matched)>0 then 'attempt_only' end;
    end if;
  elsif p_lookup_kind='phone' then
    select coalesce(array_agg(x.owner_id order by x.last_at desc, x.owner_id),'{}') into matched
      from (select v.owner_id,max(v.verified_at) last_at from private.verification_phone_proofs v
        where v.phone=v_value group by v.owner_id) x;
  else
    select coalesce(array_agg(u.id order by u.id),'{}') into matched from auth.users u where lower(u.email)=v_value;
  end if;
  if outcome is null then
    outcome:=case when cardinality(matched)=0 then 'no_match'
      when exists(select 1 from private.accepted_identity_facts f where f.owner_id=any(matched[1:5])) then 'record'
      else 'no_record' end;
  end if;

  -- The log row is written before anything about the person is answered.
  made:=clock_timestamp();
  insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,
      request_reference,reason,attested,lookup_kind,lookup_value,outcome,subject_ids,match_count)
    values(actor,made,made+interval '15 minutes',p_request_type,
      btrim(p_reference),btrim(p_reason),true,p_lookup_kind,v_value,outcome,
      matched[1:5],cardinality(matched))
    returning * into d;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object('disclosure_id',d.id,'number',d.number,'outcome',d.outcome,
    'match_count',d.match_count,'closes_at',d.closes_at);
end;
$function$;
alter function internal.open_identity_disclosure(text,text,text,text,text,boolean) owner to postgres;
revoke all on function internal.open_identity_disclosure(text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.open_identity_disclosure(text,text,text,text,text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.open_identity_disclosure(p_request_type text, p_reference text, p_reason text, p_lookup_kind text, p_lookup_value text, p_attested boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.open_identity_disclosure(p_request_type,p_reference,p_reason,p_lookup_kind,p_lookup_value,p_attested);
$function$;
alter function api.open_identity_disclosure(text,text,text,text,text,boolean) owner to postgres;
revoke all on function api.open_identity_disclosure(text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function api.open_identity_disclosure(text,text,text,text,text,boolean) to authenticated;

-- 4b. Read an open disclosure: log the look, then answer.
CREATE OR REPLACE FUNCTION internal.read_identity_disclosure(p_disclosure uuid, p_purpose text, p_subject uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity:disclose'); d private.identity_disclosures; records jsonb;
begin
  if p_purpose is null or p_purpose not in ('view','print','selfie') then
    raise exception 'valid purpose required' using errcode='22023',detail='disclosure_purpose_invalid'; end if;
  if p_disclosure is null or (p_purpose='selfie')<>(p_subject is not null) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,actor);
  if p_subject is not null and (d.outcome<>'record' or not p_subject=any(d.subject_ids)) then
    raise exception 'valid disclosure required' using errcode='22023',detail='disclosure_subject_invalid'; end if;
  -- The look is logged before anything is answered.
  insert into private.identity_disclosure_events(disclosure_id,staff_id,kind,subject_id)
    values(d.id,actor,case p_purpose when 'view' then 'viewed' when 'print' then 'printed' else 'selfie_viewed' end,p_subject);
  select coalesce(jsonb_agg(internal.identity_disclosure_record(d,u.subject) order by u.ord),'[]'::jsonb) into records
    from unnest(d.subject_ids) with ordinality u(subject,ord)
    where p_subject is null or u.subject=p_subject;
  perform internal.staff_actor('identity:disclose');
  return jsonb_build_object(
    'disclosure',jsonb_build_object('id',d.id,'number',d.number,'opened_at',d.opened_at,'closes_at',d.closes_at,
      'opened_by_name',(select internal.profile_public_name(p.display_name) from private.profiles p where p.account_id=d.opened_by),
      'request_type',d.request_type,'reference',d.request_reference,'reason',d.reason,
      'lookup_kind',d.lookup_kind,
      'lookup_value',case when d.lookup_kind='id_number' then null else d.lookup_value end,
      'outcome',d.outcome,'match_count',d.match_count),
    'records',records);
end;
$function$;
alter function internal.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function internal.read_identity_disclosure(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.read_identity_disclosure(uuid,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.read_identity_disclosure(p_disclosure uuid, p_purpose text, p_subject uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.read_identity_disclosure(p_disclosure,p_purpose,p_subject);
$function$;
alter function api.read_identity_disclosure(uuid,text,uuid) owner to postgres;
revoke all on function api.read_identity_disclosure(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function api.read_identity_disclosure(uuid,text,uuid) to authenticated;

-- 4d. The latest openings (no personal data about the person).
CREATE OR REPLACE FUNCTION internal.list_identity_disclosures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare items jsonb;
begin
  perform internal.staff_actor('identity:disclose');
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'opened_at',d.opened_at,
      'opened_by_name',internal.profile_public_name(p.display_name),
      'request_type',d.request_type,'reference',d.request_reference,'outcome',d.outcome,
      'viewed',exists(select 1 from private.identity_disclosure_events e where e.disclosure_id=d.id and e.kind='viewed'),
      'printed',exists(select 1 from private.identity_disclosure_events e where e.disclosure_id=d.id and e.kind='printed'))
    order by d.opened_at desc,d.id desc),'[]'::jsonb) into items
  from (select x.* from private.identity_disclosures x order by x.opened_at desc,x.id desc limit 50) d
  left join private.profiles p on p.account_id=d.opened_by;
  return jsonb_build_object('items',items);
end;
$function$;
alter function internal.list_identity_disclosures() owner to postgres;
revoke all on function internal.list_identity_disclosures() from public, anon, authenticated, service_role;
grant execute on function internal.list_identity_disclosures() to authenticated;

CREATE OR REPLACE FUNCTION api.list_identity_disclosures()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_identity_disclosures();
$function$;
alter function api.list_identity_disclosures() owner to postgres;
revoke all on function api.list_identity_disclosures() from public, anon, authenticated, service_role;
grant execute on function api.list_identity_disclosures() to authenticated;

-- 4e. For the website's server only: what it needs to show the ID number
-- and the selfie of an open disclosure opened by that staff member.
CREATE OR REPLACE FUNCTION internal.identity_disclosure_material(p_disclosure uuid, p_staff uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare d private.identity_disclosures; records jsonb:='[]'::jsonb;
begin
  if p_disclosure is null or p_staff is null then
    raise exception 'disclosure and staff member required' using errcode='22023'; end if;
  d:=internal.identity_disclosure_open_for(p_disclosure,p_staff);
  if d.outcome='record' then
    select coalesce(jsonb_agg(x.material order by u.ord),'[]'::jsonb) into records
      from unnest(d.subject_ids) with ordinality u(subject,ord)
      cross join lateral (select jsonb_build_object('account_id',f.owner_id,'submission_id',s.id,
          'encrypted_number',case when s.number_erased_at is null then jsonb_build_object('ciphertext',s.number_ciphertext,
            'iv',s.number_iv,'tag',s.number_tag,'key_id',s.encryption_key_id) end,
          'selfie',case when a.state in ('uploaded','clean') and a.sha256 is not null and a.size_bytes is not null
            then jsonb_build_object('artifact_id',a.id,'case_id',a.case_id,'object_key',a.object_key,
              'sha256',a.sha256,'size_bytes',a.size_bytes) end) material
        from private.accepted_identity_facts f
        join private.verification_identity_submissions s on s.id=f.submission_id and s.owner_id=f.owner_id
        left join private.evidence_artifacts a on a.id=s.selfie_artifact_id
        where f.owner_id=u.subject
        order by f.reviewed_at desc, f.id desc limit 1) x;
  end if;
  return jsonb_build_object('disclosure_id',d.id,'records',records);
end;
$function$;
alter function internal.identity_disclosure_material(uuid,uuid) owner to postgres;
revoke all on function internal.identity_disclosure_material(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.identity_disclosure_material(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION api.identity_disclosure_material(p_disclosure uuid, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.identity_disclosure_material(p_disclosure,p_staff);
$function$;
alter function api.identity_disclosure_material(uuid,uuid) owner to postgres;
revoke all on function api.identity_disclosure_material(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.identity_disclosure_material(uuid,uuid) to service_role;

-- 5. The staff audit trail: every opening and every later look, with the
-- disclosure number, the request type and reference (never the search value
-- or the record).
create or replace view private.frontend_staff_audit_events with (security_invoker=true) as
 SELECT frontend_staff_nonpayment_audit_events.id,
    frontend_staff_nonpayment_audit_events.occurred_at,
    frontend_staff_nonpayment_audit_events.actor_id,
    frontend_staff_nonpayment_audit_events.target_id,
    frontend_staff_nonpayment_audit_events.target_type,
    frontend_staff_nonpayment_audit_events.action,
    frontend_staff_nonpayment_audit_events.reason
   FROM private.frontend_staff_nonpayment_audit_events
UNION ALL
 SELECT 'payment:'::text || r.payment_id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || r.kind AS action,
    r.reason
   FROM private.frontend_payment_reversals r
UNION ALL
 SELECT 'payment_activation:'::text || a.payment_id::text AS id,
    a.created_at AS occurred_at,
    a.actor_id,
    a.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:activated'::text AS action,
    a.reason
   FROM private.payment_activations a
UNION ALL
 SELECT 'payment_refund_request:'::text || q.id::text AS id,
    q.requested_at AS occurred_at,
    q.requested_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_recorded'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_approved'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_declined'::text AS action,
    q.decline_reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_slot:'::text || l.id::text AS id,
    l.reversed_at AS occurred_at,
    l.reversed_by AS actor_id,
    l.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:slot_'::text || l.reversal_kind AS action,
    l.reversal_reason AS reason
   FROM private.payment_lines l
  WHERE l.reversed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_recorded:'::text || t.id::text AS id,
    t.recorded_at AS occurred_at,
    t.recorded_by AS actor_id,
    COALESCE(t.payment_id, t.id) AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_recorded'::text AS action,
    (((((((('Bank transfer '::text || t.bank_reference) || ' cleared '::text) || to_char(t.cleared_on::timestamp without time zone, 'YYYY-MM-DD'::text)) || ' ('::text) || t.slots) || ' slots, '::text) || t.amount_received_cents) || ' cents): '::text) || t.reason AS reason
   FROM private.invoice_transfers t
UNION ALL
 SELECT 'payment_invoice_confirmed:'::text || t.id::text AS id,
    t.confirmed_at AS occurred_at,
    t.confirmed_by AS actor_id,
    t.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_confirmed'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' confirmed'::text AS reason
   FROM private.invoice_transfers t
  WHERE t.confirmed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_declined:'::text || t.id::text AS id,
    t.declined_at AS occurred_at,
    t.declined_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_declined'::text AS action,
    (('Bank transfer '::text || t.bank_reference) || ' declined: '::text) || t.decline_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_expired:'::text || t.id::text AS id,
    COALESCE(t.expired_at, t.recorded_at + internal.invoice_transfer_expires_after()) AS occurred_at,
    NULL::uuid AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' expired: not confirmed within 14 days of being recorded'::text AS reason
   FROM private.invoice_transfers t
  WHERE internal.invoice_transfer_expired(t.*)
UNION ALL
 SELECT 'payment_invoice_resolved:'::text || t.id::text AS id,
    t.resolved_at AS occurred_at,
    t.resolved_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired_resolved'::text AS action,
    (((('Bank transfer '::text || t.bank_reference) || ' expired, resolved: '::text) ||
        CASE t.resolution
            WHEN 'returned'::text THEN 'money returned outside VerifyMzansi'::text
            ELSE 'money never arrived'::text
        END) || ': '::text) || t.resolution_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.resolved_by IS NOT NULL
UNION ALL
 SELECT 'customer_invoice_issued:'::text || i.id::text AS id,
    i.issued_at AS occurred_at,
    i.issued_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_issued'::text AS action,
    (((((('Invoice '::text || i.invoice_number) || ' ('::text) || i.slots) || ' slots, '::text) || i.total_cents) || ' cents): '::text) || i.issue_reason AS reason
   FROM private.customer_invoices i
UNION ALL
 SELECT 'customer_invoice_voided:'::text || i.id::text AS id,
    i.voided_at AS occurred_at,
    i.voided_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_voided'::text AS action,
    (('Invoice '::text || i.invoice_number) || ' voided: '::text) || i.void_reason AS reason
   FROM private.customer_invoices i
  WHERE i.voided_by IS NOT NULL
UNION ALL
 SELECT 'identity_disclosure:'::text || d.id::text AS id,
    d.opened_at AS occurred_at,
    d.opened_by AS actor_id,
    CASE WHEN cardinality(d.subject_ids) = 1 THEN d.subject_ids[1] ELSE NULL::uuid END AS target_id,
    'account'::text AS target_type,
    'identity:disclosure_'::text || d.outcome AS action,
    ((((('D-'::text || lpad(d.number::text, GREATEST(4, length(d.number::text)), '0'::text)) || ': '::text) ||
        CASE d.request_type
            WHEN 'subpoena'::text THEN 'subpoena'::text
            WHEN 'court_order'::text THEN 'court order'::text
            WHEN 'warrant'::text THEN 'warrant'::text
            WHEN 'police_case'::text THEN 'police request'::text
            ELSE 'regulator request'::text
        END) || ' '::text) || d.request_reference) || ', searched by '::text || replace(d.lookup_kind, '_'::text, ' '::text) AS reason
   FROM private.identity_disclosures d
UNION ALL
 SELECT ('identity_disclosure_'::text || e.kind) || ':'::text || e.id::text AS id,
    e.occurred_at,
    e.staff_id AS actor_id,
    COALESCE(e.subject_id, CASE WHEN cardinality(d.subject_ids) = 1 THEN d.subject_ids[1] ELSE NULL::uuid END) AS target_id,
    'account'::text AS target_type,
    'identity:disclosure_'::text || e.kind AS action,
    ('D-'::text || lpad(d.number::text, GREATEST(4, length(d.number::text)), '0'::text)) || ' '::text || replace(e.kind, '_'::text, ' '::text) AS reason
   FROM private.identity_disclosure_events e
     JOIN private.identity_disclosures d ON d.id = e.disclosure_id;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public;

-- Who may run the new commands.
do $$
declare f text; expected jsonb;
begin
  for f, expected in select * from (values
      ('api.open_identity_disclosure(text,text,text,text,text,boolean)', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb),
      ('api.read_identity_disclosure(uuid,text,uuid)', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb),
      ('api.list_identity_disclosures()', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb),
      ('api.identity_disclosure_material(uuid,uuid)', '{"anon":false,"authenticated":false,"service_role":true}'::jsonb)) v
  loop
    if (select jsonb_object_agg(r, has_function_privilege(r, f, 'execute'))
        from unnest(array['anon','authenticated','service_role']) r) is distinct from expected then
      raise exception 'identity record disclosure: unexpected grants on %', f;
    end if;
  end loop;
end$$;

notify pgrst,'reload schema';
commit;
