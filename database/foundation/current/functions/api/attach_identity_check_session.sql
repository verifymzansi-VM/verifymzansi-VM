-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.attach_identity_check_session(p_check uuid, p_session_id uuid, p_session_url text, p_network_hash text, p_device_kind text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_identity_check_session(p_check,p_session_id,p_session_url,p_network_hash,p_device_kind);
$function$;
alter function api.attach_identity_check_session(uuid,uuid,text,text,text) owner to postgres;
revoke all on function api.attach_identity_check_session(uuid,uuid,text,text,text) from public;
grant execute on function api.attach_identity_check_session(uuid,uuid,text,text,text) to service_role;
