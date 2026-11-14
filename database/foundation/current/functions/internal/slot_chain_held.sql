-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_chain_held(p_entitlement uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements t
    join private.entitlements e on e.id=coalesce(t.slot_id,t.id) or e.slot_id=coalesce(t.slot_id,t.id)
    where t.id=p_entitlement and e.status='active' and e.ends_at>clock_timestamp());
$function$;
alter function internal.slot_chain_held(uuid) owner to postgres;
revoke all on function internal.slot_chain_held(uuid) from public;
