-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_open(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements e
    where e.owner_id = p_owner and e.package_id is not null and e.status = 'active'
      and e.ends_at > statement_timestamp());
$function$;
alter function internal.slot_package_open(uuid) owner to postgres;
revoke all on function internal.slot_package_open(uuid) from public;
