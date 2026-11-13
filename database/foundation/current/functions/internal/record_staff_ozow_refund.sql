-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_ozow_refund(p_channel text, p_payment_id uuid, p_line_id uuid, p_reason_code text, p_reason text, p_ozow_refund_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines;
  prior private.payment_refund_requests; request private.payment_refund_requests; transaction uuid;
  amount bigint; refunded_before bigint; approval boolean; result jsonb; new_id uuid := pg_catalog.gen_random_uuid();
begin
  actor := internal.staff_actor('payments:refund');
  if p_channel is null or p_channel not in ('api', 'dashboard')
    or (p_channel = 'api' and p_ozow_refund_id is not null) then
    raise exception 'refund channel required' using errcode='22023';
  end if;
  if p_channel = 'dashboard' and p_ozow_refund_id is null then
    raise exception 'Ozow refund id required' using errcode='22023', detail='ozow_refund_id_required';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  if p_line_id is not null and not exists(select 1 from private.payment_lines l
      where l.id = p_line_id and l.payment_id = payment) then
    raise exception 'slot payment line not found' using errcode='22023';
  end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = payment for update;
  if p_line_id is not null then
    select * into line from private.payment_lines l where l.id = p_line_id for update;
  end if;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- A repeat of the same request by the same staff member returns its state.
  if p_channel = 'dashboard' then
    -- A declined record took no effect, so its refund id may be recorded again.
    select * into prior from private.payment_refund_requests r
      where r.ozow_refund_id = p_ozow_refund_id and r.status <> 'declined';
    if not found then
      select * into prior from private.payment_refund_requests r
        where r.channel = 'manual' and r.status <> 'declined' and lower(r.ozow_reference) = p_ozow_refund_id::text;
    end if;
    if found then
      if prior.channel = 'dashboard' and prior.payment_id = pay.id and prior.payment_line_id is not distinct from line.id
          and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = actor then
        return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'channel', prior.channel,
          'kind', prior.kind, 'line_id', prior.payment_line_id, 'amount_cents', prior.amount_cents,
          'needs_approval', prior.needs_approval, 'released_activations', prior.released_activations,
          'payment_status', pay.status, 'repeated', true);
      end if;
      raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
    end if;
  else
    select * into prior from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('awaiting_approval', 'approved', 'sent')
        and r.payment_line_id is not distinct from line.id and r.reason_code = p_reason_code
        and r.reason = btrim(p_reason) and r.requested_by = actor;
    if found then
      return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'channel', prior.channel,
        'kind', prior.kind, 'line_id', prior.payment_line_id, 'amount_cents', prior.amount_cents,
        'needs_approval', prior.needs_approval, 'released_activations', prior.released_activations,
        'payment_status', pay.status, 'repeated', true);
    end if;
  end if;
  if pay.status <> 'complete' or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
      or (p_line_id is not null and line.status <> 'open') then
    raise exception 'only a completed payment or open slot that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if p_line_id is null and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  transaction := internal.ozow_refund_transaction(pay.id);
  if transaction is null then
    raise exception 'this payment was not paid through Ozow; record its refund with its reference' using errcode='PT409', detail='payment_not_ozow';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  amount := coalesce(line.amount_cents, pay.amount_cents);
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval('refunded', refunded_before, amount);
  if p_channel = 'dashboard' and not approval then
    -- The money already went back in the Ozow dashboard: it takes effect now,
    -- as today's recorded refunds do.
    if p_line_id is null then
      result := internal.reverse_payment(pay.id, 'refunded', btrim(p_reason));
      insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
        values (pay.id, actor, 'refunded', btrim(p_reason), (result->>'released_activations')::integer);
    else
      result := internal.record_staff_slot_reversal(line.id, 'refunded', btrim(p_reason));
    end if;
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (id, payment_id, payment_line_id, account_id, kind, reason_code, reason,
      ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at,
      released_activations, channel, approved_at, ozow_transaction_id, ozow_refund_id)
    values (new_id, pay.id, line.id, pay.owner_id, 'refunded', p_reason_code, btrim(p_reason),
      case when p_channel = 'api' then 'vm-refund-' || new_id::text else p_ozow_refund_id::text || ':' || new_id::text end,
      amount, refunded_before, approval,
      case when approval then 'awaiting_approval' when p_channel = 'api' then 'approved' else 'applied' end, actor,
      case when p_channel = 'dashboard' and not approval then statement_timestamp() end,
      case when p_channel = 'dashboard' and not approval then (result->>'released_activations')::integer end,
      p_channel, case when p_channel = 'api' and not approval then statement_timestamp() end, transaction,
      p_ozow_refund_id)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'channel', request.channel,
    'kind', request.kind, 'line_id', request.payment_line_id, 'amount_cents', request.amount_cents,
    'needs_approval', request.needs_approval, 'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
alter function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid) owner to postgres;
revoke all on function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid) from public;
