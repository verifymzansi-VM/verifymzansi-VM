-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.sweep_sponsorships(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.sweep_sponsorships(p_limit);
$function$;
alter function api.sweep_sponsorships(integer) owner to postgres;
revoke all on function api.sweep_sponsorships(integer) from public;
grant execute on function api.sweep_sponsorships(integer) to service_role;
