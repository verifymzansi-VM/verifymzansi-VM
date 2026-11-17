-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_invoice_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('merchant_invoice',internal.payment_invoice_config());
  return new;
end;
$function$;
alter function internal.payment_invoice_snapshot() owner to postgres;
revoke all on function internal.payment_invoice_snapshot() from public;
