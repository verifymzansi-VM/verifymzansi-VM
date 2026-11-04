-- Preserve the selected ID and selfie review steps. Both explicit approvals
-- bind to one current submission/reviewer/lease before the native pair command
-- may accept an identity or request an independent high-risk decision.
begin;
alter table private.verification_return_requests add column decision text not null default 'needs_resubmission'
  check(decision in('rejected','needs_resubmission'));
create table private.frontend_identity_step_approvals(
  case_id uuid not null references private.evidence_cases(id) on delete cascade,
  submission_id uuid not null references private.verification_identity_submissions(id) on delete cascade,
  artifact_id uuid not null references private.evidence_artifacts(id) on delete cascade,
  case_version integer not null check(case_version>0),
  claim_generation bigint not null check(claim_generation>0),
  claim_nonce_digest text not null check(claim_nonce_digest ~ '^[a-f0-9]{64}$'),
  purpose text not null check(purpose in('id_front','selfie')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_session uuid,
  matches boolean not null check(matches),
  reviewer_note text check(reviewer_note is null or length(reviewer_note) between 1 and 2000),
  override_reason text check(override_reason is null or override_reason ~ '^[a-z][a-z0-9_]{2,99}$'),
  approved_at timestamptz not null default clock_timestamp(),
  final_result jsonb check(final_result is null or (jsonb_typeof(final_result)='object' and octet_length(final_result::text)<=4096)),
  acknowledge_until timestamptz,
  primary key(submission_id,claim_generation,purpose),
  unique(submission_id,claim_generation,artifact_id)
);
create index frontend_identity_step_case_idx on private.frontend_identity_step_approvals(case_id,case_version,claim_generation);
alter table private.frontend_identity_step_approvals enable row level security;
revoke all on private.frontend_identity_step_approvals from public,anon,authenticated,service_role;

create function internal.get_frontend_staff_identity_context(p_owner uuid default null,p_artifact uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view');c private.evidence_cases;found_ids uuid[];result jsonb;profile jsonb;accesses jsonb;
begin
  if p_owner is null and p_artifact is null then raise exception 'identity subject required' using errcode='22023';end if;
  select array_agg(e.id) into found_ids from private.evidence_cases e
    join private.verification_current_submissions v on v.case_id=e.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=e.version
    where e.kind='kyc' and e.status='open' and e.claimed_by=actor and e.claim_expires_at>clock_timestamp()
    and e.subject_id<>actor and (p_owner is null or e.subject_id=p_owner)
    and (p_artifact is null or p_artifact in(s.id_artifact_id,s.selfie_artifact_id));
  if coalesce(array_length(found_ids,1),0)<>1 then raise exception 'one current independent held case required' using errcode='42501';end if;
  select * into c from private.evidence_cases where id=found_ids[1];
  result:=internal.staff_identity_review_context(c.id,c.claim_generation::text,c.claim_nonce);
  if p_artifact is not null and p_artifact not in((result->>'id_artifact_id')::uuid,(result->>'selfie_artifact_id')::uuid) then
    raise exception 'reviewed submission changed' using errcode='PT409';end if;
  -- The profile context and recent access facts are purpose-bound to this same
  -- independently held case. Direct RPC access is audited too.
  perform internal.staff_evidence_metadata(c.id,c.claim_generation::text,c.claim_nonce,'routine_review');
  select jsonb_build_object('display_name',p.display_name,
    'account_verification_status',case when internal.current_verified_identity(c.subject_id) is not null then 'verified' else 'pending_review' end,
    'account_status',case when exists(select 1 from private.account_closures x where x.user_id=c.subject_id) then 'closed'
      when exists(select 1 from private.current_account_access a where a.id=c.subject_id) then 'active' else 'restricted' end,
    'strikes',null,'legal_hold',exists(select 1 from private.legal_holds h where h.subject_id=c.subject_id and h.released_at is null),
    'location_province',pr.label,'location_city',ci.label) into profile
    from private.profiles p left join private.verification_localities l on l.owner_id=p.account_id
    left join private.provinces pr on pr.id=l.province_id left join private.cities ci on ci.id=l.city_id where p.account_id=c.subject_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id::text||':'||a.id::text,'actor_id',l.staff_id,
    'actor_role','Not recorded','artifact_id',a.id,'ip_hash',null,'accessed_at',l.accessed_at,'purpose',l.purpose)
    order by l.accessed_at desc,l.id desc,a.id),'[]'::jsonb) into accesses
    from(select x.* from private.evidence_access_log x where x.case_id=c.id and x.case_version=(result->>'case_version')::integer
      order by x.accessed_at desc,x.id desc limit 100) l cross join lateral unnest(l.artifact_ids) a(id)
    where a.id in((result->>'id_artifact_id')::uuid,(result->>'selfie_artifact_id')::uuid);
  perform internal.staff_actor('evidence:view');
  return result||jsonb_build_object('reviewer_id',actor,'owner_id',c.subject_id,'claim_generation',c.claim_generation::text,
    'claim_nonce',c.claim_nonce,'claim_expires_at',c.claim_expires_at,'owner_profile',profile,'access_log',accesses);
