-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_area_activity(p_area text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_area_activity(p_area,p_limit)$function$;
alter function api.get_frontend_area_activity(text,integer) owner to postgres;
revoke all on function api.get_frontend_area_activity(text,integer) from public;
grant execute on function api.get_frontend_area_activity(text,integer) to authenticated;
