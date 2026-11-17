-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_invoice_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare cfg private.invoice_merchant_config;
begin
  select * into cfg from private.invoice_merchant_config where singleton;
  if not found or cfg.registration_status='undecided' or cfg.confirmed_at is null then
    raise exception 'merchant invoice configuration requires confirmation' using errcode='PT503'; end if;
  return jsonb_build_object('registration_status',cfg.registration_status,'vat_number',cfg.vat_number,'vat_rate_bps',cfg.vat_rate_bps);
end;
$function$;
alter function internal.payment_invoice_config() owner to postgres;
revoke all on function internal.payment_invoice_config() from public;
