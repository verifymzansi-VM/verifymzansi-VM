-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.void_staff_invoice(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices;
begin
  actor := internal.staff_actor('payments:refund');
  if p_invoice_id is null then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  select * into inv from private.customer_invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  perform internal.lock_evidence_subject(inv.account_id);
  select * into inv from private.customer_invoices i where i.id = p_invoice_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after the lock waits
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  if inv.status = 'void' and inv.voided_by = actor and inv.void_reason = btrim(p_reason) then
    return internal.customer_invoice_dto(inv, actor) || jsonb_build_object('repeated', true);
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is paid; refund the payment instead' using errcode='PT409', detail='invoice_paid';
  elsif inv.status = 'void' then
    raise exception 'this invoice is already void' using errcode='PT409', detail='invoice_void';
  end if;
  if exists(select 1 from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = inv.id and internal.customer_invoice_attempt_live(p)) then
    raise exception 'a payment of this invoice is still open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_payment_open';
  end if;
  update private.payments p set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
    from private.customer_invoice_payments l
    where l.invoice_id = inv.id and l.payment_id = p.id and p.status = 'pending';
  update private.customer_invoices set status = 'void', voided_by = actor, voided_at = statement_timestamp(),
      void_reason = btrim(p_reason)
    where id = inv.id returning * into inv;
  perform internal.staff_actor('payments:refund');
  return internal.customer_invoice_dto(inv, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.void_staff_invoice(uuid,text) owner to postgres;
revoke all on function internal.void_staff_invoice(uuid,text) from public;
grant execute on function internal.void_staff_invoice(uuid,text) to authenticated;
