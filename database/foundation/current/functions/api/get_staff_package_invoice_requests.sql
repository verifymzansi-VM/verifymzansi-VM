-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_staff_package_invoice_requests()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_package_invoice_requests();
$function$;
alter function api.get_staff_package_invoice_requests() owner to postgres;
revoke all on function api.get_staff_package_invoice_requests() from public;
grant execute on function api.get_staff_package_invoice_requests() to authenticated;
