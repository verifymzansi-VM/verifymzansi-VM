-- Reviewed rollback for updates/20261113151748_ozow_api_refunds.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert and deploy the website
-- release that uses the update FIRST (or leave OZOW_API_REFUNDS_ENABLED off):
-- this rollback removes the commands that release calls while refunds through
-- Ozow are switched on.
--
-- It works only while no refund was made through Ozow or recorded from the
-- Ozow dashboard and no refund problem was recorded: it refuses (55000) once
-- private.payment_refund_requests has a record of channel 'api' or
-- 'dashboard', or private.payment_problems has a refund reason or source,
-- because those are payment audit records. After that, fix forward.
--
-- It puts back the five function bodies the update replaced (the refund record
-- guard, the money-returned sum, the approval of a waiting refund, the
-- reversal guard and the payment problem record), drops the update's 31 new
-- functions, its indexes, constraints and columns, and puts back the earlier
-- status, approver, payment problem reason and source constraints. Payments,
-- slots, entitlements, commissions and every existing refund record keep their
-- data.
begin;
set local lock_timeout='5s';

lock table private.payment_refund_requests in exclusive mode;
lock table private.payment_problems in exclusive mode;

do $$
declare records bigint; problems bigint;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.request_staff_ozow_refund(uuid,uuid,text,text)')) is distinct from 'cf120b37f56a25599011105d66e1a94b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid)')) is distinct from 'ffa1f756f16316681ddce6d0d213db55'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_ozow_refunds(uuid[])')) is distinct from '09755b758fde6141a93a2afc7ee43ece'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.claim_ozow_refund_send(uuid)')) is distinct from '436a4f6cf0ad64bc3c1eabc1bc079b2a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.list_ozow_refund_sends_due(integer)')) is distinct from '410a5f50adefa396587ac5045f80e326'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_ozow_refund_send(uuid,jsonb)')) is distinct from 'de2a72c4eaf64a58d7c4917b76cb0208'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.apply_ozow_refund_status(jsonb)')) is distinct from 'cb0b3fd2432f28aedac7dcbdf7d1a2cb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.reconcile_ozow_refunds(jsonb)')) is distinct from 'ea40cc8571dab987fcb5b49d9f27ba53'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.claim_ozow_refund_checks(integer)')) is distinct from 'af55530f14c06e80b56017c55d407725'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.report_ozow_refund_missing(uuid)')) is distinct from 'dc4ee76940d144ff60fcbca0cc0d1f72'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.close_staff_ozow_refund(uuid,text)')) is distinct from '916b8177461b733dbab5060a07f8e5e1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_ozow_refund_checks(integer)')) is distinct from 'd7716a64d8e175e14cd35f23a4cf0963'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.report_ozow_refund_missing(uuid)')) is distinct from 'b7ae6c2deac0c275b3bad89dec3c81fb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.close_staff_ozow_refund(uuid,text)')) is distinct from '5b7a8a8d3f7bd430e0024fb2088338c3'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamptz)')) is distinct from 'f73ba1c23d33d6a03ad992fd34c71d8c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.request_staff_ozow_refund(uuid,uuid,text,text)')) is distinct from 'fc7b44826c2e9631294794decac9211d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid)')) is distinct from 'a0b442a5376baedc71e8c7c381d8b8e0'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid)')) is distinct from 'aebd7c14f574e08bf42353ca8a4293fe'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_staff_ozow_refunds(uuid[])')) is distinct from 'ed9a446630dda6bdda7c78248da278a6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_ozow_refund_view(private.payment_refund_requests,uuid)')) is distinct from 'c4ff0e12f1bfde14f2a0d7d1d5800a9c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_ozow_refund_send(uuid)')) is distinct from '54a567cdb0016c98ce2748f222c8e342'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.list_ozow_refund_sends_due(integer)')) is distinct from '64ead03337cca707f3dd17c50b62bec8'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_ozow_refund_send(uuid,jsonb)')) is distinct from '9e3bafab54e36843cc570cf196e9babf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.apply_ozow_refund_status(jsonb)')) is distinct from '11d425d5feb78204959f069cb5e044ae'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reconcile_ozow_refunds(jsonb)')) is distinct from '218a119128346ee7df387e651494eef1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.apply_ozow_refund_state(uuid,text,timestamptz,timestamptz,text)')) is distinct from '431e2541a83cf8e892efd61aa5cacd4d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.valid_ozow_refund_fact(jsonb)')) is distinct from '023cde0ed9da4adc588737b40751899d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.ozow_transaction_payment(uuid)')) is distinct from 'bfeb28fb4e3eea65fd4b51c3e3e2a0fa'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.ozow_refund_problem(uuid,text,text,text)')) is distinct from '8c7462925151c5f8f040162fb6263dc6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment_line(uuid,text,text,uuid)')) is distinct from '3f95168e1faacac2ca6f1431962c182c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.ozow_refund_transaction(uuid)')) is distinct from '936ee7437cc4a204e8357e840d103b0b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refund_request_guard()')) is distinct from 'c220af13b94b20251d36a33fe643e427'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refunded_before_cents(uuid)')) is distinct from 'edcb14caf62c8375f0216d828ecc276d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.approve_staff_payment_refund(uuid)')) is distinct from 'df4585dd0d0c12f4fbf2e76d9e70a553'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_reversal_waiting_guard()')) is distinct from 'd994c95ef0874bb69be72b4e54666ae7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_payment_problem(uuid,text,text,boolean,text)')) is distinct from '73a0ff98c9e3f2003e76349481435cba'
    or not exists (select 1 from pg_attribute a where a.attrelid = 'private.payment_refund_requests'::regclass
      and a.attname = 'channel' and not a.attisdropped) then
    raise exception 'rollback precondition: the ozow api refunds update is not applied' using errcode='55000';
  end if;
  select count(*) into records from private.payment_refund_requests where channel <> 'manual';
  select count(*) into problems from private.payment_problems
    where reason like 'refund\_%' or source like 'refund\_%';
  if records > 0 or problems > 0 then
    raise exception 'rollback precondition: refunds through Ozow were used (% records, % refund problems); fix forward with a new update',
      records, problems using errcode='55000';
  end if;
