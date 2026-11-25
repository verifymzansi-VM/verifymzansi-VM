-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_refund(p_payment_id uuid, p_line_id uuid, p_channel text, p_amount_cents bigint, p_reason_code text, p_reason text, p_reference text, p_ozow_fact jsonb, p_asked_on text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines;
  prior private.payment_refund_requests; request private.payment_refund_requests; channel text;
  transaction uuid; refund_id uuid; reference text; left_cents bigint; amount bigint; refunded_before bigint;
  approval boolean; ends boolean; asked date; new_id uuid := pg_catalog.gen_random_uuid();
begin
  actor := internal.staff_actor('payments:refund');
  -- The day the customer asked (YYYY-MM-DD), for a first purchase.
  if p_asked_on is not null then
    if p_asked_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'the date the customer asked must be a date (YYYY-MM-DD)' using errcode='22023',
        detail='first_purchase_asked_on_invalid';
    end if;
    begin
      asked := p_asked_on::date;
    exception when others then
      raise exception 'the date the customer asked must be a date (YYYY-MM-DD)' using errcode='22023',
        detail='first_purchase_asked_on_invalid';
    end;
  end if;
  channel := case p_channel when 'ozow' then 'api' when 'dashboard' then 'dashboard' when 'reference' then 'manual' end;
  if channel is null then raise exception 'refund channel required' using errcode='22023'; end if;
  -- The one list of reasons, and the first-purchase reason (only here).
  if p_reason_code = 'first_purchase_cancelled' then
    if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
      raise exception 'audit reason required' using errcode='22023';
    end if;
  else
    perform internal.assert_staff_refund_reason('refunded', p_reason_code, p_reason);
    if asked is not null then
      raise exception 'the date the customer asked is only for a first purchase' using errcode='22023',
        detail='refund_asked_on_unexpected';
    end if;
  end if;
  if p_request_id is null then
    raise exception 'refund request id required' using errcode='22023', detail='refund_request_id_required';
  end if;
  if p_amount_cents is not null and p_amount_cents < 1 then
    raise exception 'a refund is at least 1 cent' using errcode='22023', detail='refund_amount_invalid';
  end if;
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payments p where p.id = p_payment_id;
  if payment is null then raise exception 'payment not found' using errcode='22023'; end if;
  if p_line_id is not null and not exists(select 1 from private.payment_lines l
      where l.id = p_line_id and l.payment_id = payment) then
    raise exception 'slot payment line not found' using errcode='22023';
  end if;
  if channel = 'dashboard' then
    if p_reference is null or btrim(p_reference) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Ozow refund id required' using errcode='22023', detail='ozow_refund_id_required';
    end if;
    refund_id := lower(btrim(p_reference))::uuid;
    -- The refund as the website read it from Ozow, when it could: it only refuses.
    if p_ozow_fact is not null and (not internal.valid_ozow_refund_fact(p_ozow_fact)
        or p_ozow_fact->>'refund_id' is distinct from refund_id::text) then
      raise exception 'valid Ozow refund required' using errcode='22023';
    end if;
  elsif p_ozow_fact is not null or (channel = 'api' and p_reference is not null) then
    raise exception 'refund channel required' using errcode='22023';
  elsif channel = 'manual' then
    reference := internal.staff_refund_reference(payment, p_reference, 'refunded');
  end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(buyer, payment);
  select * into pay from private.payments p where p.id = payment for update;
  if p_line_id is not null then
    select * into line from private.payment_lines l where l.id = p_line_id for update;
  end if;
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- The same request id again: the first record, whatever its state, when the
  -- input is the same; otherwise refused.
  select * into prior from private.payment_refund_requests r where r.request_id = p_request_id;
  if found then
    if prior.channel = channel and prior.payment_id = pay.id and prior.payment_line_id is not distinct from line.id
        and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = actor
        and (p_amount_cents is null or prior.amount_cents = p_amount_cents)
        and (p_amount_cents is not null or prior.ends_paid_days)
        and prior.customer_asked_on is not distinct from asked
        -- The bank reference, or Ozow's refund id, is the one recorded: a
        -- corrected one is another refund (20261125194727_part_refund_follow_ups.sql).
        and (channel <> 'manual' or lower(prior.ozow_reference) = lower(reference))
        and (channel <> 'dashboard' or prior.ozow_refund_id = refund_id) then
      return internal.staff_refund_result(prior, true);
    end if;
    raise exception 'this refund request id was already used for another refund' using errcode='PT409',
      detail='refund_request_reused';
  end if;
  prior := null;
  -- A repeat of the same request by the same staff member returns its state.
  if channel = 'dashboard' then
    -- A declined record took no effect, so its refund id may be recorded again.
    select * into prior from private.payment_refund_requests r
      where r.ozow_refund_id = refund_id and r.status <> 'declined';
    if not found then
      select * into prior from private.payment_refund_requests r
        where r.channel = 'manual' and r.status <> 'declined' and lower(r.ozow_reference) = refund_id::text;
    end if;
  elsif channel = 'api' then
    select * into prior from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('awaiting_approval', 'approved', 'sent')
        and r.payment_line_id is not distinct from line.id and r.reason_code = p_reason_code
        and r.reason = btrim(p_reason) and r.requested_by = actor;
  else
    select * into prior from private.payment_refund_requests r
      where lower(r.ozow_reference) = lower(reference) and r.status <> 'declined';
  end if;
  if prior.id is not null then
    if prior.channel = channel and prior.payment_id = pay.id and prior.payment_line_id is not distinct from line.id
        and prior.kind = 'refunded' and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason)
        and prior.requested_by = actor and (p_amount_cents is null or prior.amount_cents = p_amount_cents)
        -- "Everything left" never repeats a part refund that kept the slot
        -- running (20261125194727_part_refund_follow_ups.sql).
        and (p_amount_cents is not null or prior.ends_paid_days)
        and prior.customer_asked_on is not distinct from asked then
      return internal.staff_refund_result(prior, true);
    end if;
    if channel = 'dashboard' then
      raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
    elsif channel = 'manual' then
      if internal.refund_by_bank_transfer(pay.id, 'refunded') then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
  end if;
  if pay.status <> 'complete' or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
      or (p_line_id is not null and line.status <> 'open') then
    raise exception 'only a completed payment or open slot that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if p_line_id is null and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  -- Not while a refund through Ozow is on its way: Ozow may still pay it.
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.channel = 'api'
      and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  -- The amount: everything left, or a part of it.
  left_cents := internal.refund_left_cents(pay.id, line.id);
  if left_cents < 1 then
    raise exception 'nothing is left to refund on this payment' using errcode='PT409', detail='refund_more_than_left';
  end if;
  amount := coalesce(p_amount_cents, left_cents);
  if amount > left_cents then
    raise exception 'at most % cents are left to refund', left_cents using errcode='PT409', detail='refund_more_than_left';
  end if;
  -- The slot keeps running only for a part refund of our failure or a billing error.
  ends := amount = left_cents or p_reason_code not in ('our_failure_after_fix_offered', 'billing_error');
  -- Money back for days we failed to provide is for a slot that was delivered:
  -- a payment waiting for "Activate what was paid for" is activated first, so
  -- its partner commission is not created after the refund
  -- (20261125194727_part_refund_follow_ups.sql).
  if not ends and pay.fulfillment_status <> 'fulfilled' then
    raise exception 'activate what was paid for first, then refund part of it' using errcode='PT409',
      detail='refund_activate_first';
  end if;
  if p_reason_code = 'first_purchase_cancelled' then
    if p_line_id is not null or amount <> pay.amount_cents then
      raise exception 'a first purchase is refunded in full: the whole payment, with nothing refunded before'
        using errcode='PT409', detail='first_purchase_whole_payment';
    end if;
    perform internal.assert_first_purchase_refund(pay.id, asked);
  end if;
  if p_reason_code in ('duplicate', 'renewal_cancelled_before_start') and amount <> left_cents then
    raise exception 'this reason refunds everything left' using errcode='PT409', detail='refund_whole_only';
  end if;
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, line.id) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if ends and internal.refund_renewal_waiting(pay.id, line.id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  if channel in ('api', 'dashboard') then
    transaction := internal.ozow_refund_transaction(pay.id);
    if transaction is null then
      raise exception 'this payment was not paid through Ozow; record its refund with its reference' using errcode='PT409', detail='payment_not_ozow';
    end if;
  end if;
  -- Ozow refunds a payment only within its window (internal.ozow_refund_window);
  -- after that staff pay it back by bank transfer and record the bank reference.
  -- A refund already made in the Ozow dashboard is recorded whenever it was made.
  if channel = 'api' and not internal.ozow_refund_window_open(pay.id) then
    raise exception 'Ozow refunds only within 13 days of the payment; pay it back by bank transfer and record the bank reference'
      using errcode='PT409', detail='outside_refund_window';
  end if;
  if p_ozow_fact is not null then
    if (p_ozow_fact->>'transaction_id')::uuid is distinct from transaction
        or (p_ozow_fact->>'amount_cents')::bigint is distinct from amount then
      raise exception 'this Ozow refund is for another payment or amount' using errcode='PT409', detail='ozow_refund_mismatch';
    end if;
    if p_ozow_fact->>'status' in ('Failed', 'Cancelled', 'Returned', 'Invalid', 'Error') then
      raise exception 'Ozow has no paid refund with this id' using errcode='PT409', detail='refund_ozow_failed';
    end if;
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval('refunded', refunded_before, amount) or pay.owner_id is null;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- The same reference recorded at the same moment for another payment: the
  -- unique index decides; say so in the reference's words.
  declare violated text;
  begin
    insert into private.payment_refund_requests (id, payment_id, payment_line_id, account_id, kind, reason_code, reason,
        ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at,
        channel, approved_at, ozow_transaction_id, ozow_refund_id, ends_paid_days, customer_asked_on, request_id)
      values (new_id, pay.id, line.id, pay.owner_id, 'refunded', p_reason_code, btrim(p_reason),
        case channel when 'api' then 'vm-refund-' || new_id::text when 'dashboard' then refund_id::text || ':' || new_id::text
          else reference end,
        amount, refunded_before, approval,
        case when approval then 'awaiting_approval' when channel = 'api' then 'approved' else 'applied' end, actor,
        case when not approval and channel <> 'api' then statement_timestamp() end,
        channel, case when channel = 'api' and not approval then statement_timestamp() end,
        transaction, refund_id, ends, asked, p_request_id)
      returning * into request;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated = 'payment_refund_requests_request_idx' then
      raise exception 'this refund request id was already used for another refund' using errcode='PT409',
        detail='refund_request_reused';
    end if;
    if violated in ('payment_refund_requests_reference_idx', 'payment_refund_requests_ozow_key_idx',
        'payment_refund_requests_ozow_refund_idx') then
      if channel = 'dashboard' then
        raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
      end if;
      if internal.refund_by_bank_transfer(pay.id, 'refunded') then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    raise;
  end;
  -- Recorded and not waiting (a reference or the dashboard): it takes effect now.
  if request.status = 'applied' then
    perform internal.apply_staff_refund(request.id, actor);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  select * into request from private.payment_refund_requests r where r.id = new_id;
  return internal.staff_refund_result(request, false);
end;
$function$;
alter function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) owner to postgres;
revoke all on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) from public;
grant execute on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) to authenticated;
