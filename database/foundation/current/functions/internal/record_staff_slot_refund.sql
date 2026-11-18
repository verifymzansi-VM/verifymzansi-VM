-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines; repeat jsonb;
  request private.payment_refund_requests; result jsonb; approval boolean; refunded_before bigint; reference text;
begin
  actor := internal.staff_actor('payments:refund');
  reference := internal.staff_refund_reference((select l.payment_id from private.payment_lines l where l.id = p_line_id),
    p_ozow_reference, p_kind);
  perform internal.assert_staff_refund_reason(p_kind, p_reason_code, p_reason);
  if p_line_id is null then raise exception 'slot required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payment_lines l join private.payments p on p.id = l.payment_id
    where l.id = p_line_id;
  if payment is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(buyer, payment);
  select * into pay from private.payments p where p.id = payment for update;
  select * into line from private.payment_lines l where l.id = p_line_id for update;
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, line.id, p_kind, p_reason_code, p_reason, reference);
  if repeat is not null then return repeat; end if;
  if pay.status <> 'complete' or line.status <> 'open' then
    raise exception 'only an open slot of a completed payment can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  -- Not while a refund through Ozow is on its way: Ozow may still pay it.
  if p_kind = 'refunded' and exists(select 1 from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, line.id) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if p_kind = 'refunded' and internal.refund_renewal_waiting(pay.id, line.id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents) or pay.owner_id is null;
  if not approval then
    result := internal.record_staff_slot_reversal(line.id, p_kind, btrim(p_reason));
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- The same reference recorded at the same moment for another payment: the
  -- unique index decides; say so in the reference's words.
  declare violated text;
  begin
    insert into private.payment_refund_requests (payment_id, payment_line_id, account_id, kind, reason_code, reason,
        ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
      values (pay.id, line.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference,
        line.amount_cents, refunded_before, approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
        case when approval then null else statement_timestamp() end,
        case when approval then null else (result->>'released_activations')::integer end)
      returning * into request;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated in ('payment_refund_requests_reference_idx', 'payment_refund_requests_ozow_key_idx') then
      if internal.refund_by_bank_transfer(pay.id, p_kind) then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    raise;
  end;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind, 'line_id', line.id,
    'released_activations', request.released_activations,
    'payment_status', coalesce(result->>'payment_status', pay.status), 'repeated', false);
end;
$function$;
alter function internal.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;
