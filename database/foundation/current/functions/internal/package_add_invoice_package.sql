-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_add_invoice_package(p_invoice_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select r.package_id from private.package_invoice_requests r where r.invoice_id = p_invoice_id and r.kind = 'add';
$function$;
alter function internal.package_add_invoice_package(uuid) owner to postgres;
revoke all on function internal.package_add_invoice_package(uuid) from public;
