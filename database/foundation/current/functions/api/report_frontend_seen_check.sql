-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.report_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_report jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.report_frontend_seen_check(p_case,p_expected,p_report)$function$;
alter function api.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) owner to postgres;
revoke all on function api.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) from public;
grant execute on function api.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) to authenticated;
