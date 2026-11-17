-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_identity_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    and internal.verification_evidence_reviewed(s.id) order by f.reviewed_at desc,f.id limit 1;
  select v.submission_id into current_submission from private.verification_current_submissions v join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version where v.case_id=c.id;
  select i.created_at,f.created_at into id_uploaded,selfie_uploaded from private.verification_identity_submissions s
    join private.evidence_artifacts i on i.id=s.id_artifact_id join private.evidence_artifacts f on f.id=s.selfie_artifact_id
    where s.id=coalesce(accepted_submission,current_submission);
  perform internal.price_draft_actor();
  return jsonb_build_object('account_id',actor,'case_id',c.id,'case_version',c.version,'reason',r.reason,'decision',r.decision,'identity_reviewed_at',reviewed,
    'id_document_uploaded_at',id_uploaded,'selfie_uploaded_at',selfie_uploaded);
end$function$;
alter function internal.get_my_frontend_identity_state() owner to postgres;
revoke all on function internal.get_my_frontend_identity_state() from public;
grant execute on function internal.get_my_frontend_identity_state() to authenticated;
