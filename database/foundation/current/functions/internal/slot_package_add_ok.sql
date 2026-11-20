-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_add_ok(p_owner uuid, p_package uuid, p_slots integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.slot_packages_on_sale() and internal.current_verified_identity(p_owner) is not null
    and coalesce((select n.package_id = p_package and n.places + p_slots <= 250
      from internal.slot_package_now(p_owner) n), false);
$function$;
alter function internal.slot_package_add_ok(uuid,uuid,integer) owner to postgres;
revoke all on function internal.slot_package_add_ok(uuid,uuid,integer) from public;
