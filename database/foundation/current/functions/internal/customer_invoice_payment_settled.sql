-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_payment_settled()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  select i.* into inv from private.customer_invoice_payments l
    join private.customer_invoices i on i.id = l.invoice_id
    where l.payment_id = new.id for update of i;
  if not found then return null; end if;
  if inv.status = 'issued' then
    update private.customer_invoices set status = 'paid', payment_id = new.id, paid_at = new.completed_at
      where id = inv.id;
  end if;
  return null;
end;
$function$;
alter function internal.customer_invoice_payment_settled() owner to postgres;
revoke all on function internal.customer_invoice_payment_settled() from public;
