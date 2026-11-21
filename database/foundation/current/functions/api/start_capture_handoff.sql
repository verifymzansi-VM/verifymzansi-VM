-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.start_capture_handoff(p_token_sha256 text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_with_id boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_capture_handoff(p_token_sha256,p_first_name,p_last_name,p_with_id);
$function$;
alter function api.start_capture_handoff(text,text,text,boolean) owner to postgres;
revoke all on function api.start_capture_handoff(text,text,text,boolean) from public;
grant execute on function api.start_capture_handoff(text,text,text,boolean) to authenticated;
