-- The member's consent to the automatic ID check, recorded in the database
-- (launch checklist item 61, part 7a; Didit plan sections 3 and 6).
--
-- Before automatic ID checks can be switched on, every check must carry the
-- member's consent to the independent verification partner. From this update:
-- 1. private.identity_checks gains consent_version and consented_at: the
--    version of the consent words the member agreed to, and when. A new check
--    is refused unless both are set and the version is the current one (PT409,
--    detail identity_check_consent_required; trigger
--    identity_check_consent_required, before insert, so checks made before
--    this update keep their empty values).
-- 2. internal.identity_check_consent_version() is the one place that names the
--    current consent words: 'identity-check-consent-v1' (the website's
--    IDENTITY_CHECK_CONSENT_VERSION). Change both together when the words
--    change.
-- 3. api.start_my_identity_check gains the optional argument
--    p_consent_version and stores it with the start time on the new check.
--    Everything else is unchanged: an unfinished check is returned as before
--    (it carries its own recorded consent), and every earlier refusal comes
--    first. A call without the argument (the website before part 7) gets the
--    same answers as before, except that it can no longer create a check.
-- 4. Staff: api.get_identity_check_for_case adds consent_version and
--    consented_at to the check, and api.get_frontend_staff_verification_queue
--    adds identity_check to each case: the latest check's status only (null
--    when the case has none), the same check the case read shows. The reason
--    codes stay in the case read (a held claim, a recent second factor and a
--    logged access); the queue shows no reasons, names or sessions.
--
-- Expand only: the command keeps its name and every caller's call; the new
-- argument is optional. A later contract step makes it required. Replaces 2
-- functions with full bodies, replaces internal.start_my_identity_check() and
-- its api wrapper by versions with the argument, and adds two columns, a
-- helper, a trigger function and a trigger. ORDER: website first (merge and
-- deploy, then apply): the live staff queue reader is strict and refuses the
-- new identity_check field until this pull request's reader is deployed, and
-- the deploy gate's anonymous probe leaves optional arguments out, so it
-- passes on either side of the update. The website that sends
-- p_consent_version (part 7) deploys only after this update is applied.
-- Apply only while the automatic ID check setting is Manual, and keep it Manual
-- until part 7 (pull request #360) is deployed: on Staff final or Automatic a
-- start without the argument is refused and the photo routes refuse too, so
-- members could not verify. The update refuses unless the setting is Manual.
-- Read-only preflight: ../preflight/20261124235920_identity_check_consent.check.sql.
-- Rollback: ../rollback/20261124235920_identity_check_consent.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the automatic ID check setting is Manual, every function this
-- update replaces has its reviewed body (or this update's), and the new pieces
-- are all absent or all present.
do $$
declare present integer; body record;
begin
  if (select x.mode from private.identity_check_settings x where x.id) is distinct from 'manual' then
    raise exception 'identity check consent precondition: the automatic ID check setting must be Manual' using errcode='55000';
  end if;
  select (to_regprocedure('internal.identity_check_consent_version()') is not null)::integer
    + (to_regprocedure('internal.identity_check_consent_required()') is not null)::integer
    + (to_regprocedure('internal.start_my_identity_check(text)') is not null)::integer
    + (to_regprocedure('api.start_my_identity_check(text)') is not null)::integer
    + (to_regprocedure('internal.start_my_identity_check()') is null)::integer
    + (to_regprocedure('api.start_my_identity_check()') is null)::integer
    + (exists(select 1 from pg_attribute where attrelid='private.identity_checks'::regclass
        and attname in ('consent_version','consented_at') and not attisdropped
        having count(*)=2))::integer
    + (exists(select 1 from pg_trigger where tgrelid='private.identity_checks'::regclass
        and tgname='identity_check_consent_required'))::integer
  into present;
  if present not in (0, 8) then
    raise exception 'identity check consent precondition: % of 8 pieces are in place', present using errcode='55000';
  end if;
  for body in select * from (values
      ('internal.start_my_identity_check()', '22d86444b8cde7fdafd832f8b91da440'),
      ('api.start_my_identity_check()', '5b05e790bcb4e799df2b33c3b05b7ef3'),
      ('internal.get_identity_check_for_case(uuid)', '78f53342647b77ea1d0bc1edcb64261f'),
      ('internal.get_frontend_staff_verification_queue(integer,uuid[])', '9c87b1e5234ba46a5678cf6bb0b4d3c1')
    ) v(sig, reviewed) loop
    if present = 0 and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
        where oid=to_regprocedure(body.sig)) is distinct from body.reviewed then
      raise exception 'identity check consent drift: % is not the reviewed body', body.sig using errcode='55000';
    end if;
  end loop;
end$$;

-- ------------------------------------------------------------- the consent

alter table private.identity_checks
  add column if not exists consent_version text,
  add column if not exists consented_at timestamp with time zone;
comment on column private.identity_checks.consent_version is
  'The version of the consent words the member agreed to before this check started (internal.identity_check_consent_version() at the time). Empty only on checks made before the consent was recorded.';
comment on column private.identity_checks.consented_at is
  'When the member agreed to the consent words for this check: the start time of the check.';

-- The current consent words. The website's IDENTITY_CHECK_CONSENT_VERSION
-- names the same words; change both together.
CREATE OR REPLACE FUNCTION internal.identity_check_consent_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'identity-check-consent-v1'::text;
$function$;
alter function internal.identity_check_consent_version() owner to postgres;
revoke all on function internal.identity_check_consent_version() from public, anon, authenticated, service_role;

-- A new check needs the member's consent to the current words.
CREATE OR REPLACE FUNCTION internal.identity_check_consent_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.consent_version is distinct from internal.identity_check_consent_version() or new.consented_at is null then
    raise exception 'identity check consent required' using errcode='PT409',detail='identity_check_consent_required';
  end if;
  return new;
end$function$;
alter function internal.identity_check_consent_required() owner to postgres;
revoke all on function internal.identity_check_consent_required() from public, anon, authenticated, service_role;

create or replace trigger identity_check_consent_required before insert on private.identity_checks
  for each row execute function internal.identity_check_consent_required();

-- ---------------------------------------------------------------- the start

-- The command keeps its name; the argument is new and optional, so the
-- no-argument versions go first (a call without the argument then reaches the
-- new version).
drop function if exists api.start_my_identity_check();
drop function if exists internal.start_my_identity_check();

CREATE OR REPLACE FUNCTION internal.start_my_identity_check(p_consent_version text)
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
  -- The trigger identity_check_consent_required refuses a missing or old
  -- consent version (PT409, detail identity_check_consent_required).
  insert into private.identity_checks(owner_id,case_id,created_at,expires_at,start_first_name,start_last_name,
      consent_version,consented_at)
    select actor,(opened->>'case_id')::uuid,now_at,now_at+interval '24 hours',p.legal_first_name,p.legal_last_name,
      p_consent_version,now_at
      from private.profiles p where p.account_id=actor returning * into strict k;
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'session_id',null,'session_url',null,'created',true);
end$function$;
alter function internal.start_my_identity_check(text) owner to postgres;
revoke all on function internal.start_my_identity_check(text) from public, anon, authenticated, service_role;
grant execute on function internal.start_my_identity_check(text) to authenticated;

