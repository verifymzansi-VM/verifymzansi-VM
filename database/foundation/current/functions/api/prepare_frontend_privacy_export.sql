-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.prepare_frontend_privacy_export(p_case uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.prepare_frontend_privacy_export(p_case,p_revision)$function$;
alter function api.prepare_frontend_privacy_export(uuid,integer) owner to postgres;
revoke all on function api.prepare_frontend_privacy_export(uuid,integer) from public;
grant execute on function api.prepare_frontend_privacy_export(uuid,integer) to authenticated;
