-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.attach_identity_check_session(p_check uuid, p_session_id uuid, p_session_url text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_identity_check_session(p_check,p_session_id,p_session_url);
$function$;
alter function api.attach_identity_check_session(uuid,uuid,text) owner to postgres;
revoke all on function api.attach_identity_check_session(uuid,uuid,text) from public;
grant execute on function api.attach_identity_check_session(uuid,uuid,text) to service_role;
