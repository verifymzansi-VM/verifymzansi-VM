-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_verification_upload_context(p_owner uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r private.frontend_verification_uploads; id private.frontend_verification_uploads; a private.evidence_artifacts;
begin
  perform internal.lock_verification_subject(p_owner);
  select * into r from private.frontend_verification_uploads where owner_id=p_owner and request_id=p_request;
  if not found or not exists(select 1 from private.current_account_access x where x.id=p_owner) then
    raise exception 'upload unavailable' using errcode='42501'; end if;
  select e.* into a from private.evidence_artifacts e where e.id=r.artifact_id and e.owner_id=p_owner and e.case_id=r.case_id;
  if a.id is null or a.state not in('intent','clean') or (a.retain_until is not null and a.retain_until<=clock_timestamp()) then
    raise exception 'artifact unavailable' using errcode='PT409'; end if;
  if r.completed_at is not null then
    return jsonb_build_object('completed',true,'artifact_id',r.artifact_id,'purpose',r.purpose);
  end if;
  if r.expires_at<=clock_timestamp() or not exists(select 1 from auth.sessions s where s.id=r.session_id
    and s.user_id=p_owner and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'upload session expired' using errcode='42501'; end if;
  if not exists(select 1 from private.evidence_cases c where c.id=r.case_id and c.subject_id=p_owner and c.status='open' and c.version=r.case_version) then
    raise exception 'identity case changed' using errcode='PT409'; end if;
  if r.purpose='selfie' then
    select * into id from private.frontend_verification_uploads where owner_id=p_owner and request_id=r.id_request;
    if id.completed_at is null or id.expires_at<=clock_timestamp() or id.fingerprint is null
      or not exists(select 1 from private.evidence_artifacts e where e.id=id.artifact_id and e.state='clean') then
      raise exception 'ID upload changed' using errcode='PT409'; end if;
  end if;
  return jsonb_build_object('completed',false,'artifact_id',r.artifact_id,'purpose',r.purpose,'case_id',r.case_id,
    'object_key',a.object_key,'fingerprint',id.fingerprint,'document_sha256',
    (select e.content_sha256 from private.evidence_artifacts e where e.id=id.artifact_id));
end$function$;
alter function internal.frontend_verification_upload_context(uuid,uuid) owner to postgres;
revoke all on function internal.frontend_verification_upload_context(uuid,uuid) from public;
grant execute on function internal.frontend_verification_upload_context(uuid,uuid) to service_role;
