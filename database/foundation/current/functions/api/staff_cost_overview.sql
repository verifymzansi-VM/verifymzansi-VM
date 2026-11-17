-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_cost_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_cost_overview();
$function$;
alter function api.staff_cost_overview() owner to postgres;
revoke all on function api.staff_cost_overview() from public;
grant execute on function api.staff_cost_overview() to authenticated;
