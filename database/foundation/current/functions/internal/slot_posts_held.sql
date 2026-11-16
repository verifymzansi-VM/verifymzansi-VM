-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_posts_held(p_entitlement uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select case when t.package_id is null then
      (select count(*)::integer from private.post_activations a
        where a.released_at is null and a.entitlement_id in (select c.id from private.entitlements c
          where c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)))
    else (select h.posts + least((select count(*)::integer from internal.slot_package_waiting(t.package_id)),
        greatest(coalesce((select k.places from internal.slot_package_now(t.owner_id) k
          where k.package_id = t.package_id), 0) - h.posts, 0))
      from (select internal.slot_package_posts(t.package_id) as posts) h) end
  from private.entitlements t where t.id = p_entitlement), 0);
$function$;
alter function internal.slot_posts_held(uuid) owner to postgres;
revoke all on function internal.slot_posts_held(uuid) from public;
