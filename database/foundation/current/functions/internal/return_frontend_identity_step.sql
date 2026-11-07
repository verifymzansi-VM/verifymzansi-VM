-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.return_frontend_identity_step(p_case uuid, p_submission uuid, p_artifact uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_decision text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) owner to postgres;
revoke all on function internal.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) from public;
grant execute on function internal.return_frontend_identity_step(uuid,uuid,uuid,integer,text,uuid,text,text) to authenticated;
