-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_keep_posts(p_grant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare g private.entitlements; target private.entitlements; v_places integer; v_held integer;
  r record; kept integer := 0;
begin
  select * into g from private.entitlements e where e.id = p_grant;
  if g.id is null or g.package_id is null or g.status <> 'revoked' then return 0; end if;
  if not exists(select 1 from internal.slot_package_now(g.owner_id) n where n.package_id = g.package_id) then
    return 0;
  end if;
  -- The package's places are counted under its row lock, the one
  -- internal.activate_post holds while it fills a place, and the grant the
  -- posts move to is held against an activation changing it. Both are taken
  -- without waiting: the reversal already holds the revoked grant and its
  -- posts, so waiting for an activation (which locks grants, then the
  -- package) could deadlock. While one is busy the reversal is refused and
  -- staff retry it, as for any funded post that is busy.
  begin
    perform 1 from private.slot_packages k where k.id = g.package_id for update nowait;
    select e.* into target from private.entitlements e
      where e.package_id = g.package_id and e.owner_id = g.owner_id and e.status = 'active'
        and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
        and exists(select 1 from private.payments pay where pay.id = e.payment_id and pay.owner_id = e.owner_id
          and pay.status = 'complete')
      order by e.ends_at desc, e.slot_capacity desc, e.id
      limit 1
      for key share nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409', detail='package_busy';
  end;
  if target.id is null then return 0; end if;
  select n.places into v_places from internal.slot_package_now(g.owner_id) n where n.package_id = g.package_id;
  if v_places is null then return 0; end if;
  select count(*)::integer into v_held from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id
    where a.released_at is null and c.package_id = g.package_id and c.id <> g.id;
  for r in
    select a.id, a.post_id from private.post_activations a join private.posts p on p.id = a.post_id
    where a.entitlement_id = g.id and a.released_at is null
    order by p.published_at desc nulls last, a.activated_at desc, a.id
  loop
    exit when v_held >= v_places;
    continue when not internal.entitlement_for_post_eligible(target.id, r.post_id, g.owner_id);
    update private.post_activations set released_at = clock_timestamp(), release_reason = 'entitlement_ended'
      where id = r.id;
    insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
      values (r.post_id, target.id, g.owner_id, clock_timestamp(), true);
    v_held := v_held + 1;
    kept := kept + 1;
  end loop;
  return kept;
end;
$function$;
alter function internal.slot_package_keep_posts(uuid) owner to postgres;
revoke all on function internal.slot_package_keep_posts(uuid) from public;
