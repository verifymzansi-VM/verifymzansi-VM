-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_settled_elsewhere(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.customer_invoice_payments l
    join private.customer_invoices i on i.id = l.invoice_id
    where l.payment_id = p_payment_id
      and (i.status = 'void' or (i.status = 'paid' and i.payment_id is distinct from p_payment_id)));
$function$;
alter function internal.customer_invoice_settled_elsewhere(uuid) owner to postgres;
revoke all on function internal.customer_invoice_settled_elsewhere(uuid) from public;
