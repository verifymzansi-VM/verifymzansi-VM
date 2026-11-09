-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.update_frontend_support_status(p_ticket uuid, p_revision integer, p_status text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.update_frontend_support_status(p_ticket,p_revision,p_status)$function$;
alter function api.update_frontend_support_status(uuid,integer,text) owner to postgres;
revoke all on function api.update_frontend_support_status(uuid,integer,text) from public;
grant execute on function api.update_frontend_support_status(uuid,integer,text) to authenticated;