end$$;

-- The update's functions (the API commands first).
drop function if exists api.request_staff_ozow_refund(uuid,uuid,text,text);
drop function if exists api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid);
drop function if exists api.get_staff_ozow_refunds(uuid[]);
drop function if exists api.claim_ozow_refund_send(uuid);
drop function if exists api.list_ozow_refund_sends_due(integer);
drop function if exists api.record_ozow_refund_send(uuid,jsonb);
drop function if exists api.apply_ozow_refund_status(jsonb);
drop function if exists api.reconcile_ozow_refunds(jsonb);
drop function if exists api.claim_ozow_refund_checks(integer);
drop function if exists api.report_ozow_refund_missing(uuid);
drop function if exists api.close_staff_ozow_refund(uuid,text);
drop function if exists internal.claim_ozow_refund_checks(integer);
drop function if exists internal.report_ozow_refund_missing(uuid);
drop function if exists internal.close_staff_ozow_refund(uuid,text);
drop function if exists internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamptz);
drop function if exists internal.request_staff_ozow_refund(uuid,uuid,text,text);
drop function if exists internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid);
drop function if exists internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid);
drop function if exists internal.get_staff_ozow_refunds(uuid[]);
drop function if exists internal.staff_ozow_refund_view(private.payment_refund_requests,uuid);
drop function if exists internal.claim_ozow_refund_send(uuid);
drop function if exists internal.list_ozow_refund_sends_due(integer);
drop function if exists internal.record_ozow_refund_send(uuid,jsonb);
drop function if exists internal.apply_ozow_refund_status(jsonb);
drop function if exists internal.reconcile_ozow_refunds(jsonb);
drop function if exists internal.apply_ozow_refund_state(uuid,text,timestamptz,timestamptz,text);
drop function if exists internal.valid_ozow_refund_fact(jsonb);
drop function if exists internal.ozow_transaction_payment(uuid);
drop function if exists internal.ozow_refund_problem(uuid,text,text,text);
drop function if exists internal.reverse_payment_line(uuid,text,text,uuid);
drop function if exists internal.ozow_refund_transaction(uuid);

