-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_refund_result(p_request private.payment_refund_requests, p_repeated boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', p_request.id, 'status', p_request.status, 'channel', p_request.channel,
    'kind', p_request.kind, 'line_id', p_request.payment_line_id, 'amount_cents', p_request.amount_cents,
    'needs_approval', p_request.needs_approval, 'ends_paid_days', p_request.ends_paid_days,
    'released_activations', p_request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = p_request.payment_id),
    'repeated', p_repeated);
$function$;
alter function internal.staff_refund_result(private.payment_refund_requests,boolean) owner to postgres;
revoke all on function internal.staff_refund_result(private.payment_refund_requests,boolean) from public;
