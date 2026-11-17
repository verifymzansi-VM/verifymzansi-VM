-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_chain_end(p_entitlement uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when r.paid_end > statement_timestamp() then r.paid_end
    else coalesce(internal.slot_package_takeover_end(p_entitlement), r.paid_end) end
  from (select internal.slot_chain_paid_end(p_entitlement) as paid_end) r;
$function$;
alter function internal.slot_chain_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_end(uuid) from public;
