-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_day(p_at timestamp with time zone)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (p_at at time zone 'Africa/Johannesburg')::date;
$function$;
alter function internal.customer_invoice_day(timestamp with time zone) owner to postgres;
revoke all on function internal.customer_invoice_day(timestamp with time zone) from public;
