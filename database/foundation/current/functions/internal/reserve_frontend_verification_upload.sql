-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_verification_upload(p_request uuid, p_purpose text, p_digest text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); old private.frontend_verification_uploads;
  opened jsonb; reserved jsonb; prior uuid; profile private.profiles; version integer;
begin
  if p_request is null or p_purpose is null or p_purpose not in('id_front','selfie')
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'upload request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  perform internal.price_draft_actor();
  select * into old from private.frontend_verification_uploads where owner_id=actor and request_id=p_request;
  if found then
    if old.request_digest<>p_digest or old.purpose<>p_purpose or old.expires_at<=clock_timestamp() then
      raise exception 'upload request changed or expired' using errcode='PT409'; end if;
    if exists(select 1 from private.verification_return_requests v where v.case_id=old.case_id and v.case_version>=old.case_version) then raise exception 'upload belongs to a returned submission; reload verification' using errcode='PT409';end if;
    return jsonb_build_object('artifact_id',old.artifact_id,'completed',old.completed_at is not null);
  end if;
  if p_purpose='id_front' then
    select * into profile from private.profiles where account_id=actor for update;
    if (profile.legal_first_name,profile.legal_last_name) is distinct from (p_first_name,p_last_name) then
      perform internal.save_my_legal_name(profile.revision,p_first_name,p_last_name);
    end if;
  elsif p_first_name is not null or p_last_name is not null then
    raise exception 'unexpected names' using errcode='22023';
  end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  if p_purpose='selfie' then
    select r.request_id into prior from private.frontend_verification_uploads r
      join private.evidence_artifacts a on a.id=r.artifact_id and a.owner_id=r.owner_id and a.case_id=r.case_id
      where r.owner_id=actor and r.case_id=(opened->>'case_id')::uuid and r.purpose='id_front'
      and r.completed_at is not null and r.expires_at>clock_timestamp() and r.fingerprint is not null
      and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp())
      order by r.created_at desc,r.request_id limit 1;
    if prior is null then raise exception 'upload the ID document first' using errcode='PT409'; end if;
  end if;
  reserved:=internal.begin_evidence_upload((opened->>'case_id')::uuid,p_purpose);
  select c.version into version from private.evidence_cases c where c.id=(opened->>'case_id')::uuid;
  insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,request_digest,artifact_id,id_request)
    values(actor,p_request,(auth.jwt()->>'session_id')::uuid,(opened->>'case_id')::uuid,version,p_purpose,p_digest,
      (reserved->>'artifact_id')::uuid,prior);
  perform internal.price_draft_actor();
  return jsonb_build_object('artifact_id',(reserved->>'artifact_id')::uuid,'completed',false);
end$function$;
alter function internal.reserve_frontend_verification_upload(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.reserve_frontend_verification_upload(uuid,text,text,text,text) from public;
grant execute on function internal.reserve_frontend_verification_upload(uuid,text,text,text,text) to authenticated;
