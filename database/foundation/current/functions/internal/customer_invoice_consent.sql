-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_consent()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('version', 'invoice-cooling-off-v1',
    'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately.');
$function$;
alter function internal.customer_invoice_consent() owner to postgres;
revoke all on function internal.customer_invoice_consent() from public;
