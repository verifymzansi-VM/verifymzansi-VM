-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_refunds_left(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payments required' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id,
      'refunded_cents', internal.payment_refunded_before_cents(p.id),
      'left_cents', case when p.status = 'complete' then internal.refund_left_cents(p.id, null) else 0 end,
      'ozow_refund_until', case when internal.ozow_refund_transaction(p.id) is not null
        then p.created_at + internal.ozow_refund_window() end,
      'first_purchase', internal.payment_is_first_purchase(p.id),
      'first_purchase_ask_until', case when internal.payment_is_first_purchase(p.id)
        then internal.first_purchase_last_ask_day(p.completed_at) end,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id,
          'left_cents', case when p.status = 'complete' and l.status = 'open'
            then internal.refund_left_cents(p.id, l.id) else 0 end,
          'starts_at', (select min(e.starts_at) from private.entitlements e where e.payment_line_id = l.id),
          'ends_at', (select max(e.ends_at) from private.entitlements e where e.payment_line_id = l.id))
        order by l.line_number) from private.payment_lines l where l.payment_id = p.id), '[]'::jsonb))
    order by p.id), '[]'::jsonb)
    into result
    from private.payments p where p.id = any(p_payment_ids);
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_refunds_left(uuid[]) owner to postgres;
revoke all on function internal.get_staff_refunds_left(uuid[]) from public;
grant execute on function internal.get_staff_refunds_left(uuid[]) to authenticated;
