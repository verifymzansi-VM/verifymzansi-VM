-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_lost_days_preview(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('payments:view');
  v_member uuid;
begin
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'lost days: no active member account has this email' using errcode='PT409',
      detail='lost_days_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_member);
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('kind', g.kind, 'id', g.id, 'slots', g.slots, 'renewals', g.renewals,
        'ends_at', g.ends_at,
        -- Money already returned for days we failed to provide, by applied part
        -- refunds that kept the slot running: of this slot, or of a whole
        -- payment that paid for this slot only (20261125194727_part_refund_follow_ups.sql).
        'refunded_cents', (select coalesce(sum(r.amount_cents), 0) from private.payment_refund_requests r
          where r.kind = 'refunded' and not r.ends_paid_days and r.status = 'applied'
            and exists(select 1 from private.entitlements x where x.id = any(g.grants) and x.payment_id = r.payment_id
              and (r.payment_line_id = x.payment_line_id
                or (r.payment_line_id is null and not exists(select 1 from private.payment_lines o
                  where o.payment_id = r.payment_id and o.line_number > 1))))))
      order by g.ends_at, g.id)
    from (
      select case when bool_and(e.package_id is null) then 'individual' else 'package' end as kind,
        coalesce(e.package_id, e.slot_id, e.id) as id,
        case when bool_and(e.package_id is null) then max(e.slot_capacity) else sum(e.slot_capacity) end::integer as slots,
        (count(*) filter (where e.starts_at>statement_timestamp()))::integer as renewals,
        max(e.ends_at) as ends_at, array_agg(e.id) as grants
      from private.entitlements e
        join private.payments pay on pay.id=e.payment_id and pay.status='complete'
      where e.owner_id=v_member and e.source='retail_paid' and e.status='active'
        and e.ends_at>statement_timestamp()
      group by 2
    ) g), '[]'::jsonb));
end;
$function$;
alter function internal.get_lost_days_preview(text) owner to postgres;
revoke all on function internal.get_lost_days_preview(text) from public;
grant execute on function internal.get_lost_days_preview(text) to authenticated;
