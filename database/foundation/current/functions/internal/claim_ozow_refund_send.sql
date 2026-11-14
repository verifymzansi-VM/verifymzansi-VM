-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
    if (select p.status from private.payments p where p.id = request.payment_id) is distinct from 'complete'
        or internal.ozow_refund_transaction(request.payment_id) is distinct from request.ozow_transaction_id
        or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = request.payment_id)
        or (request.payment_line_id is null and exists(select 1 from private.payment_lines l
          where l.payment_id = request.payment_id and l.status = 'reversed'))
        or (request.payment_line_id is not null and not exists(select 1 from private.payment_lines l
          where l.id = request.payment_line_id and l.status = 'open')) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'payment_changed' where id = request.id returning * into request;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
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
alter function internal.claim_ozow_refund_send(uuid) owner to postgres;
revoke all on function internal.claim_ozow_refund_send(uuid) from public;
grant execute on function internal.claim_ozow_refund_send(uuid) to service_role;
