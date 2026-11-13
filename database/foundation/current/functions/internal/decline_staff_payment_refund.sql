-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decline_staff_payment_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'refund request and reason required' using errcode='22023';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  perform internal.assert_staff_acts_for_other(actor, request.account_id, 'reversal');
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_acts_for_other(actor, request.account_id, 'reversal');
  if request.status = 'declined' and request.declined_by = actor and request.decline_reason = btrim(p_reason) then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'repeated', true);
  end if;
  if request.status <> 'awaiting_approval' then
    raise exception 'this refund is no longer waiting for approval' using errcode='PT409', detail='refund_not_waiting';
  end if;
  update private.payment_refund_requests set status = 'declined', declined_by = actor,
    declined_at = statement_timestamp(), decline_reason = btrim(p_reason)
    where id = request.id;
  return jsonb_build_object('request_id', request.id, 'status', 'declined', 'repeated', false);
end;
$function$;
alter function internal.decline_staff_payment_refund(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_payment_refund(uuid,text) from public;
grant execute on function internal.decline_staff_payment_refund(uuid,text) to authenticated;
