-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_frontend_cipc_callback(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_domain boolean, p_callback jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.record_frontend_cipc_callback(p_case,p_expected,p_generation,p_nonce,p_domain,p_callback)$function$;
alter function api.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) owner to postgres;
revoke all on function api.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) from public;
grant execute on function api.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) to authenticated;
