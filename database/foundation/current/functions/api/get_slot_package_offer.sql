-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_slot_package_offer()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_slot_package_offer();
$function$;
alter function api.get_slot_package_offer() owner to postgres;
revoke all on function api.get_slot_package_offer() from public;
grant execute on function api.get_slot_package_offer() to service_role;
