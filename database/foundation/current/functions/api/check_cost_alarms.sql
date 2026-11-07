-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.check_cost_alarms()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.check_cost_alarms();
$function$;
alter function api.check_cost_alarms() owner to postgres;
revoke all on function api.check_cost_alarms() from public;
grant execute on function api.check_cost_alarms() to service_role;
