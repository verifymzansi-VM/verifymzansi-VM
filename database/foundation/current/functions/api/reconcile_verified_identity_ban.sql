-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reconcile_verified_identity_ban(p_decision uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reconcile_verified_identity_ban(p_decision);
$function$;
alter function api.reconcile_verified_identity_ban(uuid) owner to postgres;
revoke all on function api.reconcile_verified_identity_ban(uuid) from public;
grant execute on function api.reconcile_verified_identity_ban(uuid) to service_role;
