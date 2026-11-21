-- Automatic ID checks: an independent verification partner checks the member's
-- ID and selfie, and an admin setting decides what happens with the result.
--
-- From this update:
-- 1. A setting with three values, changed only by an admin with a recent second
--    factor (new capability identity_check:configure) and a reason; every
--    change is logged in private.identity_check_mode_events:
--    - manual (the starting value): staff review the photos, as today;
--    - staff_final: a clean automatic pass verifies at once; anything else
--      goes to the staff queue;
--    - automatic: a clean pass verifies at once; anything else (declined, "in
--      review", a name mismatch, a banned or already verified ID number, a high
--      risk score) is declined, and the member may ask a person to look again
--      within 5 days.
--    The setting is read when a result arrives. The website can pause automatic
--    checks for everyone (15 minutes after an outage, 1 hour after a balance or
--    settings problem); setting the mode, even to the same value, ends a pause.
-- 2. private.identity_checks: one row per automatic check, bound to the
--    member's open identity case. The partner only ever sees the row's random
--    id: the start context the website compares the result with (the typed
--    legal names at start, a keyed hash of the member's network and the device
--    kind) stays on the row, never in the partner's session. A check that
--    cannot start is "unavailable" and is not counted.
-- 3. Spending guard: at most 3 checks per member in 7 days and 60 checks a day
--    site-wide. Above either, or while the setting is manual or paused,
--    api.get_identity_check_availability answers route "manual" with the reason
--    (limit, paused or mode), and api.start_my_identity_check refuses.
-- 4. A result becomes an ordinary identity submission (the same evidence files,
--    fingerprint, encrypted ID number and names snapshot as the manual route,
--    through internal.complete_evidence_upload and
--    internal.register_identity_submission). A clean pass writes the same
--    accepted identity fact a staff approval writes, with the automatic check
--    recorded as the decider instead of a staff member
--    (accepted_identity_facts.automatic_check_id; reviewed_by is null only
--    then), so the name lock, the outbox notice and everything downstream work
--    unchanged. Bans and the one-account-per-ID rule are checked exactly as in
--    a staff approval. The names the website compared with the ID must be
--    exactly the names the submission records (and a clean pass locks);
--    otherwise the result is not clean (names_differ).
-- 5. A declined check (internal.decline_automatic_identity_submission) keeps
--    its submission but takes it out of the case's current place, so the staff
--    queue never shows it and the member's page offers a new attempt.
--    Within 5 days, api.ask_person_identity_check records the member's request
--    (identity_checks.asked_at and ask_reason) and puts the submission back in
--    the staff queue. The staff decision is the answer: the existing "verified"
--    or "sent back" notice tells the member.
-- 6. The partner's copy of a check is deleted through
--    api.claim_identity_check_deletions and
--    api.mark_identity_check_provider_deleted: a check that never finished at
--    once (also one still unfinished an hour after its 24-hour expiry), a
--    declined check 5 days after the decline unless the member asked a person.
--    Fraud and legal holds keep it. Deleting our own copies of failed attempts
--    is part of the later retention update.
--
-- New tables, columns, constraints and commands only (expand); no existing
-- function body changes. reviewed_by becomes nullable for automatic facts
-- only (a check enforces it). Nothing changes for members or staff while the
-- setting is manual, and the database keeps it manual until the retention
-- update is applied: api.set_identity_check_mode refuses any other value
-- (PT409 identity_check_retention_pending) and that update replaces it (it
-- deletes the partner's copy after a staff rejection and after an unanswered
-- "ask a person"). ORDER: apply first, then merge.
-- Read-only preflight: ../preflight/20261121094003_automatic_identity_checks.check.sql.
-- Rollback: ../rollback/20261121094003_automatic_identity_checks.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does; the
-- functions it relies on have their reviewed bodies; the constraint it widens
-- is the reviewed one (or this update's).
do $$
declare present integer; body record;
begin
  select (to_regclass('private.identity_checks') is not null)::integer
    + (to_regclass('private.identity_check_settings') is not null)::integer
    + (to_regclass('private.identity_check_mode_events') is not null)::integer
    + (to_regprocedure('api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer)') is not null)::integer
  into present;
  if present not in (0, 4) then
    raise exception 'automatic identity checks precondition: % of 4 objects exist', present using errcode='55000';
  end if;
  for body in select * from (values
      ('internal.staff_actor(text)', '269f0871f156f57c029cedcab72f6c3f'),
      ('internal.price_draft_actor()', '1d70271a4447ba5d1377f3f64a6cf029'),
      ('internal.append_only_guard()', 'dfac5657b00f4d86a399e04e44d2ea59'),
      ('internal.open_verification_case()', '5da4c2f247cfcb5718366e4315d23fa8'),
      ('internal.complete_evidence_upload(uuid,text,text,integer)', '4ee99e8aba3021a021f9a52d05936083'),
      ('internal.register_identity_submission(uuid,integer,uuid,uuid,text,text,jsonb,uuid,integer)', 'b8d825cea8120b23aebfc42bb3f3b1ce'),
      ('internal.staff_evidence_metadata(uuid,text,uuid,text)', 'd3d00fec5facacc1da7496142c2c56f4')
    ) v(sig, reviewed) loop
    if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure(body.sig)) is distinct from body.reviewed then
      raise exception 'automatic identity checks drift: % is not the reviewed body', body.sig using errcode='55000';
    end if;
  end loop;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.accepted_identity_facts'::regclass
      and conname='accepted_identity_facts_check2') is distinct from (case when present=0
      then 'CHECK ((second_reviewer IS DISTINCT FROM reviewed_by))'
      else 'CHECK (((reviewed_by IS NULL) OR (second_reviewer IS DISTINCT FROM reviewed_by)))' end) then
    raise exception 'automatic identity checks drift: accepted_identity_facts_check2 is not the reviewed constraint' using errcode='55000';
  end if;
end$$;

-- 1. The capability: admins only, recent second factor.
insert into private.staff_capabilities(role, capability, requires_recent_mfa)
  values ('admin', 'identity_check:configure', true)
  on conflict (role, capability) do update set requires_recent_mfa = true;

