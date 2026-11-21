-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.storefront_package(p_business uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select pk.package_id
  from private.posts b
  cross join lateral internal.slot_package_now(b.owner_id) pk
  where b.id = p_business and b.kind = 'business'
    and b.id = (
      select s.business_id from private.frontend_current_cipc_stickers s
        join private.posts o on o.id = s.business_id
      where s.owner_id = b.owner_id
        and exists(select 1 from private.public_eligible_posts e where e.id = s.business_id)
      order by o.published_at, o.id
      limit 1);
$function$;
alter function internal.storefront_package(uuid) owner to postgres;
revoke all on function internal.storefront_package(uuid) from public;
