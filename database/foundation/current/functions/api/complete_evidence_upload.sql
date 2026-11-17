-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_evidence_upload(p_artifact uuid, p_stored_sha256 text, p_content_sha256 text, p_size integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.complete_evidence_upload(p_artifact,p_stored_sha256,p_content_sha256,p_size); $function$;
alter function api.complete_evidence_upload(uuid,text,text,integer) owner to postgres;
revoke all on function api.complete_evidence_upload(uuid,text,text,integer) from public;
grant execute on function api.complete_evidence_upload(uuid,text,text,integer) to service_role;
