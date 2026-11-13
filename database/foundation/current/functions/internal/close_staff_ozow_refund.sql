-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_staff_ozow_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'refund request and reason required' using errcode='22023';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must close this refund' using errcode='42501', detail='refund_closer_same';
  end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  perform internal.lock_evidence_subject(request.account_id);
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must close this refund' using errcode='42501', detail='refund_closer_same';
  end if;
  if request.status = 'failed' and request.failure_reason = 'closed_by_staff' and request.closed_by = actor
      and request.close_reason = btrim(p_reason) then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'repeated', true);
  end if;
  if not coalesce((request.status = 'approved' and request.send_attempts = 0)
      or (request.status = 'sent' and request.ozow_refund_id is null and request.send_outcome = 'unknown'
        and request.sent_at < statement_timestamp() - interval '1 day'
        and request.ozow_missing_at is not null
        and request.ozow_missing_at >= request.sent_at + interval '1 day'), false) then
    raise exception 'only a refund that never reached Ozow can be closed' using errcode='PT409', detail='refund_not_closable';
  end if;
  update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
    failure_reason = 'closed_by_staff', closed_by = actor, close_reason = btrim(p_reason)
    where id = request.id;
  return jsonb_build_object('request_id', request.id, 'status', 'failed', 'repeated', false);
end;
$function$;
alter function internal.close_staff_ozow_refund(uuid,text) owner to postgres;
revoke all on function internal.close_staff_ozow_refund(uuid,text) from public;
grant execute on function internal.close_staff_ozow_refund(uuid,text) to authenticated;
