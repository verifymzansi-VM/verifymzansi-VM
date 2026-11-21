-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_sales_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('payments:view'); now_at timestamptz := statement_timestamp();
  result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now_at,
    'vat', internal.vat_sales_position(),
    -- Payments paid in the last 12 months, by product and term, net of refunds.
    'products', (select coalesce(jsonb_agg(jsonb_build_object('category', g.category,
        'term_days', g.term_days, 'payments', g.payments, 'net_cents', g.net_cents)
        order by g.net_cents desc, g.category, g.term_days), '[]'::jsonb)
      from (select x.category, x.term_days, count(*) as payments, sum(x.net)::bigint as net_cents
        from (select internal.payment_net_cents(p) as net,
            case when p.product_kind = 'addon' then 'add_on'
              when internal.slot_package_plan(v.plan_code) then 'package'
              when left(v.plan_code, 11) = 'individual_' then 'individual'
              else 'other' end as category,
            v.duration_days as term_days
          from private.payments p left join private.plan_versions v on v.id = p.plan_version_id
          where p.status in ('complete', 'refunded', 'chargeback')
            and p.completed_at > now_at - interval '12 months') x
        group by x.category, x.term_days) g),
    -- Online (Ozow) checkouts started in the last 30 days and how each ended.
    'checkouts', (select jsonb_build_object('days', 30, 'started', count(*),
        'paid', count(*) filter (where p.status in ('complete', 'refunded', 'chargeback')),
        'failed', count(*) filter (where p.status = 'failed'),
        'cancelled', count(*) filter (where p.status = 'cancelled'),
        'expired', count(*) filter (where p.status = 'expired'),
        'open', count(*) filter (where p.status = 'pending'))
      from private.payments p where p.provider = 'ozow' and p.created_at > now_at - interval '30 days'))
  into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_sales_summary() owner to postgres;
revoke all on function internal.get_staff_sales_summary() from public;
grant execute on function internal.get_staff_sales_summary() to authenticated;