-- 2. The setting (one row) and its change log.
create table if not exists private.identity_check_settings (
  id boolean not null default true,
  mode text not null default 'manual',
  paused_until timestamptz,
  pause_reason text,
  changed_at timestamptz not null default statement_timestamp(),
  constraint identity_check_settings_pkey primary key (id),
  constraint identity_check_settings_one_check check (id),
  constraint identity_check_settings_mode_check check (mode in ('manual','staff_final','automatic')),
  constraint identity_check_settings_pause_check check ((paused_until is null) = (pause_reason is null)
    and (pause_reason is null or pause_reason in ('no_credit','outage','not_configured')))
);
alter table private.identity_check_settings owner to postgres;
alter table private.identity_check_settings enable row level security;
revoke all on private.identity_check_settings from public, anon, authenticated, service_role;
insert into private.identity_check_settings(id) values (true) on conflict (id) do nothing;
comment on table private.identity_check_settings is 'Automatic ID checks: the admin setting (manual, staff_final or automatic) and the current pause, one row.';

create table if not exists private.identity_check_mode_events (
  id uuid not null default gen_random_uuid(),
  from_mode text not null,
  to_mode text not null,
  changed_by uuid not null,
  reason text not null,
  changed_at timestamptz not null default statement_timestamp(),
  constraint identity_check_mode_events_pkey primary key (id),
  constraint identity_check_mode_events_changed_by_fkey foreign key (changed_by)
    references auth.users(id) on delete restrict,
  constraint identity_check_mode_events_from_mode_check check (from_mode in ('manual','staff_final','automatic')),
  constraint identity_check_mode_events_to_mode_check check (to_mode in ('manual','staff_final','automatic')),
  constraint identity_check_mode_events_change_check check (from_mode <> to_mode),
  constraint identity_check_mode_events_reason_check check (char_length(reason) between 5 and 500)
);
alter table private.identity_check_mode_events owner to postgres;
alter table private.identity_check_mode_events enable row level security;
revoke all on private.identity_check_mode_events from public, anon, authenticated, service_role;
create index if not exists identity_check_mode_events_changed_by_idx
  on private.identity_check_mode_events using btree (changed_by);
create index if not exists identity_check_mode_events_changed_at_idx
  on private.identity_check_mode_events using btree (changed_at desc, id desc);
drop trigger if exists identity_check_mode_events_append_only on private.identity_check_mode_events;
create trigger identity_check_mode_events_append_only before delete or update on private.identity_check_mode_events
  for each row execute function internal.append_only_guard();
drop trigger if exists identity_check_mode_events_no_truncate on private.identity_check_mode_events;
create trigger identity_check_mode_events_no_truncate before truncate on private.identity_check_mode_events
  for each statement execute function internal.append_only_guard();
comment on table private.identity_check_mode_events is 'Automatic ID checks: append-only log of setting changes (who, when, from, to, why).';

-- 3. The checks.
create table if not exists private.identity_checks (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  case_id uuid not null,
  status text not null default 'started',
  session_id uuid,
  session_url text,
  id_artifact_id uuid,
  selfie_artifact_id uuid,
  submission_id uuid,
  reasons text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  declined_at timestamptz,
  provider_delete_due timestamptz,
  provider_deleted_at timestamptz,
  asked_at timestamptz,
  ask_reason text,
  start_first_name text not null,
  start_last_name text not null,
  network_hash text,
  device_kind text,
  constraint identity_checks_pkey primary key (id),
  constraint identity_checks_session_id_key unique (session_id),
  constraint identity_checks_submission_id_key unique (submission_id),
  -- A check goes with its case and its submission (the five-year history
  -- sweep of internal.retention_verification deletes those), and a deleted
  -- evidence file only clears the reference.
  constraint identity_checks_case_fkey foreign key (case_id, owner_id)
    references private.evidence_cases(id, subject_id) on delete cascade,
  constraint identity_checks_id_artifact_fkey foreign key (id_artifact_id)
    references private.evidence_artifacts(id) on delete set null,
  constraint identity_checks_selfie_artifact_fkey foreign key (selfie_artifact_id)
    references private.evidence_artifacts(id) on delete set null,
  constraint identity_checks_submission_fkey foreign key (submission_id, owner_id)
    references private.verification_identity_submissions(id, owner_id) on delete cascade,
  constraint identity_checks_status_check
    check (status in ('started','unavailable','not_finished','approved','with_staff','declined')),
  constraint identity_checks_expires_check check (expires_at = created_at + interval '24 hours'),
  constraint identity_checks_session_check check ((session_id is null) = (session_url is null)
    and (session_url is null or (session_url like 'https://verify.didit.me/%' and char_length(session_url) <= 500))),
  constraint identity_checks_finished_check check ((status = 'started') = (finished_at is null)),
  constraint identity_checks_submission_check
    check ((submission_id is not null) = (status in ('approved','with_staff','declined'))),
  constraint identity_checks_declined_check check ((status = 'declined') = (declined_at is not null)),
  constraint identity_checks_reasons_check check (reasons <@ array['provider_declined','provider_in_review',
    'names_differ','document_not_accepted','id_number_invalid','under_18','session_moved','banned','duplicate',
    'high_risk']::text[]),
  constraint identity_checks_provider_deleted_check
    check (provider_deleted_at is null or (session_id is not null and status <> 'started')),
  constraint identity_checks_asked_check check ((asked_at is null) = (ask_reason is null)
    and (asked_at is null or status = 'declined')),
  constraint identity_checks_ask_reason_check check (char_length(ask_reason) between 20 and 2000),
  constraint identity_checks_start_names_check
    check (internal.person_name_valid(start_first_name) and internal.person_name_valid(start_last_name)),
  constraint identity_checks_start_context_check check ((network_hash is null) = (device_kind is null)
    and (network_hash is null or session_id is not null)
    and (network_hash is null or network_hash ~ '^[a-f0-9]{64}$')
    and (device_kind is null or device_kind in ('phone','computer')))
);
alter table private.identity_checks owner to postgres;
alter table private.identity_checks enable row level security;
revoke all on private.identity_checks from public, anon, authenticated, service_role;
-- At most one unfinished check per member.
create unique index if not exists identity_checks_one_started_idx
  on private.identity_checks using btree (owner_id) where (status = 'started');
create index if not exists identity_checks_owner_idx
  on private.identity_checks using btree (owner_id, created_at desc, id desc);
