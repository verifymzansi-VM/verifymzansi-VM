-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.export_frontend_privacy_request(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.export_frontend_privacy_request(p_case,p_revision)$function$;
alter function api.export_frontend_privacy_request(uuid,integer) owner to postgres;
revoke all on function api.export_frontend_privacy_request(uuid,integer) from public;
grant execute on function api.export_frontend_privacy_request(uuid,integer) to authenticated;
