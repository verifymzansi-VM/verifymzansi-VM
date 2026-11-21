-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_context(p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  return internal.capture_handoff_state(internal.capture_handoff_by_grant(p_grant_sha256,p_signed_in));
end;
$function$;
alter function internal.capture_handoff_context(text,uuid) owner to postgres;
revoke all on function internal.capture_handoff_context(text,uuid) from public;
grant execute on function internal.capture_handoff_context(text,uuid) to service_role;
