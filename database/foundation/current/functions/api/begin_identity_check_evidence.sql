-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.begin_identity_check_evidence(p_check uuid, p_session_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.begin_identity_check_evidence(p_check,p_session_id);
$function$;
alter function api.begin_identity_check_evidence(uuid,uuid) owner to postgres;
revoke all on function api.begin_identity_check_evidence(uuid,uuid) from public;
grant execute on function api.begin_identity_check_evidence(uuid,uuid) to service_role;
