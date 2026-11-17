-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_list_partners()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_list_partners();
$function$;
alter function api.staff_list_partners() owner to postgres;
revoke all on function api.staff_list_partners() from public;
grant execute on function api.staff_list_partners() to authenticated;
