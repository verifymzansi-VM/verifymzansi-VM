-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.expire_stale_checkouts(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.expire_stale_checkouts(p_limit);
$function$;
alter function api.expire_stale_checkouts(integer) owner to postgres;
revoke all on function api.expire_stale_checkouts(integer) from public;
grant execute on function api.expire_stale_checkouts(integer) to service_role;
