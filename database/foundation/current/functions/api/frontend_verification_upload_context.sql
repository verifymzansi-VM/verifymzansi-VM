-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.frontend_verification_upload_context(p_owner uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.frontend_verification_upload_context(p_owner,p_request)$function$;
alter function api.frontend_verification_upload_context(uuid,uuid) owner to postgres;
revoke all on function api.frontend_verification_upload_context(uuid,uuid) from public;
grant execute on function api.frontend_verification_upload_context(uuid,uuid) to service_role;
