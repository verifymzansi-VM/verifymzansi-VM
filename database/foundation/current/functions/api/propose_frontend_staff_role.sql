-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.propose_frontend_staff_role(p_email text, p_role text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.propose_frontend_staff_role(p_email,p_role,p_reason)$function$;
alter function api.propose_frontend_staff_role(text,text,text) owner to postgres;
revoke all on function api.propose_frontend_staff_role(text,text,text) from public;
grant execute on function api.propose_frontend_staff_role(text,text,text) to authenticated;
