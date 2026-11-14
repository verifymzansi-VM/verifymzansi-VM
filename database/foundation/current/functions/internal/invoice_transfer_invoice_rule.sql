-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_invoice_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  if new.customer_invoice_id is null then return new; end if;
  select * into inv from private.customer_invoices i where i.id = new.customer_invoice_id;
  if not found or inv.status <> 'issued' or inv.account_id <> new.account_id
      or inv.plan_version_id <> new.plan_version_id or inv.slots <> new.slots
      or inv.total_cents <> new.amount_received_cents then
    raise exception 'a bank transfer to an invoice is that issued invoice''s order' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.invoice_transfer_invoice_rule() owner to postgres;
revoke all on function internal.invoice_transfer_invoice_rule() from public;
