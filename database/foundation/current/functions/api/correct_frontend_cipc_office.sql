-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.correct_frontend_cipc_office(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_office jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.correct_frontend_cipc_office(p_case,p_expected,p_generation,p_nonce,p_office)$function$;
alter function api.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) owner to postgres;
revoke all on function api.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) from public;
grant execute on function api.correct_frontend_cipc_office(uuid,timestamp with time zone,text,uuid,jsonb) to authenticated;