CREATE OR REPLACE FUNCTION api.start_my_identity_check(p_consent_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_my_identity_check(p_consent_version);
$function$;
alter function api.start_my_identity_check(text) owner to postgres;
revoke all on function api.start_my_identity_check(text) from public, anon, authenticated, service_role;
grant execute on function api.start_my_identity_check(text) to authenticated;

-- ------------------------------------------------------------- staff reads

-- The case read shows the consent of the check.
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
    'asked_at',k.asked_at,'ask_reason',k.ask_reason,'consent_version',k.consent_version,'consented_at',k.consented_at));
end$function$;
alter function internal.get_identity_check_for_case(uuid) owner to postgres;
revoke all on function internal.get_identity_check_for_case(uuid) from public;
grant execute on function internal.get_identity_check_for_case(uuid) to authenticated;

-- The queue shows each case's latest check: its status only.
CREATE OR REPLACE FUNCTION internal.get_frontend_staff_verification_queue(p_limit integer DEFAULT 100, p_include_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');result jsonb;rows jsonb;total bigint;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_include_ids is null or cardinality(p_include_ids)>300 then raise exception 'bounded identity queue required' using errcode='22023';end if;
  with ready as(select c.id,c.subject_id,c.version,c.claim_generation,c.claim_nonce,c.claimed_by,c.claim_expires_at,
      s.id submission_id,s.id_artifact_id,s.selfie_artifact_id,s.created_at,s.risk_score,internal.profile_public_name(p.display_name) display_name,
      row_number() over(order by s.risk_score desc,s.created_at,c.id) n
      from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
      join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
      join private.profiles p on p.account_id=c.subject_id
      where c.kind='kyc' and c.status='open' and c.subject_id<>actor
      and exists(select 1 from private.current_account_access u where u.id=c.subject_id)
  )
  select coalesce((select jsonb_agg(jsonb_build_object('case_id',r.id,'owner_id',r.subject_id,'version',r.version,'display_name',r.display_name,
      'created_at',r.created_at,'steps',internal.frontend_identity_queue_steps(r.id),
      'identity_check',(select jsonb_build_object('status',k.status) from private.identity_checks k
        where k.case_id=r.id and k.status<>'unavailable' order by k.created_at desc,k.id desc limit 1),
      'review_scope',case when r.claimed_by=actor and r.claim_expires_at>statement_timestamp() then jsonb_build_object(
        'caseId',r.id,'caseVersion',r.version,'submissionId',r.submission_id,'claimGeneration',r.claim_generation::text,'claimNonce',r.claim_nonce) end) order by r.risk_score desc,r.created_at,r.id)
      from (select * from ready where n<=p_limit or id=any(p_include_ids) or claimed_by=actor and claim_expires_at>statement_timestamp() order by n limit 1401) r),'[]'::jsonb),
    2*(select count(*) from ready)-(select count(*) from private.frontend_identity_step_approvals a join ready r on r.submission_id=a.submission_id
      where a.final_result is null and a.matches and a.case_version=r.version and a.claim_generation=r.claim_generation
      and a.reviewer_id=r.claimed_by and r.claim_expires_at>statement_timestamp()
      and a.claim_nonce_digest=encode(sha256(convert_to(r.claim_nonce::text,'UTF8')),'hex')
      and a.artifact_id=(case a.purpose when 'id_front' then r.id_artifact_id else r.selfie_artifact_id end))
    into rows,total;
  if jsonb_array_length(rows)>1400 then raise exception 'narrow the identity queue selection' using errcode='PT409';end if;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('account_id',actor,'total_steps',total,'groups',rows);
end$function$;
alter function internal.get_frontend_staff_verification_queue(integer,uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_verification_queue(integer,uuid[]) from public;
grant execute on function internal.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;

commit;
