-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.submit_my_frontend_appeal(p_action uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.submit_my_frontend_appeal(p_action,p_reason)$function$;
alter function api.submit_my_frontend_appeal(uuid,text) owner to postgres;
revoke all on function api.submit_my_frontend_appeal(uuid,text) from public;
grant execute on function api.submit_my_frontend_appeal(uuid,text) to authenticated;
