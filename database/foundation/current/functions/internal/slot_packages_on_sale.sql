-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_packages_on_sale()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select s.on_sale from private.slot_package_sales s where s.singleton), false);
$function$;
alter function internal.slot_packages_on_sale() owner to postgres;
revoke all on function internal.slot_packages_on_sale() from public;
