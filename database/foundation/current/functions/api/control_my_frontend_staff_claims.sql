-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.control_my_frontend_staff_claims(p_action text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.control_my_frontend_staff_claims(p_action)$function$;
alter function api.control_my_frontend_staff_claims(text) owner to postgres;
revoke all on function api.control_my_frontend_staff_claims(text) from public;
grant execute on function api.control_my_frontend_staff_claims(text) to authenticated;
