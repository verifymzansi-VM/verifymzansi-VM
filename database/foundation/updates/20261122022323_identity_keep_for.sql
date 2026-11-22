-- Identity keep-for periods: how long the identity check data is kept, and the
-- last database rules before automatic ID checks may leave Manual.
--
-- From this update:
-- 1. The admin setting accepts all three values (manual, staff_final,
--    automatic). Until now api.set_identity_check_mode refused anything but
--    manual (PT409 identity_check_retention_pending).
-- 2. Selfie and encrypted ID number (the blocking code, the legal names and the
--    verified phone were already kept): kept with an accepted identity while
--    the account is open, during the 90 days after it closes, while a report
--    on the account or its posts is open, and while its ID number is banned (5
--    years from the ban, so a ban approved within the 90 days keeps them).
--    When an account closed in good standing passes its 90 days they are
--    deleted; the blocking code, the names and the verified phone stay 5 years
--    (the five-year history sweep). Until now the selfie and the ID number
--    went 30 days after the decision. Helper
--    internal.identity_record_kept(submission), used by the file clean-up
--    (internal.claim_evidence_cleanup) and the ID number erasure
--    (internal.retention_verification), which now follows the selfie instead
--    of the ID photo. The numbers an account with an accepted identity had
--    verified when it closed are no longer deleted 30 days after closure: they
--    go with the five-year sweep.
-- 3. The ID photo: 30 days after the decision at our end (unchanged), and the
--    partner's copy of an accepted check is deleted 30 days after the
--    acceptance (provider_delete_due, set by
--    internal.claim_identity_check_deletions).
-- 4. Failed or not accepted attempts keep only the keyed fingerprint:
--    - an automatic decline's files are due 5 days after the decline (the
--      "ask a person" window); asking a person keeps them until a person
--      decides;
--    - a submission staff send back: the case's files are due 5 days later
--      (were 90);
--    - a submission replaced by a newer one (a resubmission, or a new
--      automatic result while an earlier one waited for staff): its files are
--      due 5 days later (trigger identity_submission_replaced);
--    - a check staff sent back or that ended without acceptance (also an "ask
--      a person" answered by a return, or its case closed): the partner's copy
--      is due 5 days after;
--    - its ID number is erased when its selfie goes, then the names it was
--      made with (private.identity_submission_names);
--    - the check row itself (with its "ask a person" reason) goes 7 days after
--      it finished, once the partner's copy is deleted and no person is still
--      to decide it.
--    The submission row stays, with only the fingerprint, for the duplicate
--    and ban checks.
-- 5. A check's start context (the typed names at start, the network hash and
--    the device kind) is cleared when it leaves "started" (trigger
--    identity_check_clear_start); a closed account's "ask a person" reasons go
--    90 days after closure, with its selfie. The retention result counts the
--    partner deletions overdue by more than a day (overdue_partner_deletions),
--    so a stalled deletion job shows.
-- 6. The five-year history sweep skips an account while a partner copy of one
--    of its checks is not yet deleted.
-- 7. "Moved" always goes to staff: a result flagged session_moved goes to the
--    staff queue on every setting, automatic included (the scam rule). A
--    result whose names at start differ from the names the submission records
--    gets names_differ (staff on manual and staff_final, a decline with "ask a
--    person" on automatic, as before).
-- 8. The start of a check inserts exactly one row (strict).
-- 9. Authority-request logs (private.identity_disclosures and their events)
--    are kept while a named account exists and 5 years after it closed; a
--    search that named nobody, 5 years from the search. The setting's change
--    log is kept 5 years. Both are swept by internal.retention_verification
--    under api.run_retention.
-- 10. A member's view of a declined check carries decline_reason, a category
--     the page can show: id_unreadable, names_differ, under_18,
--     photo_not_matched or not_confirmed (banned, duplicate and high risk are
--     never named).
-- 11. On an open identity case, deleting a file that no current submission
--     uses (a failed attempt's, a reservation never completed) no longer
--     changes the case version, so the clean-up of a sent-back attempt cannot
--     make a newer submission stale (internal.evidence_artifact_submission_guard).
--
-- Holds keep everything, as before: an open legal hold on the account or a
-- fraud hold on the case. Replaces 11 functions with full bodies and adds two
-- helpers, two triggers and a constraint; no command is added or removed
-- (expand). ORDER: apply first, then merge.
-- Read-only preflight: ../preflight/20261122022323_identity_keep_for.check.sql.
-- Rollback: ../rollback/20261122022323_identity_keep_for.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: every function this update replaces has its reviewed body (or
-- this update's); the helpers, the triggers and the new constraint are all
-- absent or all present.
do $$
declare present integer; body record;
begin
  select (to_regprocedure('internal.identity_record_kept(uuid)') is not null)::integer
    + (to_regprocedure('internal.identity_submission_waiting(uuid)') is not null)::integer
    + (to_regprocedure('internal.identity_check_clear_start()') is not null)::integer
    + (to_regprocedure('internal.identity_submission_replaced()') is not null)::integer
    + (exists(select 1 from pg_trigger where tgrelid='private.identity_checks'::regclass
        and tgname='identity_check_clear_start'))::integer
    + (exists(select 1 from pg_trigger where tgrelid='private.verification_current_submissions'::regclass
        and tgname='identity_submission_replaced'))::integer
    + (exists(select 1 from pg_constraint where conrelid='private.identity_checks'::regclass
        and conname='identity_checks_start_cleared_check'))::integer
  into present;
  if present not in (0, 7) then
    raise exception 'identity keep-for precondition: % of 7 objects exist', present using errcode='55000';
  end if;
  for body in select * from (values
      ('internal.set_identity_check_mode(text,text)', '0747acd14aa377ab9895a3dbe7929052', '7fdea80d198a0df84be848ed1bd934f9'),
      ('internal.start_my_identity_check()', '108e9db93c829bd11fa5914898448816', '22d86444b8cde7fdafd832f8b91da440'),
      ('internal.complete_identity_check(uuid,uuid,text,text[],jsonb,jsonb,jsonb,jsonb,integer)', 'fbd21093a62801be26748413932aafcb', '8c27fff47923ec0b410ce8dbd6927fbb'),
      ('internal.decline_automatic_identity_submission(uuid,uuid)', 'abf3f15f72e11a9b6cb9717572929661', '0b5bd2ed7702e07fb42468650b5a7281'),
      ('internal.ask_person_identity_check(uuid,text)', 'd8102d38e3c284bf4050994add9af219', '30979a736f6878a22977b4fde70d1fb6'),
      ('internal.claim_identity_check_deletions(integer)', '40673de778e844021698427b4809c5cf', 'b85ec55a7283a4c897b5b5f50e1dc5e8'),
      ('internal.identity_check_summary(private.identity_checks)', '2ba0f50d74bc624d4a4e1d8caeca6fa1', '73fdd37368b8112a6e0af490a29e935c'),
      ('internal.return_identity_submission(uuid,integer,text,uuid,text)', 'bc4304d1f5191cae942d30780ce0c29c', 'be358fa7134821b7759a69d691e61aa6'),
      ('internal.claim_evidence_cleanup(integer)', '7b3da1337260bcd71a5c9f2fd55480a5', 'cbf7f8505087f2807fae496d2d5c6b59'),
      ('internal.retention_verification(integer)', 'fe726b6672545b8b33901361eaf91226', '75df892c01832a48cc1ab60ab559499a'),
      ('internal.evidence_artifact_submission_guard()', '2cf882f651413912b4d9cc67d8db01b7', '9bad086a99cfd7626dfc7253048dd5e7')
    ) v(sig, reviewed, updated) loop
    if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure(body.sig))
        not in (body.reviewed, body.updated) then
      raise exception 'identity keep-for drift: % is not the reviewed body', body.sig using errcode='55000';
    end if;
  end loop;
end$$;

-- ------------------------------------------------------------ the record kept

-- Whether a submission's selfie and encrypted ID number are kept: it was
-- accepted, and that identity is still current (closing the account revokes
-- it), or the account closed less than 90 days ago, or a report on the
-- account or its posts is open (as account erasure waits for one), or its ID
-- number is banned (5 years from the ban).
CREATE OR REPLACE FUNCTION internal.identity_record_kept(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.accepted_identity_facts f
    where f.submission_id=p_submission and (f.revoked_at is null
      or exists(select 1 from private.account_closures x where x.user_id=f.owner_id
        and x.evidence_delete_after>statement_timestamp())
      or exists(select 1 from private.reports r where r.status='open'
        and (r.subject_account_id=f.owner_id or r.post_id in(select p.id from private.posts p where p.owner_id=f.owner_id)))
      or exists(select 1 from private.banned_identities b where b.identity_hmac=f.identity_hmac
        and b.retain_until>statement_timestamp())));
$function$;
alter function internal.identity_record_kept(uuid) owner to postgres;
revoke all on function internal.identity_record_kept(uuid) from public, anon, authenticated, service_role;

-- Whether a person is still to decide a submission: it is the current,
-- unchanged submission of its open case.
CREATE OR REPLACE FUNCTION internal.identity_submission_waiting(p_submission uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.verification_current_submissions v
    join private.evidence_cases c on c.id=v.case_id
    join private.verification_identity_submissions s on s.id=v.submission_id
    where v.submission_id=p_submission and c.status='open' and c.version=s.case_version);
$function$;
alter function internal.identity_submission_waiting(uuid) owner to postgres;
revoke all on function internal.identity_submission_waiting(uuid) from public, anon, authenticated, service_role;

-- A submission replaced by a newer one is a failed attempt: its files are due
-- 5 days later.
CREATE OR REPLACE FUNCTION internal.identity_submission_replaced()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.evidence_artifacts a
    set retain_until=least(coalesce(a.retain_until,'infinity'::timestamptz),statement_timestamp()+interval '5 days')
    from private.verification_identity_submissions s
    where s.id=old.submission_id and a.id in(s.id_artifact_id,s.selfie_artifact_id)
      and a.state in('uploaded','clean','rejected');
  return null;
end$function$;
alter function internal.identity_submission_replaced() owner to postgres;
revoke all on function internal.identity_submission_replaced() from public, anon, authenticated, service_role;

drop trigger if exists identity_submission_replaced on private.verification_current_submissions;
create trigger identity_submission_replaced after update of submission_id on private.verification_current_submissions
  for each row when (old.submission_id is distinct from new.submission_id)
  execute function internal.identity_submission_replaced();

-- ---------------------------------------------------------- the check's row

-- The start context has no purpose after the result: a check that leaves
-- "started" loses its typed names at start, network hash and device kind.
CREATE OR REPLACE FUNCTION internal.identity_check_clear_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.start_first_name:=null;
  new.start_last_name:=null;
  new.network_hash:=null;
  new.device_kind:=null;
  return new;
end$function$;
alter function internal.identity_check_clear_start() owner to postgres;
revoke all on function internal.identity_check_clear_start() from public, anon, authenticated, service_role;

drop trigger if exists identity_check_clear_start on private.identity_checks;
create trigger identity_check_clear_start before update on private.identity_checks
  for each row when (new.status <> 'started') execute function internal.identity_check_clear_start();

alter table private.identity_checks
  alter column start_first_name drop not null,
  alter column start_last_name drop not null,
  drop constraint if exists identity_checks_start_names_check,
  drop constraint if exists identity_checks_start_cleared_check,
  drop constraint if exists identity_checks_asked_check;
-- Checks that finished before this update lose their start context now.
update private.identity_checks set start_first_name=null,start_last_name=null,network_hash=null,device_kind=null
  where status<>'started' and (start_first_name is not null or network_hash is not null);
alter table private.identity_checks
  -- A started check has the typed names it started with; a finished one none.
  add constraint identity_checks_start_names_check check ((start_first_name is null) = (start_last_name is null)
    and (status = 'started') = (start_first_name is not null)
    and (start_first_name is null
      or (internal.person_name_valid(start_first_name) and internal.person_name_valid(start_last_name)))),
  add constraint identity_checks_start_cleared_check
    check (status = 'started' or (network_hash is null and device_kind is null)),
  -- The reason may be cleared (90 days after the account closes); the request
  -- stays recorded.
  add constraint identity_checks_asked_check
    check ((asked_at is not null or ask_reason is null) and (asked_at is null or status = 'declined'));

-- ------------------------------------------------------------------ members

-- What the member's page shows about a check (no reasons: those are for
-- staff). A declined check carries decline_reason, a category the page can
-- name: id_unreadable (the document or its ID number could not be read),
-- names_differ (the typed names are not the names on the ID), under_18,
-- photo_not_matched (the partner declined or was unsure) or not_confirmed
-- (anything else; a ban, a duplicate or a high risk score is never named).
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
    'decline_reason',case when k.status='declined' then case
      when k.reasons && array['banned','duplicate','high_risk']::text[] then 'not_confirmed'
      when 'under_18'=any(k.reasons) then 'under_18'
      when k.reasons && array['document_not_accepted','id_number_invalid']::text[] then 'id_unreadable'
      when 'names_differ'=any(k.reasons) then 'names_differ'
      when k.reasons && array['provider_declined','provider_in_review']::text[] then 'photo_not_matched'
      else 'not_confirmed' end end,
    'can_ask_person',internal.identity_check_askable(k),
    'asked_at',k.asked_at,'with_person',internal.identity_check_with_person(k));
