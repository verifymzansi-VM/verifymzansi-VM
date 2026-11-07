-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_merchant_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare cfg jsonb;
begin
  select coalesce(p.snapshot->'merchant_invoice',internal.payment_invoice_config()) into cfg from private.payments p where p.id=new.payment_id;
  new.merchant_registration_status:=cfg->>'registration_status';
  new.merchant_vat_number:=cfg->>'vat_number';
  new.vat_rate_bps:=(cfg->>'vat_rate_bps')::integer;
  return new;
end;
$function$;
alter function internal.invoice_merchant_snapshot() owner to postgres;
revoke all on function internal.invoice_merchant_snapshot() from public;