-- The five functions the update replaced, as they were.
CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The request, its reference, amount and account never change; a request
  -- waiting for approval is applied or declined once (an approval then stores
  -- the released activations once), and the account is always the one that
  -- paid.
  if tg_op = 'INSERT' then
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id)
      or new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    return new;
  end if;
  if old.status = 'applied' and new.status = 'applied' and old.released_activations is null
      and new.released_activations is not null
      and (to_jsonb(new) - 'released_activations') = (to_jsonb(old) - 'released_activations') then
    return new;
  end if;
  if (to_jsonb(new) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
      is distinct from (to_jsonb(old) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
    or old.status <> 'awaiting_approval' or new.status not in ('applied', 'declined') then
    raise exception 'refund records are immutable; a waiting refund is applied or declined once' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_request_guard() owner to postgres;
revoke all on function internal.payment_refund_request_guard() from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.payment_refunded_before_cents(p_payment_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
      where r.payment_id = p_payment_id and r.status in ('applied', 'awaiting_approval')), 0)
    + coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p_payment_id and l.status = 'reversed'
        and not exists(select 1 from private.payment_refund_requests r
          where r.status = 'applied' and r.payment_id = p_payment_id
            and (r.payment_line_id = l.id or r.payment_line_id is null))), 0)::bigint;
