-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.frontend_seen_file_object(p_case uuid, p_artifact uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$select internal.frontend_seen_file_object(p_case,p_artifact)$function$;
alter function api.frontend_seen_file_object(uuid,uuid) owner to postgres;
revoke all on function api.frontend_seen_file_object(uuid,uuid) from public;
grant execute on function api.frontend_seen_file_object(uuid,uuid) to service_role;
