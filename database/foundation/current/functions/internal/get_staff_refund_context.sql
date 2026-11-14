-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_refund_context(p_payment_id uuid, p_line_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  if (p_payment_id is null) = (p_request_id is null) or (p_line_id is not null and p_payment_id is null) then
    raise exception 'a payment or a refund request required' using errcode='22023';
  end if;
  if p_payment_id is not null then
    select jsonb_build_object('ozow_transaction_id', internal.ozow_refund_transaction(p.id),
        'amount_cents', coalesce(l.amount_cents, p.amount_cents))
      into result
      from private.payments p left join private.payment_lines l on l.id = p_line_id and l.payment_id = p.id
      where p.id = p_payment_id and (p_line_id is null or l.id is not null);
  else
    select jsonb_build_object('channel', r.channel, 'status', r.status, 'ozow_checked', r.ozow_status is not null,
        'ozow_missing', r.ozow_missing_at is not null)
      into result
      from private.payment_refund_requests r where r.id = p_request_id;
  end if;
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_refund_context(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.get_staff_refund_context(uuid,uuid,uuid) from public;
grant execute on function internal.get_staff_refund_context(uuid,uuid,uuid) to authenticated;
