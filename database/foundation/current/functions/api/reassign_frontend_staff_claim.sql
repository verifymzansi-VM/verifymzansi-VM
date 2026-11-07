-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reassign_frontend_staff_claim(p_type text, p_id uuid, p_to uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reassign_frontend_staff_claim(p_type,p_id,p_to,p_reason)$function$;
alter function api.reassign_frontend_staff_claim(text,uuid,uuid,text) owner to postgres;
revoke all on function api.reassign_frontend_staff_claim(text,uuid,uuid,text) from public;
grant execute on function api.reassign_frontend_staff_claim(text,uuid,uuid,text) to authenticated;
