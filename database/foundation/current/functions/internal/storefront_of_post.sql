-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.storefront_of_post(p_post uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p.kind = 'business' then p.id else (
      select b.id from private.post_activations a
        join private.entitlements c on c.id = a.entitlement_id
        join private.slot_packages k on k.id = c.package_id
        join private.posts b on b.owner_id = k.owner_id and b.kind = 'business'
      where a.post_id = p.id and a.released_at is null
        and internal.storefront_package(b.id) = c.package_id
      limit 1) end
  from private.posts p
  where p.id = p_post and p.kind in ('business', 'listing')
    and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
$function$;
alter function internal.storefront_of_post(uuid) owner to postgres;
revoke all on function internal.storefront_of_post(uuid) from public;
