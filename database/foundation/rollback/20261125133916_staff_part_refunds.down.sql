-- Reviewed rollback for updates/20261125133916_staff_part_refunds.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Merge the website's revert first:
-- the website of that update calls api.record_staff_refund and
-- api.get_staff_refunds_left, which this drops.
-- It puts back the earlier bodies of internal.payment_refund_request_guard,
-- internal.payment_net_cents, internal.approve_staff_payment_refund,
-- internal.apply_ozow_refund_state and internal.claim_ozow_refund_send, drops
-- the commands and helpers the update added, puts back the earlier reason
-- list and drops the columns ends_paid_days and customer_asked_on with their
-- rules. It refuses unless every function has the update's body, and once a
-- refund was recorded with the first-purchase reason or as a part refund that
-- keeps the slot running, or for less than the whole payment or slot (the
-- earlier schema cannot hold those records: fix forward).
begin;
set local lock_timeout='5s';

do $$
declare shape text; n bigint;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.payment_refund_request_guard()'),
      ('internal.payment_net_cents(private.payments)'),
      ('internal.approve_staff_payment_refund(uuid)'),
      ('internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text)'),
      ('internal.claim_ozow_refund_send(uuid)'),
      ('internal.za_public_holiday(date)'),
      ('internal.za_business_day(date)'),
      ('internal.first_purchase_last_ask_day(timestamp with time zone)'),
      ('internal.payment_is_first_purchase(uuid)'),
      ('internal.assert_first_purchase_refund(uuid,date)'),
      ('internal.refund_left_cents(uuid,uuid)'),
      ('internal.staff_refund_result(private.payment_refund_requests,boolean)'),
      ('internal.apply_staff_refund(uuid,uuid)'),
      ('internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)'),
      ('internal.get_staff_refunds_left(uuid[])'),
      ('api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)'),
      ('api.get_staff_refunds_left(uuid[])')) v(sig)
  loop
    if shape not in (
        'internal.payment_refund_request_guard() 88275008dfa41413af55cefbc6341e9d',
        'internal.payment_net_cents(private.payments) 237b3d0054e49f02f2da9cd227d5c789',
        'internal.approve_staff_payment_refund(uuid) 5c49b676ca097005f4cfc0522b1548ee',
        'internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) 30efff760c445d2ba03ecbb98515044b',
        'internal.claim_ozow_refund_send(uuid) 3b5affd02d571f3aa264dfd17ad938cb',
        'internal.za_public_holiday(date) da84c3f6ecadd2c77d9460af069ec241',
        'internal.za_business_day(date) 75386489557e85499d60cba6160b094a',
        'internal.first_purchase_last_ask_day(timestamp with time zone) ef96b90f35d916053e7fa5ca05acebd4',
        'internal.payment_is_first_purchase(uuid) 3f369250c24ea059f2c3b13102981076',
        'internal.assert_first_purchase_refund(uuid,date) 2d9dff6d73922a859999ad1f349bd614',
        'internal.refund_left_cents(uuid,uuid) fceaee2d494b94bd4d1f38e1e4a0692e',
        'internal.staff_refund_result(private.payment_refund_requests,boolean) cfe27e3019d6875bdd690f86a5f8fdbb',
        'internal.apply_staff_refund(uuid,uuid) 65293b9f671ce94e8fe76a0fb4ba0e6a',
        'internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) ec6a4f471dc46d6c6c31338f10de07bf',
        'internal.get_staff_refunds_left(uuid[]) 5df1c510531ea6e328ca33cba01e0b9f',
        'api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid) 621da7145ee2beea53cb54b0547dbaa8',
        'api.get_staff_refunds_left(uuid[]) d721ae75b29975a22c613227abf39aa4') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  select count(*) into n from private.payment_refund_requests r
    where r.reason_code = 'first_purchase_cancelled' or not r.ends_paid_days
      or r.amount_cents <> coalesce((select l.amount_cents from private.payment_lines l where l.id = r.payment_line_id),
        case when r.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = r.payment_id) end);
  if n > 0 then
    raise exception 'rollback precondition: % refund records are first-purchase or part refunds; the earlier schema cannot hold them (fix forward)', n
      using errcode='55000';
  end if;
