-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_identity_review_context(p_case uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view'); subject uuid; c private.evidence_cases;
  s private.verification_identity_submissions;
begin
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  actor:=internal.staff_actor('evidence:view');
  select e.* into c from private.evidence_cases e where e.id=p_case;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v
    on v.submission_id=x.id and v.case_id=c.id;
  if not found or s.case_version<>c.version or not internal.verification_artifacts_ready(s.id) then
    raise exception 'current submission unavailable' using errcode='PT409'; end if;
  insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
    values(actor,c.id,'routine_review',c.version,c.claim_generation,array[s.id_artifact_id,s.selfie_artifact_id]);
  actor:=internal.staff_actor('evidence:view');
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'submission_id',s.id,'risk_score',s.risk_score,
    'recipe',s.recipe,'id_artifact_id',s.id_artifact_id,'selfie_artifact_id',s.selfie_artifact_id);
end;
$function$;
alter function internal.staff_identity_review_context(uuid,text,uuid) owner to postgres;
revoke all on function internal.staff_identity_review_context(uuid,text,uuid) from public;
grant execute on function internal.staff_identity_review_context(uuid,text,uuid) to authenticated;
