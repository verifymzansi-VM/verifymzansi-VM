-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.attach_capture_handoff_identity(p_owner uuid, p_token_sha256 text, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_capture_handoff_identity(p_owner,p_token_sha256,p_identity);
$function$;
alter function api.attach_capture_handoff_identity(uuid,text,jsonb) owner to postgres;
revoke all on function api.attach_capture_handoff_identity(uuid,text,jsonb) from public;
grant execute on function api.attach_capture_handoff_identity(uuid,text,jsonb) to service_role;
