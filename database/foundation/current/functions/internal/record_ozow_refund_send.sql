-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_ozow_refund_send(p_request_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid; kind text; outcome text;
begin
  if p_request_id is null or jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'refund send result required' using errcode='22023';
  end if;
  kind := p_result->>'outcome';
  if kind is null or kind not in ('accepted', 'refused', 'unknown')
      or (kind = 'accepted' and not internal.valid_ozow_refund_fact(p_result))
      or (kind = 'refused' and coalesce(p_result->>'failure_reason', '') not in ('ozow_refused', 'ozow_auth')) then
    raise exception 'valid refund send result required' using errcode='22023';
  end if;
  select r.payment_id into payment from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(r.account_id) from private.payment_refund_requests r where r.id = p_request_id;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.send_attempts = 0 then
    raise exception 'this refund was not sent' using errcode='PT409', detail='refund_not_sent';
  end if;
  if kind = 'accepted' then
    if (p_result->>'transaction_id')::uuid is distinct from request.ozow_transaction_id
        or (p_result->>'amount_cents')::bigint is distinct from request.amount_cents
        or (request.ozow_refund_id is not null and request.ozow_refund_id <> (p_result->>'refund_id')::uuid)
        or exists(select 1 from private.payment_refund_requests r where r.id <> request.id
          and (r.ozow_refund_id = (p_result->>'refund_id')::uuid or lower(r.ozow_reference) = p_result->>'refund_id')) then
      perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', 'refund_send', request.id::text);
      return jsonb_build_object('request_id', request.id, 'outcome', 'mismatch', 'status', request.status,
        'ozow_refund_id', request.ozow_refund_id, 'ozow_status', request.ozow_status);
    end if;
    if request.ozow_refund_id is null then
      update private.payment_refund_requests set ozow_refund_id = (p_result->>'refund_id')::uuid,
        send_outcome = 'accepted' where id = request.id returning * into request;
    end if;
    outcome := internal.apply_ozow_refund_state(request.id, p_result->>'status',
      (p_result->>'requested_at')::timestamptz, (p_result->>'completed_at')::timestamptz, 'refund_send');
  elsif kind = 'refused' and request.status = 'sent' and request.ozow_refund_id is null
      and request.send_outcome = 'unknown' and request.send_attempts = 1 then
    update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
      failure_reason = p_result->>'failure_reason', send_outcome = 'refused' where id = request.id;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
    outcome := 'failed';
  elsif request.status = 'sent' and request.ozow_refund_id is null and request.send_outcome = 'unknown'
      and (kind = 'refused' or request.send_attempts >= 3) then
    if kind = 'refused' then
      update private.payment_refund_requests set send_attempts = 3 where id = request.id;
    end if;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_stuck', 'refund_send', request.id::text);
    outcome := 'stuck';
  else
    outcome := 'unchanged';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  return jsonb_build_object('request_id', request.id, 'outcome', outcome, 'status', request.status,
    'ozow_refund_id', request.ozow_refund_id, 'ozow_status', request.ozow_status);
end;
$function$;
alter function internal.record_ozow_refund_send(uuid,jsonb) owner to postgres;
revoke all on function internal.record_ozow_refund_send(uuid,jsonb) from public;
grant execute on function internal.record_ozow_refund_send(uuid,jsonb) to service_role;
