-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_expires_after()
 RETURNS interval
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select interval '14 days';
$function$;
alter function internal.invoice_transfer_expires_after() owner to postgres;
revoke all on function internal.invoice_transfer_expires_after() from public;
