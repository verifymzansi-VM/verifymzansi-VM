-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_cipc_official(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_digest text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reserve_frontend_cipc_official(p_case,p_expected,p_generation,p_nonce,p_digest)$function$;
alter function api.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) owner to postgres;
revoke all on function api.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) from public;
grant execute on function api.reserve_frontend_cipc_official(uuid,timestamp with time zone,text,uuid,text) to authenticated;
