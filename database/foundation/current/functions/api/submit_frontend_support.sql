-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.submit_frontend_support(p_name text, p_email text, p_category text, p_message text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.submit_frontend_support(p_name,p_email,p_category,p_message)$function$;
alter function api.submit_frontend_support(text,text,text,text) owner to postgres;
revoke all on function api.submit_frontend_support(text,text,text,text) from public;
grant execute on function api.submit_frontend_support(text,text,text,text) to service_role;