$function$;
alter function internal.identity_check_summary(private.identity_checks) owner to postgres;
revoke all on function internal.identity_check_summary(private.identity_checks) from public, anon, authenticated, service_role;

-- Starts the member's automatic check (recording the typed legal names it
-- starts with), or returns their unfinished one. An
-- unfinished check is resumed whatever the setting, pause or spending guard
-- now say (it was counted when it started; if the setting is manual when the
-- result arrives, the result goes to staff). A new check needs no request to a
-- person still waiting, a verified phone (the phone step comes first), the
-- typed legal names, an identity case that is not accepted or under
-- independent review, and the automatic route. The new row is exactly one
-- (strict).
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
      from private.profiles p where p.account_id=actor returning * into strict k;
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'session_id',null,'session_url',null,'created',true);
end$function$;
alter function internal.start_my_identity_check() owner to postgres;
revoke all on function internal.start_my_identity_check() from public, anon, authenticated, service_role;
grant execute on function internal.start_my_identity_check() to authenticated;

-- "Ask a person to look again" for a declined check (reason 20 to 2000
-- characters, as appeals): records the request on the check and puts the
-- declined submission back in the staff queue; its files are kept until a
-- person decides. The staff decision is the answer, told by the existing
-- "verified" or "sent back" notice.
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
  -- The decline made the files due 5 days later; a person now decides first.
  update private.evidence_artifacts a set retain_until=null from private.verification_identity_submissions s
    where s.id=k.submission_id and a.id in(s.id_artifact_id,s.selfie_artifact_id)
      and a.state in('uploaded','clean','rejected');
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'asked_at',k.asked_at,'reused',false);
end$function$;
alter function internal.ask_person_identity_check(uuid,text) owner to postgres;
revoke all on function internal.ask_person_identity_check(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.ask_person_identity_check(uuid,text) to authenticated;

-- ------------------------------------------------------- the website's server

-- A decline on the automatic setting: the submission stays (for a person to
-- look at if the member asks) but leaves the case's current place, so no queue
-- shows it and the member's page offers a new attempt. Its files and the
-- partner's copy are due for deletion 5 days later unless the member asks a
-- person.
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
  update private.evidence_artifacts a
    set retain_until=least(coalesce(a.retain_until,'infinity'::timestamptz),now_at+interval '5 days')
    from private.verification_identity_submissions s
    where s.id=p_submission and a.id in(s.id_artifact_id,s.selfie_artifact_id)
      and a.state in('uploaded','clean','rejected');
end$function$;
alter function internal.decline_automatic_identity_submission(uuid,uuid) owner to postgres;
revoke all on function internal.decline_automatic_identity_submission(uuid,uuid) from public, anon, authenticated, service_role;

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
-- names_differ when those, or the names the check started with, are not
-- exactly the names the new submission records (the member's names may change
-- during the check), banned, duplicate and high_risk. A check past its 24-hour
-- expiry is recorded as not_finished whatever the outcome. A clean pass
-- (approved, no reason) on a partner setting verifies at once; otherwise the
-- result goes to staff (staff_final, manual at this moment, or session_moved
-- on any setting) or is declined (automatic).
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
      and n.legal_first_name=p_names->>'first_name' and n.legal_last_name=p_names->>'last_name'
      and n.legal_first_name=k.start_first_name and n.legal_last_name=k.start_last_name) then '{}'::text[]
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
  elsif setting_mode='automatic' and not ('session_moved'=any(found_reasons)) then
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

