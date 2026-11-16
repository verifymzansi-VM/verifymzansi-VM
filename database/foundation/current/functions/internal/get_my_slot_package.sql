-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_slot_package()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); verified text; pkg private.slot_packages; k record;
  latest_end timestamptz; result jsonb;
begin
  verified := internal.current_verified_identity(actor);
  select p.* into pkg from private.slot_packages p
    where p.owner_id = actor and exists(select 1 from private.entitlements e
      join private.payments pay on pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'
      where e.package_id = p.id and e.status = 'active' and e.ends_at > statement_timestamp() - interval '3 days')
    order by p.created_at desc, p.id limit 1;
  select n.* into k from internal.slot_package_now(actor) n where n.package_id = pkg.id;
  select max(e.ends_at) into latest_end from private.entitlements e
    where e.package_id = pkg.id and e.status = 'active';
  select jsonb_build_object(
    'verified', verified is not null,
    'on_sale', internal.slot_packages_on_sale(),
    'can_buy', internal.slot_packages_on_sale() and verified is not null and not internal.slot_package_open(actor),
    'individual_blocked_until', (select max(e.ends_at) - interval '7 days' from private.entitlements e
      where e.owner_id in (select internal.individual_slot_owners(coalesce(verified,
          internal.individual_slot_identity(actor)), actor))
        and e.package_id is not null and e.status = 'active' and e.starts_at <= statement_timestamp()
        and e.ends_at > statement_timestamp() + interval '7 days'),
    'package', case when pkg.id is null then null else jsonb_build_object(
      'id', pkg.id, 'term_days', pkg.term_days, 'slots_bought', pkg.slot_count,
      'state', case when k.package_id is not null then 'active' else 'ended' end,
      'places', coalesce(k.places, 0),
      'starts_at', coalesce(k.starts_at, (select min(e.starts_at) from private.entitlements e
        where e.package_id = pkg.id and e.status = 'active')),
      'ends_at', coalesce(k.ends_at, latest_end),
      'new_posts_limit', coalesce(k.new_posts_limit, 0),
      -- its grants, which My slots shows as the package rather than as slots
      'grants', coalesce((select jsonb_agg(e.id order by e.starts_at, e.id) from private.entitlements e
        where e.package_id = pkg.id and e.status = 'active'), '[]'::jsonb),
      'new_posts_started', coalesce((select internal.slot_posts_started(e.id,
          statement_timestamp() - make_interval(days => e.activation_period_days))
        from private.entitlements e where e.package_id = pkg.id order by e.ends_at desc, e.id limit 1), 0),
      'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
            'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at, 'moving', x.moving)
            order by x.moving, x.activated_at, x.id)
          from (
            -- the posts in it, and for an ended package the posts it held,
            -- hidden and kept for 3 days
            (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at,
              false as moving
            from private.post_activations a
              join private.entitlements e on e.id = a.entitlement_id
              join private.posts p on p.id = a.post_id
            where e.package_id = pkg.id and p.owner_id = actor and p.edit_of is null
              and (a.released_at is null
                or (k.package_id is null and a.release_reason in ('expired','entitlement_ended')
                  and p.status = 'expired' and p.deletes_at > statement_timestamp()
                  and not exists(select 1 from private.post_activations n where n.post_id = p.id and n.released_at is null)))
            order by p.id, a.activated_at desc)
            union all
            -- the posts of ended Individual slots it takes, before the sweep moves them in
            select p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at, true
            from internal.slot_package_waiting(k.package_id) w
              join private.post_activations a on a.id = w.activation_id
              join private.posts p on p.id = w.post_id
            where k.package_id is not null and p.edit_of is null
              and w.place_rank <= k.places - internal.slot_package_posts(k.package_id)
          ) x), '[]'::jsonb)) end) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_slot_package() owner to postgres;
revoke all on function internal.get_my_slot_package() from public;
grant execute on function internal.get_my_slot_package() to authenticated;
