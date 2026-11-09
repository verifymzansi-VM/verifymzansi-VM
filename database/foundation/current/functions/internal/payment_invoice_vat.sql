-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_invoice_vat(p private.payments)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare cfg jsonb:=coalesce(p.snapshot->'merchant_invoice',internal.payment_invoice_config()); rate integer;
begin
  rate:=(cfg->>'vat_rate_bps')::integer;
  if rate is null or rate not between 0 and 10000 or cfg->>'registration_status' not in ('not_registered','registered') then
    raise exception 'invalid invoice configuration' using errcode='PT503'; end if;
  return round(p.amount_cents::numeric*rate/(10000+rate))::bigint;
end;
$function$;
alter function internal.payment_invoice_vat(private.payments) owner to postgres;
revoke all on function internal.payment_invoice_vat(private.payments) from public;
