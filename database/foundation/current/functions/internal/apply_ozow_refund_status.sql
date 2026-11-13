-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_status(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare refund uuid; transaction uuid; amount bigint; request private.payment_refund_requests;
  payment uuid; outcome text; source text;
begin
  source := p_event->>'source';
  if not internal.valid_ozow_refund_fact(p_event) or source is null or source not in ('refund_notice', 'refund_check') then
    raise exception 'valid Ozow refund status required' using errcode='22023';
  end if;
  refund := (p_event->>'refund_id')::uuid;
  transaction := (p_event->>'transaction_id')::uuid;
  amount := (p_event->>'amount_cents')::bigint;
  -- A refund recorded with a typed reference (Ozow's refund id) is known; the
  -- record cannot carry Ozow's status, so only a failure or return alerts.
  select * into request from private.payment_refund_requests r
    where r.channel = 'manual' and lower(r.ozow_reference) = refund::text
    order by (r.status = 'declined'), r.requested_at desc limit 1;
  if found then
    -- Typed on another payment than the one Ozow refunded, or Ozow pays a
    -- refund whose record was declined: staff must look.
    if internal.ozow_refund_transaction(request.payment_id) is distinct from transaction
        or (request.status = 'declined' and p_event->>'status' not in ('Failed', 'Cancelled', 'Invalid', 'Error')) then
      perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', source, request.id::text);
      return jsonb_build_object('outcome', 'mismatch', 'request_id', request.id, 'status', request.status,
        'ozow_status', null);
    end if;
    if p_event->>'status' in ('Failed', 'Cancelled', 'Invalid', 'Error', 'Returned') and request.status = 'applied' then
      perform internal.ozow_refund_problem(request.payment_id,
        case when p_event->>'status' = 'Returned' then 'refund_returned' else 'refund_failed' end, source, request.id::text);
      return jsonb_build_object('outcome', 'flagged', 'request_id', request.id, 'status', request.status,
        'ozow_status', null);
    end if;
    return jsonb_build_object('outcome', 'recorded', 'request_id', request.id, 'status', request.status,
      'ozow_status', null);
  end if;
  -- The record with this id that took effect or may still; else the one lost
  -- send it fits; else a declined record with this id (Ozow's status then
  -- only alerts staff).
  select r.payment_id into payment from private.payment_refund_requests r
    where r.ozow_refund_id = refund and r.status <> 'declined';
  if payment is null then
    select r.payment_id into payment from private.payment_refund_requests r
      where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
        (p_event->>'requested_at')::timestamptz);
  end if;
  if payment is null then
    select r.payment_id into payment from private.payment_refund_requests r
      where r.ozow_refund_id = refund order by r.requested_at desc limit 1;
  end if;
  if payment is null then
    perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
      refund::text);
    return jsonb_build_object('outcome', 'unmatched');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(p.owner_id) from private.payments p where p.id = payment;
  select * into request from private.payment_refund_requests r
    where r.ozow_refund_id = refund and r.status <> 'declined' for update;
  if not found then
    select * into request from private.payment_refund_requests r
      where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
        (p_event->>'requested_at')::timestamptz) and r.payment_id = payment
      for update;
    if found then
      update private.payment_refund_requests set ozow_refund_id = refund, send_outcome = 'accepted'
        where id = request.id returning * into request;
    else
      select * into request from private.payment_refund_requests r
        where r.ozow_refund_id = refund and r.payment_id = payment order by r.requested_at desc limit 1 for update;
    end if;
    if not found then
      perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
        refund::text);
      return jsonb_build_object('outcome', 'unmatched');
    end if;
  end if;
  if request.ozow_transaction_id is distinct from transaction or request.amount_cents <> amount then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', source, request.id::text);
    return jsonb_build_object('outcome', 'mismatch', 'request_id', request.id);
  end if;
  outcome := internal.apply_ozow_refund_state(request.id, p_event->>'status', (p_event->>'requested_at')::timestamptz,
    (p_event->>'completed_at')::timestamptz, source);
  select * into request from private.payment_refund_requests r where r.id = request.id;
  return jsonb_build_object('outcome', outcome, 'request_id', request.id, 'status', request.status,
    'ozow_status', request.ozow_status);
end;
$function$;
alter function internal.apply_ozow_refund_status(jsonb) owner to postgres;
revoke all on function internal.apply_ozow_refund_status(jsonb) from public;
grant execute on function internal.apply_ozow_refund_status(jsonb) to service_role;