create index if not exists identity_checks_created_idx
  on private.identity_checks using btree (created_at);
create index if not exists identity_checks_case_idx
  on private.identity_checks using btree (case_id, owner_id);
create index if not exists identity_checks_id_artifact_idx
  on private.identity_checks using btree (id_artifact_id) where (id_artifact_id is not null);
create index if not exists identity_checks_selfie_artifact_idx
  on private.identity_checks using btree (selfie_artifact_id) where (selfie_artifact_id is not null);
create index if not exists identity_checks_submission_owner_idx
  on private.identity_checks using btree (submission_id, owner_id) where (submission_id is not null);
create index if not exists identity_checks_delete_due_idx
  on private.identity_checks using btree (provider_delete_due)
  where (provider_delete_due is not null and provider_deleted_at is null);
comment on table private.identity_checks is 'Automatic ID checks: one row per check at the independent verification partner, bound to the member''s open identity case. The partner sees only the random id. status records where the result was sent (approved, with_staff, declined); the identity tables keep the verification itself.';

-- 4. An accepted identity fact may be decided by an automatic check instead of
-- a staff member: exactly one of the two is recorded, and an automatic fact has
-- no second reviewer or decision.
alter table private.accepted_identity_facts add column if not exists automatic_check_id uuid;
do $$begin
  if not exists(select 1 from pg_constraint where conrelid='private.accepted_identity_facts'::regclass
      and conname='accepted_identity_facts_automatic_check_id_key') then
    alter table private.accepted_identity_facts
      add constraint accepted_identity_facts_automatic_check_id_key unique (automatic_check_id),
      add constraint accepted_identity_facts_automatic_check_fkey foreign key (automatic_check_id)
        references private.identity_checks(id) on delete restrict,
      add constraint accepted_identity_facts_decider_check
        check ((reviewed_by is null) = (automatic_check_id is not null)),
      add constraint accepted_identity_facts_automatic_check
        check (automatic_check_id is null or (second_reviewer is null and decision_id is null)),
      drop constraint accepted_identity_facts_check2,
      add constraint accepted_identity_facts_check2
        check (reviewed_by is null or second_reviewer is distinct from reviewed_by);
  end if;
end$$;
alter table private.accepted_identity_facts alter column reviewed_by drop not null;

-- ------------------------------------------------------------------ helpers

