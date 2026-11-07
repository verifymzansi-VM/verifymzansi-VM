-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.entitlement_usable(p_status text, p_starts timestamp with time zone, p_ends timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_status = 'active' and p_starts <= statement_timestamp() and p_ends > statement_timestamp();
$function$;
alter function internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) owner to postgres;
revoke all on function internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) from public;
grant execute on function internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) to authenticated;
grant execute on function internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) to service_role;
