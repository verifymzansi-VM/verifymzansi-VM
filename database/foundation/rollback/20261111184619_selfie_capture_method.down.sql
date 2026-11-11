-- Reviewed rollback for updates/20261111184619_selfie_capture_method.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert the website release that
-- uses the update first: this rollback removes the staff read
-- api.get_frontend_staff_selfie_capture and the two optional arguments of
-- api.complete_frontend_verification_upload that the release calls. It
-- restores the seven-argument upload completion byte for byte (same grants:
-- service role only) and drops the capture_method and browser_liveness_passed
-- columns, with every answer recorded so far. Upload receipts and evidence are
-- otherwise unchanged.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)') is null
    or to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)') is null
    or to_regprocedure('internal.get_frontend_staff_selfie_capture(uuid,text,uuid)') is null
    or to_regprocedure('api.get_frontend_staff_selfie_capture(uuid,text,uuid)') is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)')) is distinct from 'edd196d8ef77532f8f07fd4a02ca9c4f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean)')) is distinct from '4a17f8bbad56ecd3191a72d45287511e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_frontend_staff_selfie_capture(uuid,text,uuid)')) is distinct from '409db62cee2182fa6151df48406dc394'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_frontend_staff_selfie_capture(uuid,text,uuid)')) is distinct from '774a7b78891fffc1758eb1ce34728c17'
    or to_regprocedure('internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)') is not null
    or to_regprocedure('api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer)') is not null then
    raise exception 'rollback precondition: the selfie capture method update is not applied' using errcode='55000';
  end if;
end$$;

drop function api.get_frontend_staff_selfie_capture(uuid,text,uuid);
drop function internal.get_frontend_staff_selfie_capture(uuid,text,uuid);
drop function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean);
drop function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer,text,boolean);
alter table private.frontend_verification_uploads
  drop constraint frontend_verification_uploads_capture_report_check,
  drop constraint frontend_verification_uploads_capture_method_check,
  drop column browser_liveness_passed,
  drop column capture_method;

-- The functions as they were before the update.
CREATE OR REPLACE FUNCTION internal.complete_frontend_verification_upload(p_owner uuid, p_request uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer, p_identity jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare ctx jsonb; r private.frontend_verification_uploads; id private.frontend_verification_uploads; done jsonb; submitted jsonb;
begin
  ctx:=internal.frontend_verification_upload_context(p_owner,p_request);
  if (ctx->>'completed')::boolean then return ctx; end if;
  select * into r from private.frontend_verification_uploads where owner_id=p_owner and request_id=p_request;
  if r.purpose='id_front' then
    if p_identity is null or jsonb_typeof(p_identity)<>'object' or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or jsonb_typeof(p_identity->'fingerprint') is distinct from 'string'
      or p_identity->>'fingerprint' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      or jsonb_typeof(p_identity->'encrypted_number') is distinct from 'object'
      or (p_identity->'encrypted_number')-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
      or not(p_identity->'encrypted_number' ?& array['ciphertext','iv','tag','key_id'])
      or jsonb_typeof(p_identity->'encrypted_number'->'ciphertext') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'iv') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'tag') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'key_id') is distinct from 'string'
      or p_identity->'encrypted_number'->>'ciphertext' !~ '^[a-f0-9]{26}$'
      or p_identity->'encrypted_number'->>'iv' !~ '^[a-f0-9]{24}$'
      or p_identity->'encrypted_number'->>'tag' !~ '^[a-f0-9]{32}$'
      or p_identity->'encrypted_number'->>'key_id' is distinct from 'identity-number-v1' then
      raise exception 'encrypted identity receipt required' using errcode='22023'; end if;
  elsif p_identity is not null or p_risk_score is null or p_risk_score not between 0 and 100 then
    raise exception 'server assessment required' using errcode='22023';
  end if;
  done:=internal.complete_evidence_upload(r.artifact_id,p_stored_sha256,p_content_sha256,p_size);
  if r.purpose='selfie' then
    select * into id from private.frontend_verification_uploads where owner_id=p_owner and request_id=r.id_request;
    submitted:=internal.register_identity_submission(r.case_id,(done->>'case_version')::integer,id.artifact_id,r.artifact_id,
      id.fingerprint,'identity-match-v1',id.encrypted_number,r.request_id,p_risk_score);
    update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null
      where owner_id=p_owner and request_id=r.id_request;
  end if;
  update private.frontend_verification_uploads set completed_at=clock_timestamp(),
    fingerprint=case when r.purpose='id_front' then p_identity->>'fingerprint' end,
    encrypted_number=case when r.purpose='id_front' then p_identity->'encrypted_number' end,
    submission_id=(submitted->>'submission_id')::uuid where owner_id=p_owner and request_id=p_request;
  -- Session revocation during an in-flight object write must prevent submission.
  if not exists(select 1 from auth.sessions s where s.id=r.session_id and s.user_id=p_owner
    and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'upload session expired' using errcode='42501'; end if;
  return jsonb_build_object('completed',true,'artifact_id',r.artifact_id,'purpose',r.purpose);
end$function$;
alter function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) owner to postgres;
revoke all on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) to service_role;

CREATE OR REPLACE FUNCTION api.complete_frontend_verification_upload(p_owner uuid, p_request uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer, p_identity jsonb DEFAULT NULL::jsonb, p_risk_score integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
 select internal.complete_frontend_verification_upload(p_owner,p_request,p_stored_sha256,p_content_sha256,p_size,p_identity,p_risk_score);
$function$;
alter function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) owner to postgres;
revoke all on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_verification_upload(uuid,uuid,text,text,integer,jsonb,integer) to service_role;
commit;
