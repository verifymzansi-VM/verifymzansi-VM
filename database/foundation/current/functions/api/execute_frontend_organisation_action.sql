-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.execute_frontend_organisation_action(p_org uuid, p_item uuid, p_action text, p_value text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.execute_frontend_organisation_action(p_org,p_item,p_action,p_value,p_note)$function$;
alter function api.execute_frontend_organisation_action(uuid,uuid,text,text,text) owner to postgres;
revoke all on function api.execute_frontend_organisation_action(uuid,uuid,text,text,text) from public;
grant execute on function api.execute_frontend_organisation_action(uuid,uuid,text,text,text) to authenticated;
