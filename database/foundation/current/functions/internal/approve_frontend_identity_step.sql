-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.approve_frontend_identity_step(p_case uuid, p_submission uuid, p_artifact uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_matches boolean, p_note text DEFAULT NULL::text, p_override_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) owner to postgres;
revoke all on function internal.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) from public;
grant execute on function internal.approve_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,boolean,text,text) to authenticated;
