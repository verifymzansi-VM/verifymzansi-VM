-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_posts(p_package uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id
  where a.released_at is null and c.package_id = p_package;
$function$;
alter function internal.slot_package_posts(uuid) owner to postgres;
revoke all on function internal.slot_package_posts(uuid) from public;