end$$;
revoke all on function internal.get_frontend_staff_identity_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_identity_context(uuid,uuid) to authenticated;
create function api.get_frontend_staff_identity_context(p_owner uuid default null,p_artifact uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_staff_identity_context(p_owner,p_artifact)$$;
revoke all on function api.get_frontend_staff_identity_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_identity_context(uuid,uuid) to authenticated;

create function internal.approve_frontend_identity_step(p_case uuid,p_submission uuid,p_artifact uuid,p_expected_version integer,
  p_claim_generation text,p_claim_nonce uuid,p_matches boolean,p_note text default null,p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine');s private.verification_identity_submissions;
  c private.evidence_cases;prior private.frontend_identity_step_approvals;chosen_purpose text;id_matches boolean;selfie_matches boolean;answer jsonb;
begin
  if p_matches is distinct from true then raise exception 'explicit step match attestation required' using errcode='22023';end if;
  if p_claim_generation is null or p_claim_generation !~ '^[1-9][0-9]{0,18}$' or p_claim_nonce is null then raise exception 'represented claim required' using errcode='22023';end if;
  select * into s from private.verification_identity_submissions where id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023';end if;
  if p_case is distinct from s.case_id then raise exception 'represented identity case required' using errcode='PT409';end if;
  perform internal.lock_verification_subject(s.owner_id);
  select * into c from private.evidence_cases where id=s.case_id for update;
  actor:=internal.staff_actor('verification:decide_routine');
  if c.subject_id=actor then raise exception 'self-review is not allowed' using errcode='42501';end if;
  if not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then raise exception 'active identity subject required' using errcode='42501';end if;
  chosen_purpose:=case p_artifact when s.id_artifact_id then 'id_front' when s.selfie_artifact_id then 'selfie' end;
  if chosen_purpose is null or p_expected_version is distinct from s.case_version then raise exception 'represented identity artifact required' using errcode='PT409';end if;
  if s.risk_score>50 then perform internal.staff_actor('decision:propose');end if;
  if p_note is not null and (length(btrim(p_note)) not between 1 and 2000 or p_note ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]') then raise exception 'valid reviewer note required' using errcode='22023';end if;
  if p_override_reason is not null and p_override_reason !~ '^[a-z][a-z0-9_]{2,99}$' or s.risk_score>50 and p_override_reason is null then raise exception 'high-risk review reason required' using errcode='22023';end if;
  select * into prior from private.frontend_identity_step_approvals r where r.submission_id=s.id and r.claim_generation::text=p_claim_generation and r.purpose=chosen_purpose;
  if prior.submission_id is not null and (prior.reviewer_note is distinct from nullif(btrim(p_note),'') or prior.override_reason is distinct from p_override_reason) then raise exception 'step approval receipt changed' using errcode='PT409';end if;
  -- Final acknowledgements resolve an exact explicit retry after a lost reply.
  -- They never grant authority or mutate a newer case/submission.
  if prior.reviewer_id=actor and prior.case_version=p_expected_version and prior.artifact_id=p_artifact and prior.final_result is not null
    and prior.acknowledge_until>clock_timestamp() and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex') then
    if prior.final_result->>'status'='accepted' and not exists(select 1 from private.accepted_identity_facts f where f.id::text=prior.final_result->>'identity_fact_id' and f.submission_id=s.id and f.reviewed_by=actor and f.revoked_at is null) then raise exception 'identity outcome changed' using errcode='PT409';end if;
    if prior.final_result->>'status'='awaiting_second_reviewer' and not exists(select 1 from private.decisions d where d.id::text=prior.final_result->>'decision_id' and d.case_id=c.id and d.case_version=p_expected_version and d.status='proposed' and d.proposed_by=actor) then raise exception 'independent decision changed' using errcode='PT409';end if;
    return prior.final_result||jsonb_build_object('case_id',c.id,'submission_id',s.id,'artifact_id',p_artifact,'purpose',chosen_purpose,'reused',true);
  end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.version<>p_expected_version or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409';end if;
  insert into private.frontend_identity_step_approvals(case_id,submission_id,artifact_id,case_version,claim_generation,claim_nonce_digest,purpose,reviewer_id,reviewer_session,matches,reviewer_note,override_reason)
    values(c.id,s.id,p_artifact,c.version,c.claim_generation,encode(sha256(convert_to(c.claim_nonce::text,'UTF8')),'hex'),chosen_purpose,actor,(auth.jwt()->>'session_id')::uuid,p_matches,nullif(btrim(p_note),''),p_override_reason)
    on conflict(submission_id,claim_generation,purpose) do nothing;
  if exists(select 1 from private.frontend_identity_step_approvals r where r.submission_id=s.id and r.claim_generation=c.claim_generation
    and (r.reviewer_id is distinct from actor or r.case_version<>c.version or r.claim_nonce_digest<>encode(sha256(convert_to(c.claim_nonce::text,'UTF8')),'hex') or r.artifact_id<>(case r.purpose when 'id_front' then s.id_artifact_id else s.selfie_artifact_id end))) then
    raise exception 'step review binding changed' using errcode='PT409';end if;
  select r.matches into id_matches from private.frontend_identity_step_approvals r where r.submission_id=s.id and r.claim_generation=c.claim_generation and r.purpose='id_front';
  select r.matches into selfie_matches from private.frontend_identity_step_approvals r where r.submission_id=s.id and r.claim_generation=c.claim_generation and r.purpose='selfie';
  if id_matches is true and selfie_matches is true then
    answer:=internal.review_identity_submission(s.id,c.version,p_claim_generation,p_claim_nonce,id_matches,selfie_matches);
    update private.frontend_identity_step_approvals set final_result=answer,acknowledge_until=c.claim_expires_at where submission_id=s.id and claim_generation=c.claim_generation;
  else answer:=jsonb_build_object('status','step_approved','case_id',c.id,'submission_id',s.id,'artifact_id',p_artifact,'purpose',chosen_purpose);end if;
  perform internal.staff_actor('verification:decide_routine');return answer||jsonb_build_object('case_id',c.id,'submission_id',s.id,'artifact_id',p_artifact,'purpose',chosen_purpose);
end$$;
revoke all on function internal.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) to authenticated;
create function api.approve_frontend_identity_step(p_case uuid,p_submission uuid,p_artifact uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,p_matches boolean,p_note text default null,p_override_reason text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.approve_frontend_identity_step(p_case,p_submission,p_artifact,p_expected_version,p_claim_generation,p_claim_nonce,p_matches,p_note,p_override_reason)$$;
revoke all on function api.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function api.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) to authenticated;

create function internal.return_frontend_identity_step(p_case uuid,p_submission uuid,p_artifact uuid,p_expected_version integer,
  p_claim_generation text,p_claim_nonce uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine');s private.verification_identity_submissions;answer jsonb;n integer;
begin
  if p_decision is null or p_decision not in('rejected','needs_resubmission') then raise exception 'review outcome required' using errcode='22023';end if;
  select * into s from private.verification_identity_submissions where id=p_submission and case_id=p_case;
  if not found or p_expected_version is distinct from s.case_version or p_artifact is null or p_artifact not in(s.id_artifact_id,s.selfie_artifact_id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=p_case and v.submission_id=s.id) then raise exception 'represented submission required' using errcode='PT409';end if;
  answer:=internal.return_identity_submission(p_case,p_expected_version,p_claim_generation,p_claim_nonce,p_reason);
  update private.verification_return_requests set decision=p_decision where case_id=p_case and case_version=(answer->>'version')::integer and reviewer_id=actor;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'review outcome could not be bound' using errcode='PT409';end if;
  perform internal.staff_actor('verification:decide_routine');
  return answer||jsonb_build_object('decision',p_decision,'submission_id',s.id,'artifact_id',p_artifact);
end$$;
revoke all on function internal.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) to authenticated;
create function api.return_frontend_identity_step(p_case uuid,p_submission uuid,p_artifact uuid,p_expected_version integer,p_claim_generation text,p_claim_nonce uuid,p_decision text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.return_frontend_identity_step(p_case,p_submission,p_artifact,p_expected_version,p_claim_generation,p_claim_nonce,p_decision,p_reason)$$;
revoke all on function api.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) to authenticated;

create function internal.get_my_frontend_identity_state()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();c private.evidence_cases;r private.verification_return_requests;reviewed timestamptz;accepted_submission uuid;current_submission uuid;id_uploaded timestamptz;selfie_uploaded timestamptz;
begin
  select e.* into c from private.evidence_cases e where e.kind='kyc' and e.subject_id=actor order by e.created_at desc,e.id limit 1;
  select x.* into r from private.verification_return_requests x where x.case_id=c.id and x.case_version=c.version order by x.created_at desc,x.id desc limit 1;
  -- Identity acceptance is a distinct fact from phone/locality readiness. A
  -- fast reviewer must not send the owner back to uploading an already accepted
  -- ID merely because the owner has not reached the location screen yet.
  select f.reviewed_at,s.id into reviewed,accepted_submission from private.accepted_identity_facts f
    join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases e on e.id=s.case_id and e.subject_id=actor
    where f.owner_id=actor and f.revoked_at is null and e.status='decided' and e.version=s.case_version+1
    and internal.verification_artifacts_ready(s.id) order by f.reviewed_at desc,f.id limit 1;
  select v.submission_id into current_submission from private.verification_current_submissions v join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version where v.case_id=c.id;
  select i.created_at,f.created_at into id_uploaded,selfie_uploaded from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id join private.evidence_artifacts f on f.id=s.selfie_artifact_id
    where s.id=coalesce(accepted_submission,current_submission);
  perform internal.price_draft_actor();
  return jsonb_build_object('account_id',actor,'case_id',c.id,'case_version',c.version,'reason',r.reason,'decision',r.decision,'identity_reviewed_at',reviewed,
    'id_document_uploaded_at',id_uploaded,'selfie_uploaded_at',selfie_uploaded);
end$$;
revoke all on function internal.get_my_frontend_identity_state() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_identity_state() to authenticated;
create function api.get_my_frontend_identity_state() returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_identity_state()$$;
revoke all on function api.get_my_frontend_identity_state() from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_identity_state() to authenticated;

create function internal.frontend_identity_queue_steps(p_case uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'step_type',case a.purpose when 'id_front' then 'id_doc' else 'selfie' end,
    'created_at',s.created_at,'updated_at',s.created_at,'reviewed_at',null,
    'risk_score',s.risk_score,'risk_level',case when s.risk_score>50 then 'high' else 'low' end,
    'auto_status',case when r.final_result->>'status'='awaiting_second_reviewer' then 'awaiting_second_reviewer' else 'manual_review' end)
    order by case a.purpose when 'id_front' then 0 else 1 end),'[]'::jsonb)
    from private.evidence_cases c join private.verification_current_submissions v on v.case_id=c.id
    join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
    join private.evidence_artifacts a on a.id in(s.id_artifact_id,s.selfie_artifact_id)
    left join private.frontend_identity_step_approvals r on r.submission_id=s.id and r.artifact_id=a.id
      and r.case_version=c.version and r.claim_generation=c.claim_generation and r.reviewer_id=c.claimed_by
      and r.claim_nonce_digest=encode(sha256(convert_to(c.claim_nonce::text,'UTF8')),'hex')
      and c.claim_expires_at>statement_timestamp()
    where c.id=p_case and not(r.matches is true and r.final_result is null);