$function$;
alter function internal.payment_refunded_before_cents(uuid) owner to postgres;
revoke all on function internal.payment_refunded_before_cents(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.payment_reversal_waiting_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare payment uuid := (case when tg_table_name = 'payments' then to_jsonb(new)->>'id'
  else to_jsonb(new)->>'payment_id' end)::uuid;
begin
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  return new;
end;
$function$;
alter function internal.payment_reversal_waiting_guard() owner to postgres;
revoke all on function internal.payment_reversal_waiting_guard() from public, anon, authenticated, service_role;

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
  perform internal.lock_evidence_subject(request.account_id);
  select * into pay from private.payments p where p.id = request.payment_id for update;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  if request.status = 'applied' and request.approved_by = actor then
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
      and not exists(select 1 from private.payment_lines l where l.id = request.payment_line_id and l.status = 'open')) then
    raise exception 'the payment changed since this refund was recorded; decline it and record it again'
      using errcode='PT409', detail='refund_payment_changed';
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
alter function internal.approve_staff_payment_refund(uuid) owner to postgres;
revoke all on function internal.approve_staff_payment_refund(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean, p_transaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare problem private.payment_problems; alert boolean; raise_now boolean; rearm boolean;
begin
  if p_reason is null or p_reason not in (
      'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
      'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
      'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
      'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
      'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
      'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
      'multiple_settlements')
    or p_source is null or p_source not in ('notice', 'status_check') or p_alert is null
    or length(p_transaction) not between 1 and 100 then
    raise exception 'invalid payment problem' using errcode='22023';
  end if;
  if p_payment_id is not null and not exists(select 1 from private.payments p where p.id=p_payment_id) then
    raise exception 'payment problem names no payment' using errcode='22023';
  end if;
  -- Only a problem with a known payment can be emailed about.
  alert := p_alert and p_payment_id is not null;
  insert into private.payment_problems(payment_id, reason, source, needs_alert, alert_raised_at, alert_transaction)
    values (p_payment_id, p_reason, p_source, alert, case when alert then clock_timestamp() end,
      case when alert then p_transaction end)
    on conflict on constraint payment_problems_once do nothing
    returning * into problem;
  if found then
    return jsonb_build_object('id',problem.id,'new',true,'alert',problem.needs_alert,'raised',problem.needs_alert);
  end if;
  select * into problem from private.payment_problems p
    where p.reason=p_reason
      and (p.payment_id=p_payment_id or (p_payment_id is null and p.payment_id is null))
    for update;
  -- Seen before: the first source and first time stay; the mark only rises.
  -- Once emailed, a marked repeat from another Ozow transaction raises it
  -- again (at most 5 times); the same transaction never does.
  raise_now := alert and not problem.needs_alert;
  rearm := alert and problem.needs_alert and problem.alerted_at is not null and p_transaction is not null
    and problem.alert_transaction is distinct from p_transaction and problem.alert_rearms<5;
  update private.payment_problems p set last_seen_at=clock_timestamp(),
      occurrences=least(p.occurrences,2147483646)+1,
      needs_alert=p.needs_alert or alert,
      alert_raised_at=case when raise_now or rearm then clock_timestamp() else p.alert_raised_at end,
      alert_transaction=case when raise_now or rearm then p_transaction else p.alert_transaction end,
      alert_rearms=p.alert_rearms+case when rearm then 1 else 0 end,
      alerted_at=case when rearm then null else p.alerted_at end,
      alert_claim=case when rearm then null else p.alert_claim end,
      alert_claimed_until=case when rearm then null else p.alert_claimed_until end,
      alert_snapshot=case when rearm then null else p.alert_snapshot end
    where p.id=problem.id
    returning * into problem;
  return jsonb_build_object('id',problem.id,'new',false,'alert',problem.needs_alert,'raised',raise_now or rearm);
end;
$function$;
alter function internal.record_payment_problem(uuid,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_payment_problem(uuid,text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean,text) to service_role;

-- Refund records: the update's indexes, constraints and columns.
drop index if exists private.payment_refund_requests_ozow_refund_idx;
drop index if exists private.payment_refund_requests_in_flight_idx;
drop index if exists private.payment_refund_requests_ozow_key_idx;
drop index if exists private.payment_refund_requests_transaction_idx;
drop index if exists private.payment_refund_requests_send_due_idx;
drop index if exists private.payment_refund_requests_closed_by_idx;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_channel_check;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_channel_rule;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_send_state;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_ozow_status_check;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_failed;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_returned;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_closed;
alter table private.payment_refund_requests drop constraint payment_refund_requests_status_check;
alter table private.payment_refund_requests add constraint payment_refund_requests_status_check
  check (status in ('awaiting_approval', 'applied', 'declined'));
alter table private.payment_refund_requests drop constraint payment_refund_requests_approver;
alter table private.payment_refund_requests add constraint payment_refund_requests_approver check (case when status = 'applied' and needs_approval
    then approved_by is not null and approved_by <> requested_by else approved_by is null end);
alter table private.payment_refund_requests
  drop column channel,
  drop column approved_at,
  drop column ozow_transaction_id,
  drop column ozow_refund_id,
  drop column ozow_status,
  drop column ozow_status_at,
  drop column ozow_requested_at,
  drop column ozow_completed_at,
  drop column sent_at,
  drop column send_attempts,
  drop column last_send_at,
  drop column send_outcome,
  drop column failed_at,
  drop column failure_reason,
  drop column returned_at,
  drop column ozow_checked_at,
  drop column ozow_missing_at,
  drop column closed_by,
  drop column close_reason;

-- Payment problems: the earlier reason and source lists.
alter table private.payment_problems drop constraint payment_problems_reason_check;
alter table private.payment_problems add constraint payment_problems_reason_check check (reason in (
  'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch', 'test_mode_mismatch',
  'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch', 'currency_mismatch', 'missing_amount',
  'missing_currency', 'amount_mismatch', 'invalid_json', 'missing_merchant_reference', 'missing_transaction_status',
  'unknown_payment', 'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
  'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion', 'multiple_settlements'));
alter table private.payment_problems drop constraint payment_problems_source_check;
alter table private.payment_problems add constraint payment_problems_source_check check (source in (
  'notice', 'status_check'));

commit;
