-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_staff_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_dashboard_overview();
$function$;
alter function api.get_staff_dashboard() owner to postgres;
revoke all on function api.get_staff_dashboard() from public;
grant execute on function api.get_staff_dashboard() to authenticated;
