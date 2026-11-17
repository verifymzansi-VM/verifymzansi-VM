-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.read_frontend_feature_config()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.read_frontend_feature_config()$function$;
alter function api.read_frontend_feature_config() owner to postgres;
revoke all on function api.read_frontend_feature_config() from public;
grant execute on function api.read_frontend_feature_config() to service_role;
