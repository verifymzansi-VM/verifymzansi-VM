-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_slot_package_offer()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('on_sale', internal.slot_packages_on_sale(),
    'min_slots', 5, 'max_online_slots', 100, 'max_slots', 250, 'online_limit_cents', '1000000',
    'posts_per_slot_per_30_days', 4,
    'plans', case when internal.slot_packages_on_sale() then coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'term_days', v.duration_days, 'price_cents_per_slot', v.price_cents::text, 'label', v.label)
        order by v.duration_days)
      from private.plan_versions v
      where internal.slot_package_plan(v.plan_code) and v.retired_at is null
        and v.version = (select max(x.version) from private.plan_versions x
          where x.plan_code = v.plan_code and x.retired_at is null)), '[]'::jsonb) else '[]'::jsonb end);
$function$;
alter function internal.get_slot_package_offer() owner to postgres;
revoke all on function internal.get_slot_package_offer() from public;
grant execute on function internal.get_slot_package_offer() to service_role;
