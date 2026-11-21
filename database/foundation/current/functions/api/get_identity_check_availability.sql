-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_identity_check_availability()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_identity_check_availability();
$function$;
alter function api.get_identity_check_availability() owner to postgres;
revoke all on function api.get_identity_check_availability() from public;
grant execute on function api.get_identity_check_availability() to authenticated;
