-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.mark_identity_check_provider_deleted(p_check uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.mark_identity_check_provider_deleted(p_check);
$function$;
alter function api.mark_identity_check_provider_deleted(uuid) owner to postgres;
revoke all on function api.mark_identity_check_provider_deleted(uuid) from public;
grant execute on function api.mark_identity_check_provider_deleted(uuid) to service_role;
