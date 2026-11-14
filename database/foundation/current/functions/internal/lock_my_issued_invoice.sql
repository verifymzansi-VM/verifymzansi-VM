-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_my_issued_invoice(p_actor uuid, p_invoice_number text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  perform internal.lock_evidence_subject(p_actor);
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = p_actor
    for update;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
  elsif inv.status = 'void' then
    raise exception 'this invoice was cancelled' using errcode='PT409', detail='invoice_void';
  end if;
  return inv;
end;
$function$;
alter function internal.lock_my_issued_invoice(uuid,text) owner to postgres;
revoke all on function internal.lock_my_issued_invoice(uuid,text) from public;