-- Partner sessions to delete now (for the 5-minute job). First closes checks
-- still unfinished an hour after their 24-hour expiry, and schedules the
-- checks a person has decided since: an accepted one 30 days after the
-- acceptance (the ID photo's month), one sent to staff or asked about that
-- was not accepted (sent back, or its case closed) 5 days from now. Each
-- returned session is held for 5 minutes, so an overlapping run does not send
-- it twice and a failed delete is retried. Fraud and legal holds keep a
-- session.
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
  update private.identity_checks k set provider_delete_due=f.reviewed_at+interval '30 days'
    from private.accepted_identity_facts f
    where f.submission_id=k.submission_id and k.provider_delete_due is null and k.provider_deleted_at is null
      and k.session_id is not null;
  update private.identity_checks k set provider_delete_due=now_at+interval '5 days'
    where k.status in('with_staff','declined') and k.provider_delete_due is null and k.provider_deleted_at is null
      and k.session_id is not null
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=k.submission_id)
      and not internal.identity_submission_waiting(k.submission_id);
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

-- -------------------------------------------------------------------- staff

-- Changes the setting (admin, recent second factor, a reason of 5 to 500
-- characters without control or direction characters). Setting a mode, even
-- the current one, ends a pause early (for example after a top-up).
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

-- A staff member sends an identity submission back. The member is told; the
-- case's files are due 5 days later (a failed attempt keeps only its
-- fingerprint).
CREATE OR REPLACE FUNCTION internal.return_identity_submission(p_case uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); c private.evidence_cases; subject uuid; reason text; returned uuid;
begin
  reason:=internal.retention_reason(p_reason);
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.version<>p_expected_version or c.version>=2147483647 or c.subject_id=actor
    or exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed') then raise exception 'reviewed case changed' using errcode='PT409'; end if;
  update private.evidence_cases set version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id returning * into c;
  update private.evidence_artifacts
    set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),statement_timestamp()+interval '5 days')
    where case_id=c.id and state in('clean','uploaded','rejected');
  insert into private.verification_return_requests(case_id,case_version,reason,reviewer_id) values(c.id,c.version,reason,actor) returning id into returned;
  -- The member is told: a notice in the account and an email. Neither carries
  -- the reason or any identity detail; the member reads the reason on the
  -- verification page after signing in.
  if c.kind='kyc' then
    perform internal.notify_account(c.subject_id,'verification_returned',returned,null,null);
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('verification_returned',returned,c.subject_id,'verification_returned:'||returned);
  end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','needs_resubmission');
