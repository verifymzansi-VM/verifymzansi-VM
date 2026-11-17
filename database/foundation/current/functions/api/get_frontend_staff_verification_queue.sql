-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_staff_verification_queue(p_limit integer DEFAULT 100, p_include_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_staff_verification_queue(p_limit,p_include_ids)$function$;
alter function api.get_frontend_staff_verification_queue(integer,uuid[]) owner to postgres;
revoke all on function api.get_frontend_staff_verification_queue(integer,uuid[]) from public;
grant execute on function api.get_frontend_staff_verification_queue(integer,uuid[]) to authenticated;
