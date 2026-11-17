-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_frontend_cipc_parse(p_actor uuid, p_session uuid, p_artifact uuid, p_summary jsonb, p_directors jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.record_frontend_cipc_parse(p_actor,p_session,p_artifact,p_summary,p_directors)$function$;
alter function api.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) owner to postgres;
revoke all on function api.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) from public;
grant execute on function api.record_frontend_cipc_parse(uuid,uuid,uuid,jsonb,jsonb) to service_role;