end;
$function$;
alter function internal.return_identity_submission(uuid,integer,text,uuid,text) owner to postgres;
revoke all on function internal.return_identity_submission(uuid,integer,text,uuid,text) from public;
grant execute on function internal.return_identity_submission(uuid,integer,text,uuid,text) to authenticated;

-- ------------------------------------------------------------- the clean-up

-- On an open identity case, deleting a file that no current submission uses
-- (a failed attempt's, or a reservation never completed) changes nothing a
-- reviewer sees, so it no longer changes the case version.
CREATE OR REPLACE FUNCTION internal.evidence_artifact_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare subject uuid; case_id uuid; c private.evidence_cases; relevant boolean;
begin
  subject:=case when tg_op='DELETE' then old.owner_id else new.owner_id end;
  case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  perform internal.lock_evidence_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=case_id and e.subject_id=subject for update;
  if not found then raise exception 'artifact subject must match case' using errcode='23514'; end if;
  if tg_op='INSERT' then
    relevant:=true;
    if c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  elsif tg_op='DELETE' then relevant:=true;
  else
    relevant:=(new.state,new.sha256,new.size_bytes) is distinct from (old.state,old.sha256,old.size_bytes)
      and not (new.state in('cleanup_required','deleted')
        and (new.sha256,new.size_bytes) is not distinct from (old.sha256,old.size_bytes)
        and (c.status<>'open'
          or (c.kind='kyc' and not exists(select 1 from private.verification_current_submissions v
            join private.verification_identity_submissions s on s.id=v.submission_id
            where v.case_id=c.id and new.id in(s.id_artifact_id,s.selfie_artifact_id)))));
    if relevant and new.state in ('uploaded','clean','rejected') and
      (c.status<>'open' or exists(select 1 from private.account_closures x where x.user_id=subject)) then
      raise exception 'case no longer accepts evidence' using errcode='22023';
    end if;
  end if;
  if relevant then
    update private.evidence_cases set version=version+1 where id=c.id and version<2147483647;
    if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
alter function internal.evidence_artifact_submission_guard() owner to postgres;
revoke all on function internal.evidence_artifact_submission_guard() from public;

-- Evidence files to delete from storage now. A selfie whose identity record is
-- kept (internal.identity_record_kept) is not due, whatever its date.
CREATE OR REPLACE FUNCTION internal.claim_evidence_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare rows jsonb:='[]'::jsonb; candidate record; art private.evidence_artifacts; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  for candidate in select a.id,a.owner_id,a.case_id from private.evidence_artifacts a
    where ((a.state='intent' and a.created_at<statement_timestamp()-interval '1 hour')
      or (a.state in('uploaded','clean','rejected') and coalesce(a.retain_until,a.created_at+interval '90 days')<=statement_timestamp()
        and not exists(select 1 from private.verification_identity_submissions s
          where s.selfie_artifact_id=a.id and internal.identity_record_kept(s.id)))
      or (a.state='cleanup_required' and coalesce(a.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp()))
      -- Filter holds before the batch limit, and check them again under locks.
      -- Otherwise a held prefix can starve every later unheld artifact forever.
      and not exists(select 1 from private.legal_holds h where h.subject_id=a.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(a.case_id)
    order by a.owner_id,a.case_id,a.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    perform c.id from private.evidence_cases c where c.id=candidate.case_id for update skip locked;
    if not found then continue; end if;
    select a.* into art from private.evidence_artifacts a where a.id=candidate.id for update skip locked;
    if not found then continue; end if;
    if exists(select 1 from private.legal_holds h where h.subject_id=art.owner_id and h.released_at is null)
      or internal.evidence_fraud_held(art.case_id) then continue; end if;
    if not ((art.state='intent' and art.created_at<statement_timestamp()-interval '1 hour')
      or (art.state in('uploaded','clean','rejected') and coalesce(art.retain_until,art.created_at+interval '90 days')<=statement_timestamp()
        and not exists(select 1 from private.verification_identity_submissions s
          where s.selfie_artifact_id=art.id and internal.identity_record_kept(s.id)))
      or (art.state='cleanup_required' and coalesce(art.cleanup_lease_until,'-infinity'::timestamptz)<=statement_timestamp())) then continue; end if;
    token:=pg_catalog.gen_random_uuid();
    update private.evidence_artifacts set state='cleanup_required',cleanup_token=token,cleanup_lease_until=statement_timestamp()+interval '5 minutes' where id=art.id;
    rows:=rows||jsonb_build_array(jsonb_build_object('artifact_id',art.id,'object_key',art.object_key,'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$function$;
alter function internal.claim_evidence_cleanup(integer) owner to postgres;
revoke all on function internal.claim_evidence_cleanup(integer) from public;
grant execute on function internal.claim_evidence_cleanup(integer) to service_role;

-- The verification part of the daily retention job (api.run_retention).
CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; signup_acceptances integer; choice_events integer; histories integer:=0; cases uuid[];
  attempt_names integer; checks integer; ask_reasons integer; disclosures integer; mode_events integer; overdue integer;
begin
  -- The encrypted ID number goes with the selfie: once the selfie is deleted
  -- or due, unless its identity record is kept (internal.identity_record_kept).
  for candidate in
    select s.id,s.owner_id,s.case_id from private.verification_identity_submissions s
      join private.evidence_artifacts a on a.id=s.selfie_artifact_id
    where s.number_erased_at is null
      and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp())
      and not internal.identity_record_kept(s.id)
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.owner_id,s.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    update private.verification_identity_submissions
      set number_ciphertext=null,number_iv=null,number_tag=null,number_erased_at=statement_timestamp()
    where id=candidate.id and number_erased_at is null
      and exists(select 1 from private.evidence_artifacts a where a.id=selfie_artifact_id
        and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp()))
      and not internal.identity_record_kept(candidate.id)
      and not internal.evidence_fraud_held(candidate.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null);
    if found then numbers:=numbers+1; end if;
  end loop;

  -- A failed attempt keeps only its fingerprint: the names it was made with go
  -- once its ID number is erased.
  delete from private.identity_submission_names where submission_id in(select s.id
    from private.verification_identity_submissions s join private.identity_submission_names n on n.submission_id=s.id
    where s.number_erased_at is not null
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=s.id)
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.number_erased_at,s.id limit p_limit);
  get diagnostics attempt_names=row_count;

  -- A check that did not lead to an accepted identity goes 7 days after it
  -- finished (the spending guard counts 7 days), once the partner's copy is
  -- deleted and no person is still to decide it, with its "ask a person"
  -- reason.
  delete from private.identity_checks where id in(select k.id from private.identity_checks k
    where k.status<>'started' and k.finished_at<statement_timestamp()-interval '7 days'
      and (k.session_id is null or k.provider_deleted_at is not null)
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=k.submission_id)
      and not internal.identity_submission_waiting(k.submission_id)
      and not internal.evidence_fraud_held(k.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
    order by k.finished_at,k.id limit p_limit for update skip locked);
  get diagnostics checks=row_count;

  -- A closed account's "ask a person" reasons go with its selfie, 90 days
  -- after closure.
  update private.identity_checks set ask_reason=null where id in(select k.id from private.identity_checks k
    join private.account_closures x on x.user_id=k.owner_id
    where k.ask_reason is not null and x.evidence_delete_after<=statement_timestamp()
      and not internal.evidence_fraud_held(k.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
    order by x.closed_at,k.id limit p_limit for update of k skip locked);
  get diagnostics ask_reasons=row_count;

  -- Revoked phone proofs go 30 days after revocation, except the numbers an
  -- account with an accepted identity had verified when it closed: those stay
  -- with its identity record for the five-year sweep below.
  delete from private.verification_phone_proofs where id in(select p.id from private.verification_phone_proofs p
    where p.revoked_at<statement_timestamp()-interval '30 days'
      and not (exists(select 1 from private.account_closures x where x.user_id=p.owner_id and p.revoked_at>=x.closed_at)
        and exists(select 1 from private.accepted_identity_facts f where f.owner_id=p.owner_id))
    order by p.revoked_at limit p_limit for update skip locked);
  get diagnostics proofs=row_count;
  delete from private.verification_phone_challenges where id in(select c.id from private.verification_phone_challenges c
    where c.expires_at<statement_timestamp()-interval '24 hours'
      and not exists(select 1 from private.verification_phone_proofs p where p.challenge_id=c.id)
    order by c.expires_at limit p_limit for update skip locked);
  get diagnostics challenges=row_count;

  -- Thirty days after closure: home area and the consent records go
  -- (posting-terms acceptances, the sign-up Terms acceptance and the
  -- communication choice history, together). Each batch takes the oldest
  -- closed accounts that still hold such rows, so the sweep never stalls on
  -- accounts already cleared.
  delete from private.verification_localities where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.verification_localities l where l.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics localities=row_count;
  delete from private.posting_terms_acceptances where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.posting_terms_acceptances a where a.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics acceptances=row_count;
  delete from private.signup_terms_acceptances where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.signup_terms_acceptances a where a.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics signup_acceptances=row_count;
  delete from private.communication_choice_events where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.communication_choice_events e where e.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics choice_events=row_count;

  -- Five years after closure: the verification history of the account, once
  -- every file is deleted, no ban still depends on it and the partner holds
  -- no copy of its checks.
  for candidate in
    select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '5 years'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and not exists(select 1 from private.evidence_artifacts a where a.owner_id=x.user_id and a.state<>'deleted')
      and not exists(select 1 from private.identity_checks k where k.owner_id=x.user_id
        and k.session_id is not null and k.provider_deleted_at is null)
      and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=x.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)))
      and (exists(select 1 from private.evidence_cases c where c.subject_id=x.user_id
          and not exists(select 1 from private.decisions d where d.case_id=c.id and d.status='approved' and d.action='restrict_account'))
        or exists(select 1 from private.verification_phone_challenges p where p.owner_id=x.user_id))
    order by x.closed_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text,2408)) then continue; end if;
    -- Candidate discovery may precede other subjects' work in this batch.
    -- Recheck preservation rules under the same lock used by hold writers.
    if exists(select 1 from private.legal_holds h where h.subject_id=candidate.user_id and h.released_at is null)
      or exists(select 1 from private.evidence_cases c join private.evidence_fraud_holds h on h.case_id=c.id
        where c.subject_id=candidate.user_id and h.closed_at is null)
      or exists(select 1 from private.evidence_artifacts a where a.owner_id=candidate.user_id and a.state<>'deleted')
      or exists(select 1 from private.identity_checks k where k.owner_id=candidate.user_id
        and k.session_id is not null and k.provider_deleted_at is null)
      or exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=candidate.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id))) then continue; end if;
    select coalesce(array_agg(c.id),'{}') into cases from private.evidence_cases c where c.subject_id=candidate.user_id;
    delete from private.identity_submission_names where owner_id=candidate.user_id;
    delete from private.verification_current_submissions where case_id=any(cases);
    delete from private.identity_review_proposals where submission_id in(select s.id from private.verification_identity_submissions s
      where s.owner_id=candidate.user_id) or decision_id in(select d.id from private.decisions d where d.case_id=any(cases));
    delete from private.identity_ban_proposal_requests where owner_id=candidate.user_id;
    delete from private.accepted_identity_facts where owner_id=candidate.user_id;
    delete from private.decisions where case_id=any(cases) and not (status='approved' and action='restrict_account');
    delete from private.evidence_access_log where case_id=any(cases);
    delete from private.evidence_fraud_holds where case_id=any(cases);
    delete from private.verification_identity_submissions where owner_id=candidate.user_id;
    delete from private.evidence_artifacts where owner_id=candidate.user_id;
    delete from private.evidence_cases c where c.id=any(cases) and not exists(select 1 from private.decisions d where d.case_id=c.id);
    delete from private.verification_phone_proofs where owner_id=candidate.user_id;
    delete from private.verification_phone_challenges where owner_id=candidate.user_id;
    delete from private.legal_holds where subject_id=candidate.user_id and released_at is not null;
    histories:=histories+1;
  end loop;

  -- Authority-request logs: deleted 5 years after the search once every
  -- named account closed more than 5 years ago and none has an open legal
  -- hold (a search that named nobody: 5 years after the search).
  delete from private.identity_disclosures where id in(select d.id from private.identity_disclosures d
    where d.opened_at<statement_timestamp()-interval '5 years'
      and coalesce((select bool_and((exists(select 1 from private.account_closures x where x.user_id=a.id
            and x.closed_at<statement_timestamp()-interval '5 years')
          or exists(select 1 from private.account_erasures e where e.user_id=a.id
            and e.closed_at<statement_timestamp()-interval '5 years'))
          and not exists(select 1 from private.legal_holds h where h.subject_id=a.id and h.released_at is null))
        from unnest(d.subject_ids) a(id)),true)
    order by d.opened_at,d.id limit p_limit for update skip locked);
  get diagnostics disclosures=row_count;
  -- The automatic ID check setting's change log: 5 years.
  delete from private.identity_check_mode_events where id in(select e.id from private.identity_check_mode_events e
    where e.changed_at<statement_timestamp()-interval '5 years'
    order by e.changed_at,e.id limit p_limit for update skip locked);
  get diagnostics mode_events=row_count;
  -- Partner deletions overdue by more than a day (holds excepted): a stalled
  -- deletion job shows here.
  select count(*) into overdue from private.identity_checks k
    where k.session_id is not null and k.provider_deleted_at is null
      and k.provider_delete_due<statement_timestamp()-interval '1 day'
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(k.case_id);

  return jsonb_build_object('identity_numbers_erased',numbers,'phone_proofs',proofs,'phone_challenges',challenges,
    'closed_account_localities',localities,'closed_account_terms_acceptances',acceptances,
    'closed_account_signup_terms',signup_acceptances,'closed_account_communication_choices',choice_events,
    'closed_account_verification_histories',histories,'failed_attempt_names',attempt_names,
    'identity_checks',checks,'closed_account_ask_reasons',ask_reasons,'identity_disclosures',disclosures,
    'identity_check_mode_events',mode_events,'overdue_partner_deletions',overdue);
end;
$function$;
alter function internal.retention_verification(integer) owner to postgres;
revoke all on function internal.retention_verification(integer) from public;

commit;
