-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_staff_refund(p_request_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; result jsonb; c record;
begin
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found or request.status <> 'applied' or request.released_activations is not null then
    raise exception 'only a refund just applied takes effect' using errcode='22023';
  end if;
  if not request.ends_paid_days then
    -- Only money goes back: the slot keeps running (or has already ended).
    if request.account_id is not null then
      insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
      values ('payment_reversed', request.payment_id, request.account_id, 'payment_part_refund:' || request.id);
    end if;
    -- The partner commission of this slot (or of the payment) is reversed, as
    -- a slot reversal does (internal.reverse_payment_line).
    for c in select x.id, p.account_id from private.partner_commissions x join private.partners p on p.id = x.partner_id
        where x.payment_id = request.payment_id
          and (request.payment_line_id is null or x.payment_line_id = request.payment_line_id)
          and x.status <> 'reversed' order by x.id for update of x loop
      update private.partner_commissions set status = 'reversed', reversed_at = statement_timestamp(),
        reversal_reason = 'Payment partly refunded' where id = c.id;
      perform internal.notify_account(c.account_id, 'partner_commission_reversed', c.id, null, null);
    end loop;
    result := jsonb_build_object('status', request.kind, 'released_activations', 0);
  elsif request.payment_line_id is null then
    result := internal.reverse_payment(request.payment_id, request.kind, request.reason);
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (request.payment_id, p_actor, request.kind, request.reason, (result->>'released_activations')::integer);
  else
    result := internal.reverse_payment_line(request.payment_line_id, request.kind, request.reason, p_actor);
  end if;
  update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
    where id = request.id;
  return result;
end;
$function$;
alter function internal.apply_staff_refund(uuid,uuid) owner to postgres;
revoke all on function internal.apply_staff_refund(uuid,uuid) from public;
