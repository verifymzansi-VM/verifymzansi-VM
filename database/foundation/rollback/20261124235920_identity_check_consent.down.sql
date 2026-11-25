-- Reviewed rollback for updates/20261124235920_identity_check_consent.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It refuses unless the automatic
-- ID check setting is Manual, and it refuses once any check has recorded a
-- member's consent: that consent is evidence for a biometric check and must be
-- kept, so write a forward update instead. Deploy a website that starts checks
-- without p_consent_version first: the restored command has no consent
-- argument, so a website sending one would get an error.
-- The rollback drops the trigger identity_check_consent_required, its
-- function and internal.identity_check_consent_version(), puts back
-- internal.start_my_identity_check() and api.start_my_identity_check()
-- without the argument, and internal.get_identity_check_for_case and
-- internal.get_frontend_staff_verification_queue, byte for byte, then drops
-- the columns consent_version and consented_at (empty on every check, as the
-- refusal above ensures); the checks themselves are not touched.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce(case
        when v.sig = 'columns' then (select string_agg(attname, ',' order by attname) from pg_attribute
          where attrelid = 'private.identity_checks'::regclass and attname in ('consent_version','consented_at') and not attisdropped)
        when v.sig = 'trigger' then (select tgname::text from pg_trigger where tgrelid = 'private.identity_checks'::regclass
          and tgname = 'identity_check_consent_required')
        else (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) end,'absent')
    from (values ('internal.start_my_identity_check(text)'), ('api.start_my_identity_check(text)'),
      ('internal.start_my_identity_check()'), ('api.start_my_identity_check()'),
      ('internal.get_identity_check_for_case(uuid)'), ('internal.get_frontend_staff_verification_queue(integer,uuid[])'),
      ('internal.identity_check_consent_version()'), ('internal.identity_check_consent_required()'),
      ('columns'), ('trigger')) v(sig)
  loop
    if shape not in (
        'internal.start_my_identity_check(text) 4f7257c7fb03093617f70dcb6a9ae012',
        'api.start_my_identity_check(text) f386295ef5231b9eee6d5ae36bed8974',
        'internal.start_my_identity_check() absent',
        'api.start_my_identity_check() absent',
        'internal.get_identity_check_for_case(uuid) 3a84f2d71e895d74ac204535436964bd',
        'internal.get_frontend_staff_verification_queue(integer,uuid[]) 60c7c04bbf0e93242f23105e34a6a04b',
        'internal.identity_check_consent_version() b4006d3e91c149d8b0abcd06ab5d93f4',
        'internal.identity_check_consent_required() 0297ae02575e99da2dd833ac433b35c5',
        'columns consent_version,consented_at',
        'trigger identity_check_consent_required') then
      raise exception 'rollback precondition: the identity check consent update is not applied as reviewed (%)', shape
        using errcode='55000';
    end if;
  end loop;
  if (select x.mode from private.identity_check_settings x where x.id) is distinct from 'manual' then
    raise exception 'rollback refused: the automatic ID check setting must be Manual' using errcode='55000';
  end if;
  if exists(select 1 from private.identity_checks k where k.consent_version is not null) then
    raise exception 'rollback refused: checks have recorded members'' consent; write a forward update instead'
      using errcode='55000';
  end if;
end$$;

drop trigger if exists identity_check_consent_required on private.identity_checks;
drop function if exists api.start_my_identity_check(text);
drop function if exists internal.start_my_identity_check(text);

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
revoke all on function internal.get_identity_check_for_case(uuid) from public;
grant execute on function internal.get_identity_check_for_case(uuid) to authenticated;

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

drop function if exists internal.identity_check_consent_required();
drop function if exists internal.identity_check_consent_version();
alter table private.identity_checks drop column if exists consent_version, drop column if exists consented_at;

commit;
