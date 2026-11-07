-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.update_my_application(p_application uuid, p_action text, p_response text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.update_my_application(p_application,p_action,p_response);
$function$;
alter function api.update_my_application(uuid,text,text) owner to postgres;
revoke all on function api.update_my_application(uuid,text,text) from public;
grant execute on function api.update_my_application(uuid,text,text) to authenticated;
