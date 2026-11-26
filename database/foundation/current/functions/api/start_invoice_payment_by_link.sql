-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.start_invoice_payment_by_link(p_token_hash text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_invoice_payment(null, p_expected_total_cents, p_cooling_off_consent, coalesce(p_token_hash, ''));
$function$;
alter function api.start_invoice_payment_by_link(text,bigint,boolean) owner to postgres;
revoke all on function api.start_invoice_payment_by_link(text,bigint,boolean) from public;
grant execute on function api.start_invoice_payment_by_link(text,bigint,boolean) to service_role;
