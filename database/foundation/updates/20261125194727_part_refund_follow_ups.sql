-- Staff refund follow-ups (launch checklist item 56, batch A): the Low
-- findings of the reviews of 20261125133916_staff_part_refunds.sql.
--
-- Only full definitions of four internal functions. No API command, argument,
-- grant or table changes; two staff reads gain result fields. In one
-- transaction it:
--
-- 1. internal.payment_refunded_before_cents: a slot reversed after a part
--    refund that kept it running is counted again (only an applied refund
--    record that ended the paid days covers a reversed slot). Before, such a
--    reversal with no record of its own was under-reported (what was
--    refunded, shown to staff, and so what is left).
-- 2. internal.record_staff_refund:
--    - "Everything left" (p_amount_cents null) never returns an earlier part
--      refund that kept the slot running as a repeat, by request id or by
--      reference: the same reference is then refused as already recorded.
--    - The same request id with a corrected bank reference or Ozow refund id
--      is refused (PT409 refund_request_reused) instead of returning the old
--      record.
--    - A part refund that keeps the slot running is refused while the payment
--      waits for "Activate what was paid for" (PT409 refund_activate_first),
--      so activation does not create the partner commission after the money
--      went back. Refunds that end the paid days are unchanged.
-- 3. internal.get_staff_refunds_left (api.get_staff_refunds_left):
--    - a payment with a reversed slot has 0 left at payment level (a
--      whole-payment refund is refused then; its slots stay refundable one by
--      one);
--    - new field notice_ends_on: the end of 20 South African business days'
--      notice given today, for the section 14 unused-days hint;
--    - new line fields paid_days (the plan's own term) and lost_days (the
--      free lost days added to the slot), so the hint counts only paid days
--      and the form can say when lost days were already given.
-- 4. internal.get_lost_days_preview (api.get_lost_days_preview): new item field
--    refunded_cents, the money already returned for that term by part refunds
--    that kept it running, so the form can say so.
--
-- ORDER: WEBSITE-FIRST. The website of the same pull request reads the new
-- result fields as optional; the website before it reads both reads with a
-- strict parser and would refuse the new fields. Merge and deploy first, then
-- apply. Re-running it changes nothing. It refuses with 55000 unless the four
-- functions have their reviewed bodies (or this update's).
-- Read-only preflight: ../preflight/20261125194727_part_refund_follow_ups.check.sql.
-- Rollback: ../rollback/20261125194727_part_refund_follow_ups.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.payment_refunded_before_cents(uuid)'),
      ('internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)'),
      ('internal.get_staff_refunds_left(uuid[])'),
      ('internal.get_lost_days_preview(text)')) v(sig)
  loop
    if shape not in (
        'internal.payment_refunded_before_cents(uuid) edcb14caf62c8375f0216d828ecc276d',
        'internal.payment_refunded_before_cents(uuid) 2c0d95fd340de5cdeb5bd1822e9328f0',
        'internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) ec6a4f471dc46d6c6c31338f10de07bf',
        'internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) f590f16a96b37446e3ec2381baa786c1',
        'internal.get_staff_refunds_left(uuid[]) 5df1c510531ea6e328ca33cba01e0b9f',
        'internal.get_staff_refunds_left(uuid[]) 7a58e85d2b52fd70303f50779d95e39c',
        'internal.get_lost_days_preview(text) 8174b52a62082b35692a7a7237e2d807',
        'internal.get_lost_days_preview(text) 2dcf020a3f33118c2da1c3f3efb53877') then
      raise exception 'part refund follow-ups precondition: % is neither the reviewed body nor this update''s', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.payment_refunded_before_cents(p_payment_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Refunds applied, waiting or on their way through Ozow, plus reversed slots
  -- no applied refund record that ended the paid days covers: a part refund
  -- that kept the slot running does not cover a later reversal of it
  -- (20261125194727_part_refund_follow_ups.sql).
  select coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
      where r.payment_id = p_payment_id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0)
    + coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p_payment_id and l.status = 'reversed'
        and not exists(select 1 from private.payment_refund_requests r
          where r.status = 'applied' and r.ends_paid_days and r.payment_id = p_payment_id
            and (r.payment_line_id = l.id or r.payment_line_id is null))), 0)::bigint;
