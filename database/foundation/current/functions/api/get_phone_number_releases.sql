-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_phone_number_releases()$function$;
alter function api.get_phone_number_releases() owner to postgres;
revoke all on function api.get_phone_number_releases() from public;
grant execute on function api.get_phone_number_releases() to authenticated;
