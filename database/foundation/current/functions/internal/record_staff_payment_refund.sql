-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_payment_refund(p_payment_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; repeat jsonb; request private.payment_refund_requests;
  result jsonb; approval boolean; refunded_before bigint; reference text;
begin
  actor := internal.staff_actor('payments:refund');
  reference := internal.staff_refund_reference(p_payment_id, p_ozow_reference);
  perform internal.assert_staff_refund_reason(p_kind, p_reason_code, p_reason);
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_payment_id::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, null, p_kind, p_reason_code, p_reason, reference);
  if repeat is not null then return repeat; end if;
  if exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id) or pay.status <> 'complete' then
    raise exception 'only a completed payment that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval(p_kind, refunded_before, pay.amount_cents);
  if not approval then
    result := internal.reverse_payment(pay.id, p_kind, btrim(p_reason));
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, p_kind, btrim(p_reason), (result->>'released_activations')::integer);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, account_id, kind, reason_code, reason, ozow_reference,
      amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference, pay.amount_cents, refunded_before,
      approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind,
    'released_activations', request.released_activations,
    'payment_status', case when approval then pay.status else p_kind end, 'repeated', false);
end;
$function$;
alter function internal.record_staff_payment_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_payment_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_payment_refund(uuid,text,text,text,text) to authenticated;