$function$;
revoke all on function internal.payment_refunded_before_cents(uuid) from public;

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
revoke all on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) from public;
grant execute on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_staff_refunds_left(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb; counted integer := 0;
  notice_end date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payments required' using errcode='22023';
  end if;
  -- The end of 20 business days' notice given today (section 14), for the
  -- unused-days hint (20261125194727_part_refund_follow_ups.sql).
  while counted < 20 loop
    notice_end := notice_end + 1;
    if internal.za_business_day(notice_end) then counted := counted + 1; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id,
      'refunded_cents', internal.payment_refunded_before_cents(p.id),
      -- A payment with a reversed slot is refunded slot by slot only.
      'left_cents', case when p.status = 'complete' and not exists(select 1 from private.payment_lines l
          where l.payment_id = p.id and l.status = 'reversed')
        then internal.refund_left_cents(p.id, null) else 0 end,
      'notice_ends_on', notice_end,
      'ozow_refund_until', case when internal.ozow_refund_transaction(p.id) is not null
        then p.created_at + internal.ozow_refund_window() end,
      'first_purchase', internal.payment_is_first_purchase(p.id),
      'first_purchase_ask_until', case when internal.payment_is_first_purchase(p.id)
        then internal.first_purchase_last_ask_day(p.completed_at) end,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id,
          'left_cents', case when p.status = 'complete' and l.status = 'open'
            then internal.refund_left_cents(p.id, l.id) else 0 end,
          'starts_at', (select min(e.starts_at) from private.entitlements e where e.payment_line_id = l.id),
          'ends_at', (select max(e.ends_at) from private.entitlements e where e.payment_line_id = l.id),
          -- The plan's own term, and the free lost days added to the slot.
          'paid_days', (select v.duration_days from private.plan_versions v where v.id = l.plan_version_id),
          'lost_days', (select coalesce(max(t.days), 0) from (select sum(a.days) as days
              from private.lost_day_additions a join private.entitlements e on e.id = a.entitlement_id
              where e.payment_line_id = l.id group by a.entitlement_id) t))
        order by l.line_number) from private.payment_lines l where l.payment_id = p.id), '[]'::jsonb))
    order by p.id), '[]'::jsonb)
    into result
    from private.payments p where p.id = any(p_payment_ids);
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
revoke all on function internal.get_staff_refunds_left(uuid[]) from public;
grant execute on function internal.get_staff_refunds_left(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_lost_days_preview(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('payments:view');
  v_member uuid;
begin
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'lost days: no active member account has this email' using errcode='PT409',
      detail='lost_days_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_member);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('kind', g.kind, 'id', g.id, 'slots', g.slots, 'renewals', g.renewals,
        'ends_at', g.ends_at,
        -- Money already returned for days we failed to provide, by part refunds
        -- that kept the slot running (20261125194727_part_refund_follow_ups.sql).
        'refunded_cents', (select coalesce(sum(r.amount_cents), 0) from private.payment_refund_requests r
          where r.kind = 'refunded' and not r.ends_paid_days
            and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')
            and exists(select 1 from private.entitlements x where x.id = any(g.grants) and x.payment_id = r.payment_id
              and (r.payment_line_id is null or r.payment_line_id = x.payment_line_id))))
      order by g.ends_at, g.id)
    from (
      select case when bool_and(e.package_id is null) then 'individual' else 'package' end as kind,
        coalesce(e.package_id, e.slot_id, e.id) as id,
        case when bool_and(e.package_id is null) then max(e.slot_capacity) else sum(e.slot_capacity) end::integer as slots,
        (count(*) filter (where e.starts_at>statement_timestamp()))::integer as renewals,
        max(e.ends_at) as ends_at, array_agg(e.id) as grants
      from private.entitlements e
        join private.payments pay on pay.id=e.payment_id and pay.status='complete'
      where e.owner_id=v_member and e.source='retail_paid' and e.status='active'
        and e.ends_at>statement_timestamp()
      group by 2
    ) g), '[]'::jsonb));
end;
$function$;
revoke all on function internal.get_lost_days_preview(text) from public;
grant execute on function internal.get_lost_days_preview(text) to authenticated;

commit;
