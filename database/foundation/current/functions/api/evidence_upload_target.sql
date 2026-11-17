-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.evidence_upload_target(p_owner uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.evidence_upload_target(p_owner,p_artifact); $function$;
alter function api.evidence_upload_target(uuid,uuid) owner to postgres;
revoke all on function api.evidence_upload_target(uuid,uuid) from public;
grant execute on function api.evidence_upload_target(uuid,uuid) to service_role;
