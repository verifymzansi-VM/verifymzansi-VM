-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare problem private.payment_problems; alert boolean;
begin
  if p_reason is null or p_reason not in (
      'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
      'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
      'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
      'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
      'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
      'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
      'multiple_settlements')
    or p_source is null or p_source not in ('notice', 'status_check') or p_alert is null then
    raise exception 'invalid payment problem' using errcode='22023';
  end if;
  if p_payment_id is not null and not exists(select 1 from private.payments p where p.id=p_payment_id) then
    raise exception 'payment problem names no payment' using errcode='22023';
  end if;
  -- Only a problem with a known payment can be emailed about.
  alert := p_alert and p_payment_id is not null;
  insert into private.payment_problems(payment_id, reason, source, needs_alert)
    values (p_payment_id, p_reason, p_source, alert)
    on conflict on constraint payment_problems_once do nothing
    returning * into problem;
  if found then
    return jsonb_build_object('id',problem.id,'new',true,'alert',problem.needs_alert);
  end if;
  -- Seen before: the first source and first time stay; the mark only rises.
  update private.payment_problems p set last_seen_at=clock_timestamp(),
      occurrences=least(p.occurrences,2147483646)+1, needs_alert=p.needs_alert or alert
    where p.reason=p_reason
      and (p.payment_id=p_payment_id or (p_payment_id is null and p.payment_id is null))
    returning * into problem;
  return jsonb_build_object('id',problem.id,'new',false,'alert',coalesce(problem.needs_alert,false));
end;
$function$;
alter function internal.record_payment_problem(uuid,text,text,boolean) owner to postgres;
revoke all on function internal.record_payment_problem(uuid,text,text,boolean) from public;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean) to service_role;
