-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_attempt_live(p private.payments)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (p.status = 'pending' and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp()))
    or (p.status = 'failed' and p.checkout_expires_at > pg_catalog.clock_timestamp());
$function$;
alter function internal.customer_invoice_attempt_live(private.payments) owner to postgres;
revoke all on function internal.customer_invoice_attempt_live(private.payments) from public;
