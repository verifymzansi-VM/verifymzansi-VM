-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.record_payment_problem(uuid,text,text,boolean,text) from public;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean,text) to service_role;
