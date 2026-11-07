-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.billing_catalogue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.plan_code, 'label', p.label,
        'area', p.area, 'price_cents', p.price_cents::text, 'currency', p.currency, 'duration_days', p.duration_days,
        'activation_period_days', p.activation_period_days, 'activations_per_period', p.activations_per_period,
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos,
        'addon_capabilities',to_jsonb(p.addon_capabilities))
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'days', a.days,
        'price_cents', a.price_cents::text, 'currency', a.currency) order by a.kind, a.days)
      from private.addon_versions a where a.retired_at is null), '[]'));
$function$;
alter function internal.billing_catalogue() owner to postgres;
revoke all on function internal.billing_catalogue() from public;
grant execute on function internal.billing_catalogue() to anon;
grant execute on function internal.billing_catalogue() to authenticated;
