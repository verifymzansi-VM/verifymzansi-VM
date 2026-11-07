-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.execute_my_frontend_post_action(p_request uuid, p_post uuid, p_expected_revision integer, p_action text, p_kind text, p_area text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.execute_my_frontend_post_action(p_request,p_post,p_expected_revision,p_action,p_kind,p_area)$function$;
alter function api.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) owner to postgres;
revoke all on function api.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) from public;
grant execute on function api.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) to authenticated;
