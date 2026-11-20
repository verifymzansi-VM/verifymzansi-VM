-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_handoff_verification_upload(p_grant_sha256 text, p_request uuid, p_purpose text, p_digest text, p_browser_liveness_passed boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; old private.frontend_verification_uploads; prior uuid;
  version integer; artifact uuid;
begin
  if p_request is null or p_purpose is null or p_purpose not in('id_front','selfie')
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or (p_purpose='selfie')<>(p_browser_liveness_passed is not null) then
    raise exception 'upload request required' using errcode='22023'; end if;
  h:=internal.capture_handoff_by_grant(p_grant_sha256);
  select * into old from private.frontend_verification_uploads where owner_id=h.owner_id and request_id=p_request;
  if found then
    if old.request_digest<>p_digest or old.purpose<>p_purpose or old.case_id<>h.case_id
      or old.expires_at<=clock_timestamp() then
      raise exception 'upload request changed or expired' using errcode='PT409'; end if;
    if exists(select 1 from private.verification_return_requests v where v.case_id=old.case_id and v.case_version>=old.case_version) then
      raise exception 'upload belongs to a returned submission; reload verification' using errcode='PT409'; end if;
    return jsonb_build_object('artifact_id',old.artifact_id,'completed',old.completed_at is not null,
      'identity',case when old.purpose='id_front' and old.completed_at is null then
        jsonb_build_object('fingerprint',h.fingerprint,'encrypted_number',h.encrypted_number) end);
  end if;
  if p_purpose='id_front' and h.fingerprint is null then
    raise exception 'ID details required' using errcode='PT409',detail='handoff_needs_id'; end if;
  perform c.id from private.evidence_cases c where c.id=h.case_id and c.subject_id=h.owner_id
    and c.kind='kyc' and c.status='open' for update;
  if p_purpose='selfie' then
    prior:=internal.capture_handoff_prior_id(h.owner_id,h.case_id);
    if prior is null then raise exception 'upload the ID document first' using errcode='PT409'; end if;
  end if;
  if (select count(*) from private.evidence_artifacts a where a.case_id=h.case_id and a.state='intent')>=5 then
    raise exception 'too many unfinished uploads' using errcode='PT429'; end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(h.case_id,h.owner_id,p_purpose,'evidence/'||h.case_id||'/'||pg_catalog.gen_random_uuid())
    returning id into artifact;
  select c.version into version from private.evidence_cases c where c.id=h.case_id;
  insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,
      request_digest,artifact_id,id_request,capture_method,browser_liveness_passed)
    values(h.owner_id,p_request,h.session_id,h.case_id,version,p_purpose,p_digest,artifact,prior,
      case when p_purpose='selfie' then 'camera' end,p_browser_liveness_passed);
  return jsonb_build_object('artifact_id',artifact,'completed',false,
    'identity',case when p_purpose='id_front' then
      jsonb_build_object('fingerprint',h.fingerprint,'encrypted_number',h.encrypted_number) end);
end;
$function$;
alter function internal.reserve_handoff_verification_upload(text,uuid,text,text,boolean) owner to postgres;
revoke all on function internal.reserve_handoff_verification_upload(text,uuid,text,text,boolean) from public;
grant execute on function internal.reserve_handoff_verification_upload(text,uuid,text,text,boolean) to service_role;
