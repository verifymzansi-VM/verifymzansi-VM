-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.purge_expired_identity_bans(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.purge_expired_identity_bans(p_limit);
$function$;
alter function api.purge_expired_identity_bans(integer) owner to postgres;
revoke all on function api.purge_expired_identity_bans(integer) from public;
grant execute on function api.purge_expired_identity_bans(integer) to service_role;
