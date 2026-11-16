-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_plan(p_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_code in ('slot_package_30d','slot_package_90d','slot_package_180d'), false);
$function$;
alter function internal.slot_package_plan(text) owner to postgres;
revoke all on function internal.slot_package_plan(text) from public;
