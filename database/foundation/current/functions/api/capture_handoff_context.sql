-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.capture_handoff_context(p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.capture_handoff_context(p_grant_sha256,p_signed_in);
$function$;
alter function api.capture_handoff_context(text,uuid) owner to postgres;
revoke all on function api.capture_handoff_context(text,uuid) from public;
grant execute on function api.capture_handoff_context(text,uuid) to service_role;
