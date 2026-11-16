-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
alter function internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) owner to postgres;
revoke all on function internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) from public;