end$$;

drop function if exists api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid);
drop function if exists api.get_staff_refunds_left(uuid[]);
drop function if exists internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid);
drop function if exists internal.get_staff_refunds_left(uuid[]);


CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed text[]; allowed text[];
  ozow_facts constant text[] := array['ozow_refund_id','ozow_status','ozow_status_at','ozow_requested_at',
    'ozow_completed_at','send_outcome','ozow_checked_at','ozow_missing_at'];
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- The request, its reference, amount, account, channel and Ozow transaction
  -- never change. A waiting record is approved, applied or declined once; an
  -- API record is then sent once and settles once (applied, failed or
  -- returned). Only Ozow's facts and the send bookkeeping change in between.
  if tg_op = 'INSERT' then
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id)
      or new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    if new.channel in ('api', 'dashboard')
        and new.ozow_transaction_id is distinct from internal.ozow_refund_transaction(new.payment_id) then
      raise exception 'an Ozow refund names the Ozow transaction of the payment' using errcode='23514';
    end if;
    if new.channel = 'api' and (new.status not in ('awaiting_approval', 'approved') or new.send_attempts <> 0
        or new.ozow_refund_id is not null or new.ozow_status is not null or new.approved_by is not null) then
      raise exception 'an API refund starts waiting or approved, before it is sent' using errcode='23514';
    end if;
    if new.ozow_status is not null or new.ozow_checked_at is not null or new.ozow_missing_at is not null
        or new.closed_by is not null then
      raise exception 'a refund starts without an Ozow status' using errcode='23514';
    end if;
    -- An Ozow refund id is recorded once, whichever way it was recorded: a
    -- reference record may not name a refund already recorded by its id.
    if new.channel = 'manual' and exists(select 1 from private.payment_refund_requests r
        where r.status <> 'declined' and r.ozow_refund_id::text = lower(btrim(new.ozow_reference))) then
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    -- Once the server has sent a refund to Ozow, a refund of an Ozow payment is
    -- made through Ozow (or recorded from the dashboard with Ozow's refund id),
    -- never with a typed reference. Chargebacks, payments made outside Ozow
    -- and Ozow payments whose refund window has passed (paid back by bank
    -- transfer, internal.refund_by_bank_transfer) keep the reference.
    if new.channel = 'manual' and new.kind = 'refunded'
        and internal.ozow_refund_transaction(new.payment_id) is not null
        and not internal.refund_by_bank_transfer(new.payment_id, new.kind)
        and exists(select 1 from private.payment_refund_requests r where r.channel = 'api' and r.send_attempts > 0) then
      raise exception 'refunds of Ozow payments go through Ozow now' using errcode='PT409', detail='ozow_reference_retired';
    end if;
    return new;
  end if;
  select coalesce(array_agg(n.key order by n.key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value;
  if old.ozow_refund_id is not null and new.ozow_refund_id is distinct from old.ozow_refund_id then
    raise exception 'an Ozow refund id never changes' using errcode='23514';
  end if;
  if new.send_attempts < old.send_attempts then
    raise exception 'send attempts only rise' using errcode='23514';
  end if;
  if old.status = new.status then
    allowed := case
      when old.status = 'applied' and old.released_activations is null then array['released_activations']
      else '{}'::text[] end
      || case when old.channel = 'manual' then '{}'::text[]
        else ozow_facts || array['send_attempts','last_send_at'] end;
  elsif old.status = 'awaiting_approval' and new.status = 'declined' then
    allowed := array['status','declined_by','declined_at','decline_reason'];
  elsif old.status = 'awaiting_approval' and old.channel <> 'api' and new.status = 'applied' then
    allowed := array['status','approved_by','applied_at'];
  elsif old.status = 'awaiting_approval' and old.channel = 'api' and new.status = 'approved' then
    allowed := array['status','approved_by','approved_at'];
  elsif old.channel = 'api' and old.status = 'approved' and new.status in ('sent', 'failed') then
    allowed := array['status','sent_at','send_attempts','last_send_at','send_outcome','failed_at','failure_reason',
      'closed_by','close_reason'];
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'applied' then
    allowed := array['status','applied_at'] || ozow_facts;
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'failed' then
    allowed := array['status','failed_at','failure_reason','closed_by','close_reason'] || ozow_facts;
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'returned' then
    allowed := array['status','returned_at'] || ozow_facts;
  else
    raise exception 'refund records are immutable; a waiting refund is approved, applied or declined once and an Ozow refund settles once'
      using errcode='23514';
  end if;
  if not changed <@ allowed then
    raise exception 'refund records are immutable; a waiting refund is approved, applied or declined once and an Ozow refund settles once'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
revoke all on function internal.payment_refund_request_guard() from public;


CREATE OR REPLACE FUNCTION internal.payment_net_cents(p private.payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- What the payment brought in: nothing once the whole payment was refunded
  -- or charged back, else its amount less its reversed slots.
  select case when p.status in ('refunded', 'chargeback') then 0::bigint
    else greatest(p.amount_cents - coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p.id and l.status = 'reversed'), 0), 0)::bigint end;
$function$;
revoke all on function internal.payment_net_cents(private.payments) from public;


CREATE OR REPLACE FUNCTION internal.approve_staff_payment_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests; pay private.payments; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  perform internal.lock_kept_record_subject(request.account_id, request.payment_id);
  select * into pay from private.payments p where p.id = request.payment_id for update;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  if request.status not in ('awaiting_approval', 'declined') and request.approved_by = actor then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
      'released_activations', request.released_activations, 'payment_status', pay.status, 'repeated', true);
  end if;
  if request.status <> 'awaiting_approval' then
    raise exception 'this refund is no longer waiting for approval' using errcode='PT409', detail='refund_not_waiting';
  end if;
  -- The payment or slot changed since the refund was recorded (for example a
  -- reversal recorded before this rule existed): decline it and record again.
  if pay.status <> 'complete'
    or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
    or (request.payment_line_id is null
      and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed'))
    or (request.payment_line_id is not null
      and not exists(select 1 from private.payment_lines l where l.id = request.payment_line_id and l.status = 'open'))
    or (request.channel in ('api', 'dashboard')
      and internal.ozow_refund_transaction(pay.id) is distinct from request.ozow_transaction_id) then
    raise exception 'the payment changed since this refund was recorded; decline it and record it again'
      using errcode='PT409', detail='refund_payment_changed';
  end if;
  -- The reason holds only while the renewal's days have not started.
  if request.reason_code = 'renewal_cancelled_before_start'
      and not internal.refund_renewal_not_started(pay.id, request.payment_line_id) then
    raise exception 'the renewal has started; decline this refund and record it with another reason' using errcode='PT409', detail='renewal_already_started';
  end if;
  -- A renewal of the slot bought while the refund waited: refund the renewal
  -- first (decline this one and record it again afterwards).
  if request.kind = 'refunded' and internal.refund_renewal_waiting(pay.id, request.payment_line_id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  if request.channel = 'api' and not internal.ozow_refund_window_open(pay.id) then
    raise exception 'Ozow refunds only within 13 days of the payment; decline this refund, pay it back by bank transfer and record the bank reference'
      using errcode='PT409', detail='outside_refund_window';
  end if;
  -- A dashboard refund Ozow does not have, or did not pay, never takes effect.
  if request.channel = 'dashboard' and (request.ozow_missing_at is not null
      or request.ozow_status in ('Failed', 'Cancelled', 'Returned', 'Invalid', 'Error')) then
    raise exception 'Ozow has no paid refund with this id; decline it' using errcode='PT409', detail='refund_ozow_failed';
  end if;
  if request.channel = 'api' then
    -- Approved: the server sends it to Ozow; the payment changes only when
    -- Ozow reports the refund complete.
    update private.payment_refund_requests set status = 'approved', approved_by = actor,
      approved_at = statement_timestamp()
      where id = request.id returning * into request;
    perform internal.staff_actor('payments:refund');
    perform internal.assert_staff_payment_actor(actor, request.account_id);
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
      'released_activations', null, 'payment_status', pay.status, 'repeated', false);
  end if;
  -- The record leaves "waiting" first, so the reversal below is no longer held
  -- back by internal.payment_reversal_waiting_guard; it is one transaction, so
  -- a failed reversal puts the record back to waiting.
  update private.payment_refund_requests set status = 'applied', approved_by = actor, applied_at = statement_timestamp()
    where id = request.id;
  if request.payment_line_id is null then
    result := internal.reverse_payment(pay.id, request.kind, request.reason);
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, request.kind, request.reason, (result->>'released_activations')::integer);
  else
    result := internal.record_staff_slot_reversal(request.payment_line_id, request.kind, request.reason);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
    where id = request.id returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
    'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
revoke all on function internal.approve_staff_payment_refund(uuid) from public;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;


CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_state(p_request_id uuid, p_status text, p_requested_at timestamp with time zone, p_completed_at timestamp with time zone, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; outcome text; result jsonb; actor uuid;
begin
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  outcome := case when p_status = 'Complete' then 'complete' when p_status = 'Returned' then 'returned'
    when p_status in ('Failed', 'Error', 'Invalid', 'Cancelled') then 'failed' else 'pending' end;
  -- Ozow has this refund after all: an earlier "missing" no longer holds.
  if request.ozow_missing_at is not null then
    update private.payment_refund_requests set ozow_missing_at = null where id = request.id
      returning * into request;
  end if;
  -- The same status again (a repeated notice, a retried send, the daily
  -- check) was applied before: nothing changes and nobody is alerted twice.
  if request.ozow_status is not distinct from p_status then
    return 'unchanged';
  end if;
  -- A final status Ozow already gave is never replaced by a non-final one (an
  -- answer that arrives after the notice, or an older list entry).
  if outcome = 'pending' and request.ozow_status in ('Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid', 'Error') then
    return 'unchanged';
  end if;
  update private.payment_refund_requests set ozow_status = p_status, ozow_status_at = statement_timestamp(),
    ozow_requested_at = coalesce(ozow_requested_at, p_requested_at),
    ozow_completed_at = coalesce(ozow_completed_at, case when outcome = 'complete' then p_completed_at end)
    where id = request.id returning * into request;
  if request.channel = 'api' and request.status = 'sent' then
    if outcome = 'complete' then
      actor := coalesce(request.approved_by, request.requested_by);
      -- The record is applied first, so the reversal is no longer held back by
      -- internal.payment_reversal_waiting_guard; one transaction.
      update private.payment_refund_requests set status = 'applied', applied_at = statement_timestamp(),
        send_outcome = 'accepted' where id = request.id;
      if request.payment_line_id is null then
        result := internal.reverse_payment(request.payment_id, 'refunded', request.reason);
        insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
          values (request.payment_id, actor, 'refunded', request.reason, (result->>'released_activations')::integer);
      else
        result := internal.reverse_payment_line(request.payment_line_id, 'refunded', request.reason, actor);
      end if;
      update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
        where id = request.id;
      return 'applied';
    elsif outcome = 'failed' then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = case p_status when 'Cancelled' then 'ozow_cancelled' when 'Invalid' then 'ozow_invalid'
          else 'ozow_failed' end, send_outcome = 'accepted'
        where id = request.id;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', p_source, request.id::text);
      return 'failed';
    elsif outcome = 'returned' then
      update private.payment_refund_requests set status = 'returned', returned_at = statement_timestamp(),
        send_outcome = 'accepted' where id = request.id;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_returned', p_source, request.id::text);
      return 'returned';
    end if;
    return 'pending';
  end if;
  -- A record that already settled (or a dashboard record) never changes again:
  -- staff are told when Ozow's outcome contradicts it.
  if outcome = 'returned' and request.status <> 'returned' then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_returned', p_source, request.id::text);
    return 'flagged';
  end if;
  if outcome = 'failed' and request.status not in ('failed', 'declined') then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', p_source, request.id::text);
    return 'flagged';
  end if;
  if outcome = 'complete' and request.status in ('failed', 'returned', 'declined') then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', p_source, request.id::text);
    return 'flagged';
  end if;
  return 'recorded';
end;
$function$;
revoke all on function internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) from public;


CREATE OR REPLACE FUNCTION internal.claim_ozow_refund_send(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid;
begin
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select r.payment_id into payment from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.status = 'approved' then
    -- The refunded period's grants: a renewal bought at the same moment waits for
    -- this, so the renewal rules below see it.
    perform 1 from private.entitlements e where e.payment_id = request.payment_id order by e.id for update;
    if (select p.status from private.payments p where p.id = request.payment_id) is distinct from 'complete'
        or internal.ozow_refund_transaction(request.payment_id) is distinct from request.ozow_transaction_id
        or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = request.payment_id)
        or (request.payment_line_id is null and exists(select 1 from private.payment_lines l
          where l.payment_id = request.payment_id and l.status = 'reversed'))
        or (request.payment_line_id is not null and not exists(select 1 from private.payment_lines l
          where l.id = request.payment_line_id and l.status = 'open'))
        or internal.refund_renewal_waiting(request.payment_id, request.payment_line_id)
        or (request.reason_code = 'renewal_cancelled_before_start'
          and not internal.refund_renewal_not_started(request.payment_id, request.payment_line_id)) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'payment_changed' where id = request.id returning * into request;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
      return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
    end if;
    -- Ozow's refund window passed before it was sent: nothing goes to Ozow and
    -- staff pay it back by bank transfer (it is listed under 'Refunds that need
    -- staff'). Expected, so it raises no payment problem alert.
    if not internal.ozow_refund_window_open(request.payment_id) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'outside_refund_window' where id = request.id returning * into request;
      return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
    end if;
    update private.payment_refund_requests set status = 'sent', sent_at = statement_timestamp(), send_attempts = 1,
      last_send_at = statement_timestamp(), send_outcome = 'unknown' where id = request.id returning * into request;
  elsif request.status = 'sent' and request.send_outcome = 'unknown' and request.ozow_refund_id is null
      and request.send_attempts < 3 and request.last_send_at <= statement_timestamp() - interval '30 minutes'
      and request.sent_at > statement_timestamp() - interval '6 hours' then
    update private.payment_refund_requests set send_attempts = send_attempts + 1, last_send_at = statement_timestamp()
      where id = request.id returning * into request;
  else
    return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
  end if;
  return jsonb_build_object('request_id', request.id, 'claimed', true, 'status', request.status,
    'attempt', request.send_attempts, 'sent_at', request.sent_at, 'idempotency_key', request.ozow_reference,
    'transaction_id', request.ozow_transaction_id, 'amount_cents', request.amount_cents,
    'reason_code', request.reason_code);
end;
$function$;
revoke all on function internal.claim_ozow_refund_send(uuid) from public;
grant execute on function internal.claim_ozow_refund_send(uuid) to service_role;

drop function if exists internal.apply_staff_refund(uuid,uuid);
drop function if exists internal.staff_refund_result(private.payment_refund_requests,boolean);
drop function if exists internal.refund_left_cents(uuid,uuid);
drop function if exists internal.assert_first_purchase_refund(uuid,date);
drop function if exists internal.payment_is_first_purchase(uuid);
drop function if exists internal.first_purchase_last_ask_day(timestamp with time zone);
drop function if exists internal.za_business_day(date);
drop function if exists internal.za_public_holiday(date);

alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_first_purchase,
  drop constraint if exists payment_refund_requests_keeps_days,
  drop constraint if exists payment_refund_requests_reason_code_check,
  add constraint payment_refund_requests_reason_code_check check (reason_code = any (array['billing_error'::text,
    'duplicate'::text, 'our_failure_after_fix_offered'::text, 's14_cancellation'::text, 'breach_credit'::text,
    'renewal_cancelled_before_start'::text]));
drop index if exists private.payment_refund_requests_request_idx;
alter table private.payment_refund_requests drop column if exists request_id,
  drop column if exists customer_asked_on,
  drop column if exists ends_paid_days;

commit;
