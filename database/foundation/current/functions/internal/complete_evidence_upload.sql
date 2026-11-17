-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_evidence_upload(p_artifact uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare completed jsonb;
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'content receipt required' using errcode='22023'; end if;
  perform internal.advance_evidence_artifact(p_artifact,'uploaded',p_stored_sha256,p_size);
  update private.evidence_artifacts set content_sha256=p_content_sha256 where id=p_artifact and (content_sha256 is null or content_sha256=p_content_sha256);
  if not found then raise exception 'content receipt changed' using errcode='PT409'; end if;
  completed:=internal.advance_evidence_artifact(p_artifact,'clean',p_stored_sha256,p_size);
  -- The artifact transitions increment the case revision. Return the revision
  -- while their subject/case locks are still held; never reuse the pre-upload one.
  return completed||jsonb_build_object('case_version',(
    select c.version from private.evidence_cases c join private.evidence_artifacts a on a.case_id=c.id
    where a.id=p_artifact));
end;
$function$;
alter function internal.complete_evidence_upload(uuid,text,text,integer) owner to postgres;
revoke all on function internal.complete_evidence_upload(uuid,text,text,integer) from public;
grant execute on function internal.complete_evidence_upload(uuid,text,text,integer) to service_role;
