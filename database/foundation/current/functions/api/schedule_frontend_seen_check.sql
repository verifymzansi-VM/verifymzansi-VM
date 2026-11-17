-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.schedule_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_scheduled timestamp with time zone, p_generation text DEFAULT NULL::text, p_nonce uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.schedule_frontend_seen_check(p_case,p_expected,p_scheduled,p_generation,p_nonce)$function$;
alter function api.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) owner to postgres;
revoke all on function api.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) from public;
grant execute on function api.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) to authenticated;
