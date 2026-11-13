-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_ozow_refund_view(p_request private.payment_refund_requests, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id', p_request.id, 'payment_id', p_request.payment_id, 'line_id', p_request.payment_line_id,
    'channel', p_request.channel, 'status', p_request.status, 'amount_cents', p_request.amount_cents,
    'reason_code', p_request.reason_code, 'needs_approval', p_request.needs_approval,
    'requested_at', p_request.requested_at, 'approved_at', p_request.approved_at, 'sent_at', p_request.sent_at,
    'applied_at', p_request.applied_at, 'failed_at', p_request.failed_at, 'returned_at', p_request.returned_at,
    'failure_reason', p_request.failure_reason, 'ozow_refund_id', p_request.ozow_refund_id,
    'ozow_status', p_request.ozow_status, 'ozow_status_at', p_request.ozow_status_at,
    'send_outcome', p_request.send_outcome, 'send_attempts', p_request.send_attempts,
    'ozow_missing_at', p_request.ozow_missing_at,
    'requested_by_me', internal.same_identity(p_request.requested_by, p_actor));
$function$;
alter function internal.staff_ozow_refund_view(private.payment_refund_requests,uuid) owner to postgres;
revoke all on function internal.staff_ozow_refund_view(private.payment_refund_requests,uuid) from public;
