-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.revoke_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_note text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.revoke_frontend_seen_check(p_case,p_expected,p_note,p_reason)$function$;
alter function api.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) owner to postgres;
revoke all on function api.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) from public;
grant execute on function api.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) to authenticated;