-- Where a member's next check goes: automatic, or manual with the reason.
CREATE OR REPLACE FUNCTION internal.identity_check_route(p_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.identity_check_settings;
begin
  select x.* into s from private.identity_check_settings x where x.id;
  if not found or s.mode='manual' then
    return jsonb_build_object('route','manual','reason','mode'); end if;
  if s.paused_until>clock_timestamp() then
    return jsonb_build_object('route','manual','reason','paused'); end if;
  -- Spending guard: 3 checks per member in 7 days, 60 a day site-wide. A check
  -- that could not start (unavailable) is not counted.
  if (select count(*) from private.identity_checks k where k.owner_id=p_owner and k.status<>'unavailable'
      and k.created_at>clock_timestamp()-interval '7 days')>=3
    or (select count(*) from private.identity_checks k where k.status<>'unavailable'
      and k.created_at>clock_timestamp()-interval '1 day')>=60 then
    return jsonb_build_object('route','manual','reason','limit'); end if;
  return jsonb_build_object('route','automatic','reason',null);
end$function$;
alter function internal.identity_check_route(uuid) owner to postgres;
revoke all on function internal.identity_check_route(uuid) from public, anon, authenticated, service_role;

-- Whether a declined check can still go to a person: within 5 days of the
-- decline, not asked before, and nothing has replaced its submission (no newer
-- current submission, no change to the case, no accepted identity, no newer
-- unfinished check).
CREATE OR REPLACE FUNCTION internal.identity_check_askable(k private.identity_checks)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select k.status='declined' and k.declined_at+interval '5 days'>statement_timestamp()
    and k.asked_at is null
    and exists(select 1 from private.evidence_cases c join private.verification_identity_submissions s on s.id=k.submission_id
      where c.id=k.case_id and c.status='open' and c.version=s.case_version)
    and not exists(select 1 from private.verification_current_submissions v where v.case_id=k.case_id)
    and not exists(select 1 from private.accepted_identity_facts f where f.owner_id=k.owner_id)
    and not exists(select 1 from private.identity_checks n where n.owner_id=k.owner_id and n.status='started'
      and n.expires_at>statement_timestamp());
$function$;
alter function internal.identity_check_askable(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_askable(private.identity_checks) from public, anon, authenticated, service_role;

-- Whether a person is still to decide a check the member asked about: its
-- submission is still the open case's current, unchanged one.
CREATE OR REPLACE FUNCTION internal.identity_check_with_person(k private.identity_checks)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select k.asked_at is not null and exists(select 1 from private.evidence_cases c
    join private.verification_current_submissions v on v.case_id=c.id and v.submission_id=k.submission_id
    join private.verification_identity_submissions s on s.id=k.submission_id
    where c.id=k.case_id and c.status='open' and c.version=s.case_version);
$function$;
alter function internal.identity_check_with_person(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_with_person(private.identity_checks) from public, anon, authenticated, service_role;

-- What the member's page shows about a check (no reasons: those are for staff).
CREATE OR REPLACE FUNCTION internal.identity_check_summary(k private.identity_checks)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id',k.id,
    'status',case when k.status='started' and k.expires_at<=statement_timestamp() then 'not_finished' else k.status end,
    'created_at',k.created_at,'expires_at',k.expires_at,'finished_at',k.finished_at,
    'session_id',case when k.status='started' and k.expires_at>statement_timestamp() then k.session_id end,
    'session_url',case when k.status='started' and k.expires_at>statement_timestamp() then k.session_url end,
    'declined_at',k.declined_at,'ask_person_until',k.declined_at+interval '5 days',
    'can_ask_person',internal.identity_check_askable(k),
    'asked_at',k.asked_at,'with_person',internal.identity_check_with_person(k));
$function$;
alter function internal.identity_check_summary(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_summary(private.identity_checks) from public, anon, authenticated, service_role;

-- A clean pass: the accepted identity fact, decided by the automatic check.
-- The caller has registered the submission, holds the subject and fingerprint
-- locks and has found no ban, no other active identity and a risk score of 50
-- or less.
CREATE OR REPLACE FUNCTION internal.accept_automatic_identity_submission(p_check uuid, p_submission uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.verification_identity_submissions; fact uuid;
begin
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found or not exists(select 1 from private.evidence_cases c
      join private.verification_current_submissions v on v.case_id=c.id and v.submission_id=s.id
      where c.id=s.case_id and c.status='open' and c.version=s.case_version)
    or not internal.verification_artifacts_ready(s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,automatic_check_id)
    values(s.owner_id,s.id,s.identity_hmac,null,p_check) returning id into fact;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('identity_accepted',fact,s.owner_id,'identity_accepted:'||fact);
  update private.evidence_cases set status='decided',version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null
    where id=s.case_id and version<2147483647;
  if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  return fact;
end$function$;
alter function internal.accept_automatic_identity_submission(uuid,uuid) owner to postgres;
revoke all on function internal.accept_automatic_identity_submission(uuid,uuid) from public, anon, authenticated, service_role;

-- A decline on the automatic setting: the submission stays (for a person to
-- look at if the member asks) but leaves the case's current place, so no queue
-- shows it and the member's page offers a new attempt. The partner's copy is
-- due for deletion 5 days later unless the member asks a person.
CREATE OR REPLACE FUNCTION internal.decline_automatic_identity_submission(p_check uuid, p_submission uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz:=clock_timestamp();
begin
  delete from private.verification_current_submissions v where v.submission_id=p_submission;
  update private.identity_checks set status='declined',declined_at=now_at,finished_at=now_at,submission_id=p_submission,
    provider_delete_due=now_at+interval '5 days' where id=p_check and status='started';
  if not found then raise exception 'identity check changed' using errcode='PT409'; end if;
end$function$;
alter function internal.decline_automatic_identity_submission(uuid,uuid) owner to postgres;
revoke all on function internal.decline_automatic_identity_submission(uuid,uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ members

-- The member's route (automatic or manual, with the reason) and their latest
-- check. An unfinished check can be resumed while the setting allows it.
CREATE OR REPLACE FUNCTION internal.get_identity_check_availability()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); k private.identity_checks; route jsonb;
begin
  select x.* into k from private.identity_checks x where x.owner_id=actor and x.status<>'unavailable'
    order by x.created_at desc,x.id desc limit 1;
  route:=internal.identity_check_route(actor);
  if route->>'reason'='limit' and k.id is not null and k.status='started' and k.expires_at>clock_timestamp() then
    route:=jsonb_build_object('route','automatic','reason',null); end if;
  return route||jsonb_build_object('check',case when k.id is not null then internal.identity_check_summary(k) end);
end$function$;
alter function internal.get_identity_check_availability() owner to postgres;
revoke all on function internal.get_identity_check_availability() from public, anon, authenticated, service_role;
grant execute on function internal.get_identity_check_availability() to authenticated;

CREATE OR REPLACE FUNCTION api.get_identity_check_availability()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_identity_check_availability();
$function$;
alter function api.get_identity_check_availability() owner to postgres;
revoke all on function api.get_identity_check_availability() from public, anon, authenticated, service_role;
grant execute on function api.get_identity_check_availability() to authenticated;

-- Starts the member's automatic check (recording the typed legal names it
-- starts with), or returns their unfinished one. An
-- unfinished check is resumed whatever the setting, pause or spending guard
-- now say (it was counted when it started; if the setting is manual when the
-- result arrives, the result goes to staff). A new check needs no request to a
-- person still waiting, a verified phone (the phone step comes first), the
-- typed legal names, an identity case that is not accepted or under
-- independent review, and the automatic route.
CREATE OR REPLACE FUNCTION internal.start_my_identity_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); k private.identity_checks; opened jsonb; route jsonb; now_at timestamptz;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  now_at:=clock_timestamp();
  select x.* into k from private.identity_checks x where x.owner_id=actor and x.status='started' for update;
  if found then
    if k.expires_at>now_at then
      return jsonb_build_object('check_id',k.id,'session_id',k.session_id,'session_url',k.session_url,'created',false); end if;
    update private.identity_checks set status='not_finished',finished_at=now_at,
      provider_delete_due=case when session_id is not null then now_at end where id=k.id;
  end if;
  if exists(select 1 from private.identity_checks x where x.owner_id=actor and internal.identity_check_with_person(x)) then
    raise exception 'a person is checking your identity' using errcode='PT409',detail='identity_check_with_person'; end if;
  if not exists(select 1 from private.verification_phone_proofs p where p.owner_id=actor and p.revoked_at is null) then
    raise exception 'verified phone required' using errcode='PT409',detail='verified_phone_required'; end if;
  if not exists(select 1 from private.profiles p where p.account_id=actor
      and p.legal_first_name is not null and p.legal_last_name is not null) then
    raise exception 'legal name required' using errcode='PT409',detail='legal_name_required'; end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  -- One start at a time site-wide, so the daily count holds exactly.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('identity_check_start',0));
  route:=internal.identity_check_route(actor);
  if route->>'reason'='limit' then
    raise exception 'automatic identity check limit reached' using errcode='PT409',detail='identity_check_limit';
  elsif route->>'reason'='paused' then
    raise exception 'automatic identity checks are paused' using errcode='PT409',detail='identity_check_paused';
  elsif route->>'route'<>'automatic' then
    raise exception 'automatic identity checks are off' using errcode='PT409',detail='identity_check_mode'; end if;
  now_at:=clock_timestamp();
  insert into private.identity_checks(owner_id,case_id,created_at,expires_at,start_first_name,start_last_name)
    select actor,(opened->>'case_id')::uuid,now_at,now_at+interval '24 hours',p.legal_first_name,p.legal_last_name
      from private.profiles p where p.account_id=actor returning * into k;
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'session_id',null,'session_url',null,'created',true);
end$function$;
alter function internal.start_my_identity_check() owner to postgres;
revoke all on function internal.start_my_identity_check() from public, anon, authenticated, service_role;
grant execute on function internal.start_my_identity_check() to authenticated;

CREATE OR REPLACE FUNCTION api.start_my_identity_check()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_my_identity_check();
$function$;
alter function api.start_my_identity_check() owner to postgres;
revoke all on function api.start_my_identity_check() from public, anon, authenticated, service_role;
grant execute on function api.start_my_identity_check() to authenticated;

-- "Ask a person to look again" for a declined check (reason 20 to 2000
-- characters, as appeals): records the request on the check and puts the
-- declined submission back in the staff queue. The staff decision is the
-- answer, told by the existing "verified" or "sent back" notice.
CREATE OR REPLACE FUNCTION internal.ask_person_identity_check(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); explanation text; k private.identity_checks;
begin
  explanation:=internal.validate_attribute_value('{"type":"string","minLength":20,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if p_check is null or explanation is null
    or explanation ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'reason required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select x.* into k from private.identity_checks x where x.id=p_check and x.owner_id=actor for update;
  if not found then raise exception 'identity check unavailable' using errcode='PT409',detail='ask_person_unavailable'; end if;
  if k.asked_at is not null then
    if k.ask_reason=explanation then
      return jsonb_build_object('check_id',k.id,'asked_at',k.asked_at,'reused',true); end if;
    raise exception 'a person was already asked' using errcode='PT409',detail='ask_person_unavailable'; end if;
  if not internal.identity_check_askable(k) then
    raise exception 'identity check cannot go to a person' using errcode='PT409',detail='ask_person_unavailable'; end if;
  insert into private.verification_current_submissions(case_id,submission_id) values(k.case_id,k.submission_id);
  update private.identity_checks set asked_at=clock_timestamp(),ask_reason=explanation,provider_delete_due=null
    where id=k.id returning * into k;
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'asked_at',k.asked_at,'reused',false);
end$function$;
alter function internal.ask_person_identity_check(uuid,text) owner to postgres;
revoke all on function internal.ask_person_identity_check(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.ask_person_identity_check(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.ask_person_identity_check(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.ask_person_identity_check(p_check,p_reason);
$function$;
alter function api.ask_person_identity_check(uuid,text) owner to postgres;
revoke all on function api.ask_person_identity_check(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.ask_person_identity_check(uuid,text) to authenticated;

-- ------------------------------------------------------- the website's server

-- Binds the partner's session (its id and link) to an unfinished check, once,
-- with the start context the website computed: a keyed hash of the member's
-- network (64 lowercase hex characters) and the device kind (phone or
-- computer).
CREATE OR REPLACE FUNCTION internal.attach_identity_check_session(p_check uuid, p_session_id uuid, p_session_url text,
  p_network_hash text, p_device_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks;
begin
  if p_check is null or p_session_id is null or p_session_url is null
    or p_session_url not like 'https://verify.didit.me/%' or char_length(p_session_url)>500
    or p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$'
    or p_device_kind is null or p_device_kind not in('phone','computer') then
    raise exception 'identity check session required' using errcode='22023'; end if;
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or k.status<>'started' or k.expires_at<=clock_timestamp() then
    raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  if k.session_id is not null then
    if (k.session_id,k.session_url,k.network_hash,k.device_kind)=(p_session_id,p_session_url,p_network_hash,p_device_kind) then
      return jsonb_build_object('check_id',k.id,'reused',true); end if;
    raise exception 'identity check already has a session' using errcode='PT409'; end if;
  update private.identity_checks set session_id=p_session_id,session_url=p_session_url,
    network_hash=p_network_hash,device_kind=p_device_kind where id=k.id;
  return jsonb_build_object('check_id',k.id,'reused',false);
end$function$;
alter function internal.attach_identity_check_session(uuid,uuid,text,text,text) owner to postgres;
revoke all on function internal.attach_identity_check_session(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.attach_identity_check_session(uuid,uuid,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION api.attach_identity_check_session(p_check uuid, p_session_id uuid, p_session_url text,
  p_network_hash text, p_device_kind text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_identity_check_session(p_check,p_session_id,p_session_url,p_network_hash,p_device_kind);
$function$;
alter function api.attach_identity_check_session(uuid,uuid,text,text,text) owner to postgres;
revoke all on function api.attach_identity_check_session(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function api.attach_identity_check_session(uuid,uuid,text,text,text) to service_role;

-- The partner could not start a check (no credit, an outage or missing
-- settings): the check becomes unavailable (not counted) and automatic checks
-- pause for everyone, 15 minutes after an outage and 1 hour otherwise.
-- newly_paused is true only for the call that started the pause, so the
-- website sends one alert per pause.
CREATE OR REPLACE FUNCTION internal.report_identity_check_unavailable(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; s private.identity_check_settings; now_at timestamptz:=clock_timestamp(); newly boolean;
begin
  if p_check is null or p_reason is null or p_reason not in('no_credit','outage','not_configured') then
    raise exception 'unavailable reason required' using errcode='22023'; end if;
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or (k.status<>'unavailable' and (k.status<>'started' or k.session_id is not null)) then
    raise exception 'identity check without a session required' using errcode='PT409'; end if;
  if k.status='started' then
    update private.identity_checks set status='unavailable',finished_at=now_at where id=k.id; end if;
  select x.* into s from private.identity_check_settings x where x.id for update;
  newly:=s.paused_until is null or s.paused_until<=now_at;
  update private.identity_check_settings set
    paused_until=greatest(case when newly then now_at else paused_until end,
      now_at+case p_reason when 'outage' then interval '15 minutes' else interval '1 hour' end),
    pause_reason=p_reason where id returning * into s;
  return jsonb_build_object('paused_until',s.paused_until,'pause_reason',s.pause_reason,'newly_paused',newly);
end$function$;
alter function internal.report_identity_check_unavailable(uuid,text) owner to postgres;
revoke all on function internal.report_identity_check_unavailable(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.report_identity_check_unavailable(uuid,text) to service_role;

CREATE OR REPLACE FUNCTION api.report_identity_check_unavailable(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.report_identity_check_unavailable(p_check,p_reason);
$function$;
alter function api.report_identity_check_unavailable(uuid,text) owner to postgres;
revoke all on function api.report_identity_check_unavailable(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.report_identity_check_unavailable(uuid,text) to service_role;

-- Before copying the partner's ID photo and selfie into private storage: two
-- evidence files of the check's case, reserved like a member's upload (the
-- same object keys, cleaned up after an hour if never completed). A repeat
-- call within 30 minutes returns the same files. Also returns the check's
-- owner account and start context (typed legal names at start, network hash, device kind) for
-- the website's own comparisons.
CREATE OR REPLACE FUNCTION internal.begin_identity_check_evidence(p_check uuid, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; subject uuid; id_art private.evidence_artifacts; selfie_art private.evidence_artifacts;
begin
  if p_check is null or p_session_id is null then raise exception 'identity check session required' using errcode='22023'; end if;
  select x.owner_id into subject from private.identity_checks x where x.id=p_check;
  if not found then raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  perform internal.lock_verification_subject(subject);
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if k.status<>'started' or k.session_id is distinct from p_session_id then
    raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  if exists(select 1 from private.accepted_identity_facts f where f.owner_id=subject) then
    raise exception 'accepted identity requires authorised resubmission' using errcode='PT409'; end if;
  if exists(select 1 from private.decisions d where d.case_id=k.case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id') then
    raise exception 'independent identity review is pending' using errcode='PT409'; end if;
  select a.* into id_art from private.evidence_artifacts a where a.id=k.id_artifact_id and a.state='intent'
    and a.created_at>clock_timestamp()-interval '30 minutes';
  select a.* into selfie_art from private.evidence_artifacts a where a.id=k.selfie_artifact_id and a.state='intent'
    and a.created_at>clock_timestamp()-interval '30 minutes';
  if id_art.id is null or selfie_art.id is null then
    insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
      values(k.case_id,subject,'id_front','evidence/'||k.case_id||'/'||pg_catalog.gen_random_uuid()) returning * into id_art;
    insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
      values(k.case_id,subject,'selfie','evidence/'||k.case_id||'/'||pg_catalog.gen_random_uuid()) returning * into selfie_art;
    update private.identity_checks set id_artifact_id=id_art.id,selfie_artifact_id=selfie_art.id where id=k.id;
  end if;
  return jsonb_build_object('id_front',jsonb_build_object('artifact_id',id_art.id,'object_key',id_art.object_key),
    'selfie',jsonb_build_object('artifact_id',selfie_art.id,'object_key',selfie_art.object_key),
    'owner_id',k.owner_id,
    'start',jsonb_build_object('first_name',k.start_first_name,'last_name',k.start_last_name,
      'network_hash',k.network_hash,'device_kind',k.device_kind));
end$function$;
alter function internal.begin_identity_check_evidence(uuid,uuid) owner to postgres;
revoke all on function internal.begin_identity_check_evidence(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.begin_identity_check_evidence(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION api.begin_identity_check_evidence(p_check uuid, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.begin_identity_check_evidence(p_check,p_session_id);
$function$;
alter function api.begin_identity_check_evidence(uuid,uuid) owner to postgres;
revoke all on function api.begin_identity_check_evidence(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.begin_identity_check_evidence(uuid,uuid) to service_role;

-- The result of a check, once (a repeat returns the recorded status).
-- p_outcome is the partner's answer after the website's own checks:
-- approved, declined, in_review, or not_finished (abandoned, expired, or no
-- readable ID number; no evidence then). p_reasons are the website's findings
-- (names_differ, document_not_accepted, id_number_invalid, under_18, and
-- session_moved when the result came from another network or device). For
-- the other outcomes the website has copied both photos into the reserved
-- files and gives their receipts (as complete_evidence_upload takes them), the
-- fingerprint and encrypted ID number (as the manual upload gives them) and
-- the risk score from assess_identity_upload, and p_names, the first and last
-- names it compared with the ID ({first_name, last_name}). The database adds
-- names_differ when those are not exactly the names the new submission
-- records (the member's names may change during the check), banned,
-- duplicate and high_risk. A check past its 24-hour expiry is recorded as
-- not_finished whatever the outcome. A clean pass (approved, no reason) on a partner
-- setting verifies at once; otherwise the result goes to staff (staff_final,
-- or manual at this moment) or is declined (automatic).
CREATE OR REPLACE FUNCTION internal.complete_identity_check(p_check uuid, p_session_id uuid, p_outcome text,
  p_reasons text[] DEFAULT '{}'::text[], p_id_front jsonb DEFAULT NULL::jsonb, p_selfie jsonb DEFAULT NULL::jsonb,
  p_identity jsonb DEFAULT NULL::jsonb, p_names jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; subject uuid; done jsonb; submitted jsonb; s private.verification_identity_submissions;
  setting_mode text; found_reasons text[]; now_at timestamptz;
begin
  if p_check is null or p_session_id is null or p_outcome is null
    or p_outcome not in('approved','declined','in_review','not_finished')
    or p_reasons is null
    or not (p_reasons <@ array['names_differ','document_not_accepted','id_number_invalid','under_18','session_moved']::text[]) then
    raise exception 'identity check result required' using errcode='22023'; end if;
  if (p_outcome='not_finished') <> (p_id_front is null and p_selfie is null and p_identity is null and p_names is null and p_risk_score is null)
    or (p_outcome<>'not_finished' and (jsonb_typeof(p_id_front) is distinct from 'object' or jsonb_typeof(p_selfie) is distinct from 'object'
      or jsonb_typeof(p_names) is distinct from 'object' or p_names-array['first_name','last_name']<>'{}'::jsonb
      or jsonb_typeof(p_names->'first_name') is distinct from 'string' or jsonb_typeof(p_names->'last_name') is distinct from 'string'
      or jsonb_typeof(p_identity) is distinct from 'object' or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or p_id_front-array['stored_sha256','content_sha256','size']<>'{}'::jsonb
      or p_selfie-array['stored_sha256','content_sha256','size']<>'{}'::jsonb
      or jsonb_typeof(p_id_front->'size') is distinct from 'number' or jsonb_typeof(p_selfie->'size') is distinct from 'number')) then
    raise exception 'identity check evidence required' using errcode='22023'; end if;
  select x.owner_id into subject from private.identity_checks x where x.id=p_check;
  if not found then raise exception 'identity check unavailable' using errcode='PT409'; end if;
  perform internal.lock_verification_subject(subject);
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if k.session_id is distinct from p_session_id then
    raise exception 'identity check session changed' using errcode='PT409'; end if;
  if k.status<>'started' then
    return jsonb_build_object('status',k.status,'submission_id',k.submission_id,'reused',true); end if;
  now_at:=clock_timestamp();
  if p_outcome='not_finished' or k.expires_at<=now_at then
    update private.identity_checks set status='not_finished',finished_at=now_at,reasons=p_reasons,provider_delete_due=now_at
      where id=k.id;
    return jsonb_build_object('status','not_finished','submission_id',null);
  end if;
  if k.id_artifact_id is null or k.selfie_artifact_id is null then
    raise exception 'identity check evidence was not reserved' using errcode='PT409'; end if;
  perform internal.complete_evidence_upload(k.id_artifact_id,p_id_front->>'stored_sha256',p_id_front->>'content_sha256',(p_id_front->>'size')::integer);
  done:=internal.complete_evidence_upload(k.selfie_artifact_id,p_selfie->>'stored_sha256',p_selfie->>'content_sha256',(p_selfie->>'size')::integer);
  submitted:=internal.register_identity_submission(k.case_id,(done->>'case_version')::integer,k.id_artifact_id,k.selfie_artifact_id,
    p_identity->>'fingerprint','identity-match-v1',p_identity->'encrypted_number',k.id,p_risk_score);
  select x.* into s from private.verification_identity_submissions x where x.id=(submitted->>'submission_id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.identity_hmac,2701));
  select array_agg(r order by r) into found_reasons from (select distinct r from unnest(p_reasons
    ||case p_outcome when 'declined' then array['provider_declined'] when 'in_review' then array['provider_in_review'] else '{}'::text[] end
    ||case when exists(select 1 from private.identity_submission_names n where n.submission_id=s.id
      and n.legal_first_name=p_names->>'first_name' and n.legal_last_name=p_names->>'last_name') then '{}'::text[]
      else array['names_differ'] end
    ||case when exists(select 1 from private.banned_identities b where b.identity_hmac=s.identity_hmac
      and b.retain_until>clock_timestamp()) then array['banned'] else '{}'::text[] end
    ||case when exists(select 1 from private.accepted_identity_facts f where f.identity_hmac=s.identity_hmac
      and f.revoked_at is null) then array['duplicate'] else '{}'::text[] end
    ||case when s.risk_score>50 then array['high_risk'] else '{}'::text[] end) r) x;
  select x.mode into setting_mode from private.identity_check_settings x where x.id;
  now_at:=clock_timestamp();
  if setting_mode in('staff_final','automatic') and found_reasons is null then
    update private.identity_checks set status='approved',finished_at=now_at,submission_id=s.id where id=k.id;
    perform internal.accept_automatic_identity_submission(k.id,s.id);
  elsif setting_mode='automatic' then
    update private.identity_checks set reasons=found_reasons where id=k.id;
    perform internal.decline_automatic_identity_submission(k.id,s.id);
  else
    update private.identity_checks set status='with_staff',finished_at=now_at,submission_id=s.id,
      reasons=coalesce(found_reasons,'{}'::text[]) where id=k.id;
  end if;
  return jsonb_build_object('status',(select x.status from private.identity_checks x where x.id=k.id),'submission_id',s.id);
end$function$;
alter function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) owner to postgres;
revoke all on function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) to service_role;

CREATE OR REPLACE FUNCTION api.complete_identity_check(p_check uuid, p_session_id uuid, p_outcome text,
  p_reasons text[] DEFAULT '{}'::text[], p_id_front jsonb DEFAULT NULL::jsonb, p_selfie jsonb DEFAULT NULL::jsonb,
  p_identity jsonb DEFAULT NULL::jsonb, p_names jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_identity_check(p_check,p_session_id,p_outcome,p_reasons,p_id_front,p_selfie,p_identity,p_names,p_risk_score);
$function$;
alter function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) owner to postgres;
revoke all on function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function api.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer) to service_role;

-- Partner sessions to delete now (for the 5-minute job). First closes checks
-- still unfinished an hour after their 24-hour expiry. Each returned session
-- is held for 5 minutes, so an overlapping run does not send it twice and a
-- failed delete is retried. Fraud and legal holds keep a session.
CREATE OR REPLACE FUNCTION internal.claim_identity_check_deletions(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare rows jsonb; now_at timestamptz:=clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  update private.identity_checks set status='not_finished',finished_at=now_at,
    provider_delete_due=case when session_id is not null then now_at end
    where status='started' and expires_at<now_at-interval '1 hour';
  with due as (
    select k.id from private.identity_checks k
    where k.provider_delete_due<=now_at and k.provider_deleted_at is null and k.session_id is not null
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(k.case_id)
    order by k.provider_delete_due,k.id limit p_limit for update skip locked
  ), held as (
    update private.identity_checks k set provider_delete_due=now_at+interval '5 minutes' from due
    where k.id=due.id returning k.id,k.session_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('check_id',held.id,'session_id',held.session_id) order by held.id),'[]'::jsonb)
    into rows from held;
  return rows;
end$function$;
alter function internal.claim_identity_check_deletions(integer) owner to postgres;
revoke all on function internal.claim_identity_check_deletions(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_identity_check_deletions(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_identity_check_deletions(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_identity_check_deletions(p_limit);
$function$;
alter function api.claim_identity_check_deletions(integer) owner to postgres;
revoke all on function api.claim_identity_check_deletions(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_identity_check_deletions(integer) to service_role;

-- The partner has deleted a finished check's session (with privacy erasure).
CREATE OR REPLACE FUNCTION internal.mark_identity_check_provider_deleted(p_check uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks;
begin
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or k.session_id is null or k.status='started' then
    raise exception 'finished identity check with a session required' using errcode='PT409'; end if;
  if k.provider_deleted_at is not null then
    return jsonb_build_object('check_id',k.id,'provider_deleted_at',k.provider_deleted_at,'reused',true); end if;
  update private.identity_checks set provider_deleted_at=clock_timestamp(),provider_delete_due=null where id=k.id returning * into k;
  return jsonb_build_object('check_id',k.id,'provider_deleted_at',k.provider_deleted_at,'reused',false);
end$function$;
alter function internal.mark_identity_check_provider_deleted(uuid) owner to postgres;
revoke all on function internal.mark_identity_check_provider_deleted(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.mark_identity_check_provider_deleted(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.mark_identity_check_provider_deleted(p_check uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.mark_identity_check_provider_deleted(p_check);
$function$;
alter function api.mark_identity_check_provider_deleted(uuid) owner to postgres;
revoke all on function api.mark_identity_check_provider_deleted(uuid) from public, anon, authenticated, service_role;
grant execute on function api.mark_identity_check_provider_deleted(uuid) to service_role;

-- -------------------------------------------------------------------- staff

-- The setting for everyone working the queue: mode, pause, the last 7 days'
-- counts and the latest changes.
CREATE OR REPLACE FUNCTION internal.get_identity_check_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view'); s private.identity_check_settings; counts jsonb; changes jsonb;
begin
  select x.* into s from private.identity_check_settings x where x.id;
  select jsonb_build_object('checks',count(*) filter(where k.status<>'unavailable'),
      'approved',count(*) filter(where k.status='approved'),'with_staff',count(*) filter(where k.status='with_staff'),
      'declined',count(*) filter(where k.status='declined'),
      'asked_person',count(*) filter(where k.asked_at is not null),
      'unavailable',count(*) filter(where k.status='unavailable'))
    into counts from private.identity_checks k where k.created_at>clock_timestamp()-interval '7 days';
  select coalesce(jsonb_agg(jsonb_build_object('from_mode',e.from_mode,'to_mode',e.to_mode,'changed_by',e.changed_by,
      'reason',e.reason,'changed_at',e.changed_at) order by e.changed_at desc,e.id desc),'[]'::jsonb)
    into changes from (select * from private.identity_check_mode_events x order by x.changed_at desc,x.id desc limit 5) e;
  return jsonb_build_object('account_id',actor,'mode',s.mode,'changed_at',s.changed_at,
    'paused_until',case when s.paused_until>clock_timestamp() then s.paused_until end,
    'pause_reason',case when s.paused_until>clock_timestamp() then s.pause_reason end,
    'last_7_days',counts,'recent_changes',changes);
end$function$;
alter function internal.get_identity_check_settings() owner to postgres;
revoke all on function internal.get_identity_check_settings() from public, anon, authenticated, service_role;
grant execute on function internal.get_identity_check_settings() to authenticated;

CREATE OR REPLACE FUNCTION api.get_identity_check_settings()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_identity_check_settings();
$function$;
alter function api.get_identity_check_settings() owner to postgres;
revoke all on function api.get_identity_check_settings() from public, anon, authenticated, service_role;
grant execute on function api.get_identity_check_settings() to authenticated;

-- Changes the setting (admin, recent second factor, a reason of 5 to 500
-- characters without control or direction characters). Setting a mode, even
-- the current one, ends a pause early (for example after a top-up). Until the
-- retention update replaces this function, only manual is accepted.
CREATE OR REPLACE FUNCTION internal.set_identity_check_mode(p_mode text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity_check:configure'); clean_reason text:=btrim(p_reason);
  s private.identity_check_settings; resumed boolean;
begin
  if p_mode is null or p_mode not in('manual','staff_final','automatic') then
    raise exception 'identity check mode required' using errcode='22023'; end if;
  if clean_reason is null or char_length(clean_reason) not between 5 and 500
    or clean_reason ~ U&'[\0001-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'identity check mode reason required' using errcode='22023'; end if;
  if p_mode<>'manual' then
    raise exception 'automatic identity checks wait for the retention update' using errcode='PT409',
      detail='identity_check_retention_pending'; end if;
  select x.* into s from private.identity_check_settings x where x.id for update;
  if not found then raise exception 'identity check settings missing' using errcode='55000'; end if;
  resumed:=s.paused_until>clock_timestamp();
  update private.identity_check_settings set mode=p_mode,paused_until=null,pause_reason=null,
    changed_at=case when mode<>p_mode then statement_timestamp() else changed_at end where id;
  if s.mode<>p_mode then
    insert into private.identity_check_mode_events(from_mode,to_mode,changed_by,reason)
      values(s.mode,p_mode,actor,clean_reason);
  end if;
  perform internal.staff_actor('identity_check:configure');
  return jsonb_build_object('mode',p_mode,'changed',s.mode<>p_mode,'resumed',coalesce(resumed,false));
end$function$;
alter function internal.set_identity_check_mode(text,text) owner to postgres;
revoke all on function internal.set_identity_check_mode(text,text) from public, anon, authenticated, service_role;
grant execute on function internal.set_identity_check_mode(text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.set_identity_check_mode(p_mode text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_identity_check_mode(p_mode,p_reason);
$function$;
alter function api.set_identity_check_mode(text,text) owner to postgres;
revoke all on function api.set_identity_check_mode(text,text) from public, anon, authenticated, service_role;
grant execute on function api.set_identity_check_mode(text,text) to authenticated;

-- For a reviewer holding a current claim on an open identity case: its latest
-- automatic check, the reasons it did not pass and the member's "ask a
-- person" request. Logged like the identity review context
-- (internal.staff_evidence_metadata, routine_review).
CREATE OR REPLACE FUNCTION internal.get_identity_check_for_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view'); c private.evidence_cases; k private.identity_checks;
begin
  if p_case is null then raise exception 'identity case required' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.id=p_case and e.kind='kyc' and e.status='open'
    and e.claimed_by=actor and e.claim_expires_at>clock_timestamp() and e.subject_id<>actor;
  if not found then raise exception 'one current independent held case required' using errcode='42501'; end if;
  perform internal.staff_evidence_metadata(c.id,c.claim_generation::text,c.claim_nonce,'routine_review');
  select x.* into k from private.identity_checks x where x.case_id=c.id and x.status<>'unavailable'
    order by x.created_at desc,x.id desc limit 1;
  if k.id is null then return jsonb_build_object('check',null); end if;
  return jsonb_build_object('check',jsonb_build_object('id',k.id,'status',k.status,'submission_id',k.submission_id,
    'reasons',to_jsonb(k.reasons),'created_at',k.created_at,'finished_at',k.finished_at,'declined_at',k.declined_at,
    'asked_at',k.asked_at,'ask_reason',k.ask_reason));
end$function$;
alter function internal.get_identity_check_for_case(uuid) owner to postgres;
revoke all on function internal.get_identity_check_for_case(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_identity_check_for_case(uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.get_identity_check_for_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_identity_check_for_case(p_case);
$function$;
alter function api.get_identity_check_for_case(uuid) owner to postgres;
revoke all on function api.get_identity_check_for_case(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_identity_check_for_case(uuid) to authenticated;

commit;
