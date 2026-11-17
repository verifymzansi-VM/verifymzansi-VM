-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.accept_identity_submission(p_submission uuid, p_reviewer uuid, p_second uuid, p_decision uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.verification_identity_submissions; c private.evidence_cases; fact uuid; actor uuid;
begin
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found then raise exception 'submission unavailable' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.identity_hmac,2701));
  actor:=internal.staff_actor(case when p_second is null then 'verification:decide_routine' else 'decision:approve' end);
  if exists(select 1 from private.banned_identities b where b.identity_hmac=s.identity_hmac and b.retain_until>clock_timestamp()) then
    raise exception 'identity cannot be accepted' using errcode='42501'; end if;
  if actor is distinct from coalesce(p_second,p_reviewer) or s.owner_id in(p_reviewer,p_second)
    or not exists(select 1 from private.current_account_access a where a.id=s.owner_id) then
    raise exception 'independent current review required' using errcode='42501'; end if;
  if p_second is not null and not exists(
    select 1 from private.identity_review_proposals r join private.decisions d on d.id=r.decision_id
    join auth.sessions session on session.id=r.reviewer_session and session.user_id=p_reviewer
    join private.staff_roles role on role.user_id=p_reviewer and role.revoked_at is null
    join private.staff_capabilities capability on capability.role=role.role and capability.capability='verification:decide_routine'
    where r.decision_id=p_decision and r.submission_id=s.id and d.status='approved' and d.proposed_by=p_reviewer
      and d.approved_by=p_second and d.case_id=s.case_id and d.case_version=s.case_version
      and r.reviewed_at+interval '15 minutes'>clock_timestamp() and session.aal='aal2'
      and (session.not_after is null or session.not_after>clock_timestamp())
      and exists(select 1 from private.current_account_access a where a.id=p_reviewer)) then
    raise exception 'current independent first review required' using errcode='42501'; end if;
  select e.* into c from private.evidence_cases e where e.id=s.case_id;
  if c.status<>'open' or c.version<>s.case_version or not internal.verification_artifacts_ready(s.id)
    or not exists(select 1 from private.verification_current_submissions v where v.case_id=c.id and v.submission_id=s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  if p_second is null then perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce); end if;
  if exists(select 1 from private.accepted_identity_facts f where f.identity_hmac=s.identity_hmac and f.revoked_at is null) then
    raise exception 'identity already accepted' using errcode='PT409'; end if;
  insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,second_reviewer,decision_id)
    values(s.owner_id,s.id,s.identity_hmac,p_reviewer,p_second,p_decision) returning id into fact;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('identity_accepted',fact,s.owner_id,'identity_accepted:'||fact);
  return fact;
end;
$function$;
alter function internal.accept_identity_submission(uuid,uuid,uuid,uuid,text,uuid) owner to postgres;
revoke all on function internal.accept_identity_submission(uuid,uuid,uuid,uuid,text,uuid) from public;
