-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; inv private.customer_invoices; reference text;
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
    raise exception 'invoice payment attempts are never removed' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'invoice payment attempts never change' using errcode='23514';
  end if;
  select * into pay from private.payments p where p.id = new.payment_id;
  select * into inv from private.customer_invoices i where i.id = new.invoice_id;
  reference := inv.invoice_number;
  if new.attempt > 1 then reference := reference || '-' || new.attempt::text; end if;
  if pay.status <> 'pending' or pay.provider <> 'ozow' or pay.product_kind <> 'plan'
      or pay.owner_id <> inv.account_id or pay.amount_cents <> inv.total_cents
      or pay.plan_version_id <> inv.plan_version_id or inv.status <> 'issued'
      or pay.merchant_reference is distinct from reference
      or pay.snapshot->>'customer_invoice_id' is distinct from inv.id::text
      or (select count(*) from private.payment_lines l where l.payment_id = pay.id
        and l.amount_cents = inv.unit_price_cents) <> inv.slots
      or new.attempt <> 1 + (select count(*) from private.customer_invoice_payments x where x.invoice_id = inv.id) then
    raise exception 'an invoice payment attempt is a new Ozow payment of that invoice' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_payment_guard() owner to postgres;
revoke all on function internal.customer_invoice_payment_guard() from public;