$$;
revoke all on function internal.frontend_identity_queue_steps(uuid) from public,anon,authenticated,service_role;
create function internal.get_frontend_staff_verification_queue(p_limit integer default 100,p_include_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim');result jsonb;rows jsonb;total bigint;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_include_ids is null or cardinality(p_include_ids)>300 then raise exception 'bounded identity queue required' using errcode='22023';end if;
  with ready as(select c.id,c.subject_id,c.version,c.claim_generation,c.claim_nonce,c.claimed_by,c.claim_expires_at,
      s.id submission_id,s.id_artifact_id,s.selfie_artifact_id,s.created_at,s.risk_score,p.display_name,
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
end$$;
revoke all on function internal.get_frontend_staff_verification_queue(integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;
create function api.get_frontend_staff_verification_queue(p_limit integer default 100,p_include_ids uuid[] default '{}')
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_staff_verification_queue(p_limit,p_include_ids)$$;
revoke all on function api.get_frontend_staff_verification_queue(integer,uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;

-- A retake invalidates every older wizard receipt even after the new ID upload
-- advances the case version. Old selfies must not reappear as completed steps.
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_verification_uploads()'::regprocedure)<>'5dc388290106bceb0f95296b1f53e765' then raise exception 'wizard receipt read drift';end if;
  before:=replace(pg_get_functiondef('internal.get_my_frontend_verification_uploads()'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'v.case_version=c.version','v.case_version>=r.case_version');
  if after=before then raise exception 'retake receipt read anchor missing';end if;execute after;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.reserve_frontend_verification_upload(uuid,text,text,text,text)'::regprocedure)<>'1a91524b8f62e813c0d1cee3c6cd0da7' then raise exception 'wizard reservation drift';end if;
  before:=replace(pg_get_functiondef('internal.reserve_frontend_verification_upload(uuid,text,text,text,text)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'    return jsonb_build_object(''artifact_id'',old.artifact_id,''completed'',old.completed_at is not null);',
    '    if exists(select 1 from private.verification_return_requests v where v.case_id=old.case_id and v.case_version>=old.case_version) then raise exception ''upload belongs to a returned submission; reload verification'' using errcode=''PT409'';end if;
    return jsonb_build_object(''artifact_id'',old.artifact_id,''completed'',old.completed_at is not null);');
  if after=before then raise exception 'retake reservation anchor missing';end if;execute after;
end$$;
notify pgrst,'reload schema';
commit;
