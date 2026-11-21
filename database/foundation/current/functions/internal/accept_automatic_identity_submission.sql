-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.accept_automatic_identity_submission(p_check uuid, p_submission uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.verification_identity_submissions; fact uuid;
begin
  select x.* into s from private.verification_identity_submissions x where x.id=p_submission;
  if not found or not exists(select 1 from private.evidence_cases c
      join private.verification_current_submissions v on v.case_id=c.id and v.submission_id=s.id
      where c.id=s.case_id and c.status='open' and c.version=s.case_version)
    or not internal.verification_artifacts_ready(s.id) then
    raise exception 'reviewed submission changed' using errcode='PT409'; end if;
  insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,automatic_check_id)
    values(s.owner_id,s.id,s.identity_hmac,null,p_check) returning id into fact;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('identity_accepted',fact,s.owner_id,'identity_accepted:'||fact);
  update private.evidence_cases set status='decided',version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null
    where id=s.case_id and version<2147483647;
  if not found then raise exception 'case revision exhausted' using errcode='22023'; end if;
  return fact;
end$function$;
alter function internal.accept_automatic_identity_submission(uuid,uuid) owner to postgres;
revoke all on function internal.accept_automatic_identity_submission(uuid,uuid) from public;
