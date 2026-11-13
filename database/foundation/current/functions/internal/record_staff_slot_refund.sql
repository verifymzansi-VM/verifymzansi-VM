-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines; repeat jsonb;
  request private.payment_refund_requests; result jsonb; approval boolean; refunded_before bigint;
begin
  actor := internal.staff_actor('payments:refund');
  perform internal.assert_staff_refund_input(p_kind, p_reason_code, p_reason, p_ozow_reference);
  if p_line_id is null then raise exception 'slot required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payment_lines l join private.payments p on p.id = l.payment_id
    where l.id = p_line_id;
  if buyer is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = payment for update;
  select * into line from private.payment_lines l where l.id = p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, line.id, p_kind, p_reason_code, p_reason, p_ozow_reference);
  if repeat is not null then return repeat; end if;
  if pay.status <> 'complete' or line.status <> 'open' then
    raise exception 'only an open slot of a completed payment can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents);
  if not approval then
    result := internal.record_staff_slot_reversal(line.id, p_kind, btrim(p_reason));
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, payment_line_id, account_id, kind, reason_code, reason,
      ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, line.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), btrim(p_ozow_reference),
      line.amount_cents, refunded_before, approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind, 'line_id', line.id,
    'released_activations', request.released_activations,
    'payment_status', coalesce(result->>'payment_status', pay.status), 'repeated', false);
end;
$function$;
alter function internal.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;
