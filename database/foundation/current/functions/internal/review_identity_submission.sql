-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.review_identity_submission(p_submission uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_number_matches boolean, p_selfie_matches boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); s private.verification_identity_submissions;
  c private.evidence_cases; fact uuid; proposal jsonb;
begin
  if p_number_matches is distinct from true or p_selfie_matches is distinct from true or p_expected_version is null then
    raise exception 'exact number/document and selfie attestations required' using errcode='22023'; end if;
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(s.owner_id);
  actor:=internal.staff_actor('verification:decide_routine');
  if not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'active identity subject required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  select f.id into fact from private.accepted_identity_facts f where f.submission_id=s.id and f.revoked_at is null
    and f.reviewed_by=actor and f.second_reviewer is null and s.case_version=p_expected_version;
  if found and c.status='decided' and c.version=s.case_version+1 and internal.verification_artifacts_ready(s.id) then
    return jsonb_build_object('status','accepted','identity_fact_id',fact,'reused',true); end if;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.kind<>'kyc' or c.version<>p_expected_version or s.case_version<>c.version
    or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if s.risk_score>50 then
    proposal:=internal.propose_decision(c.id,c.version,'approve_override',jsonb_build_object('identity_submission_id',s.id));
    insert into private.identity_review_proposals(decision_id,submission_id,reviewer_session)
      values((proposal->>'decision_id')::uuid,s.id,(auth.jwt()->>'session_id')::uuid);
    return jsonb_build_object('status','awaiting_second_reviewer','decision_id',proposal->>'decision_id');
  end if;
  fact:=internal.accept_identity_submission(s.id,actor,null,null,p_claim_generation,p_claim_nonce);
  update private.evidence_cases set status='decided',version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id and version<2147483647;
  if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  return jsonb_build_object('status','accepted','identity_fact_id',fact);
end;
$function$;
alter function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) owner to postgres;
revoke all on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) from public;
grant execute on function internal.review_identity_submission(uuid,integer,text,uuid,boolean,boolean) to authenticated;
