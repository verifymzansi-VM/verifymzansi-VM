-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_grant_usable(p_entitlement uuid, p_status text, p_starts timestamp with time zone, p_ends timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_status = 'active' and p_starts <= statement_timestamp()
    and (p_ends > statement_timestamp()
      or coalesce(internal.slot_chain_end(p_entitlement) > statement_timestamp(), false));
$function$;
alter function internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone) from public;
