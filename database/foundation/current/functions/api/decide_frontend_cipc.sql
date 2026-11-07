-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.decide_frontend_cipc(p_case uuid, p_expected timestamp with time zone, p_action text, p_generation text, p_nonce uuid, p_note text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_confirmed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.decide_frontend_cipc(p_case,p_expected,p_action,p_generation,p_nonce,p_note,p_reason,p_confirmed)$function$;
alter function api.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) owner to postgres;
revoke all on function api.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) from public;
grant execute on function api.decide_frontend_cipc(uuid,timestamp with time zone,text,text,uuid,text,text,boolean) to authenticated;
