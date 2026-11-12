-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_selfie_capture(p_case_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view'); c private.evidence_cases;
  s private.verification_identity_submissions; r private.frontend_verification_uploads;
begin
  if p_case_id is null then raise exception 'case unavailable' using errcode='22023'; end if;
  select e.* into c from private.evidence_cases e where e.id=p_case_id;
  if not found or c.kind<>'kyc' or c.status<>'open' then raise exception 'case unavailable' using errcode='22023'; end if;
  -- The caller holds this case now, under a live claim, and it is not theirs.
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  select x.* into s from private.verification_identity_submissions x join private.verification_current_submissions v
    on v.submission_id=x.id and v.case_id=c.id;
  if not found or s.case_version<>c.version or s.owner_id<>c.subject_id then
    raise exception 'current submission unavailable' using errcode='PT409'; end if;
  -- The selfie's upload receipt, when the website recorded one; null fields
  -- mean "not recorded".
  select u.* into r from private.frontend_verification_uploads u
    where u.owner_id=c.subject_id and u.case_id=c.id and u.submission_id=s.id and u.purpose='selfie'
      and u.artifact_id=s.selfie_artifact_id and u.completed_at is not null;
  return jsonb_build_object('case_id',c.id,'case_version',c.version,'submission_id',s.id,
    'selfie_artifact_id',s.selfie_artifact_id,'capture_method',r.capture_method,
    'browser_liveness_passed',r.browser_liveness_passed);
end$function$;
alter function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) from public;
grant execute on function internal.get_frontend_staff_selfie_capture(uuid,text,uuid) to authenticated;
