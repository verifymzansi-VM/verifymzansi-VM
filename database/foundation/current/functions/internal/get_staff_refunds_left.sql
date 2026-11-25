-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_refunds_left(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb; counted integer := 0;
  notice_end date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payments required' using errcode='22023';
  end if;
  -- The end of 20 business days' notice given today (section 14), for the
  -- unused-days hint (20261125194727_part_refund_follow_ups.sql).
  while counted < 20 loop
    notice_end := notice_end + 1;
    if internal.za_business_day(notice_end) then counted := counted + 1; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id,
      'refunded_cents', internal.payment_refunded_before_cents(p.id),
      -- A payment with a reversed slot is refunded slot by slot only.
      'left_cents', case when p.status = 'complete' and not exists(select 1 from private.payment_lines l
          where l.payment_id = p.id and l.status = 'reversed')
        then internal.refund_left_cents(p.id, null) else 0 end,
      'notice_ends_on', notice_end,
      'ozow_refund_until', case when internal.ozow_refund_transaction(p.id) is not null
        then p.created_at + internal.ozow_refund_window() end,
      'first_purchase', internal.payment_is_first_purchase(p.id),
      'first_purchase_ask_until', case when internal.payment_is_first_purchase(p.id)
        then internal.first_purchase_last_ask_day(p.completed_at) end,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id,
          'left_cents', case when p.status = 'complete' and l.status = 'open'
            then internal.refund_left_cents(p.id, l.id) else 0 end,
          'starts_at', (select min(e.starts_at) from private.entitlements e where e.payment_line_id = l.id),
          'ends_at', (select max(e.ends_at) from private.entitlements e where e.payment_line_id = l.id),
          -- The plan's own term, and the free lost days added to the slot.
          'paid_days', (select v.duration_days from private.plan_versions v where v.id = l.plan_version_id),
          'lost_days', (select coalesce(max(t.days), 0) from (select sum(a.days) as days
              from private.lost_day_additions a join private.entitlements e on e.id = a.entitlement_id
              where e.payment_line_id = l.id group by a.entitlement_id) t))
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
