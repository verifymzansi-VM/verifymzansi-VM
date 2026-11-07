-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.assess_identity_upload(p_owner uuid, p_fingerprint text, p_document_sha256 text, p_selfie_sha256 text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$ select internal.assess_identity_upload(p_owner,p_fingerprint,p_document_sha256,p_selfie_sha256); $function$;
alter function api.assess_identity_upload(uuid,text,text,text) owner to postgres;
revoke all on function api.assess_identity_upload(uuid,text,text,text) from public;
grant execute on function api.assess_identity_upload(uuid,text,text,text) to service_role;
