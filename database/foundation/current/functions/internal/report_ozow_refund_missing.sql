-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.report_ozow_refund_missing(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid;
begin
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select r.payment_id into payment from private.payment_refund_requests r
    where r.id = p_request_id and r.channel in ('api', 'dashboard');
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.channel = 'api' and request.status <> 'sent' then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'reported', false);
  end if;
  update private.payment_refund_requests set ozow_missing_at = statement_timestamp() where id = request.id;
  perform internal.ozow_refund_problem(request.payment_id,
    case when request.ozow_refund_id is null then 'refund_stuck' else 'refund_mismatch' end, 'refund_check',
    request.id::text);
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'reported', true);
end;
$function$;
alter function internal.report_ozow_refund_missing(uuid) owner to postgres;
revoke all on function internal.report_ozow_refund_missing(uuid) from public;
grant execute on function internal.report_ozow_refund_missing(uuid) to service_role;
