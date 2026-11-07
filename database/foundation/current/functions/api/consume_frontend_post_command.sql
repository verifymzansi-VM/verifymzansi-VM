-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.consume_frontend_post_command(p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.consume_frontend_post_command(p_request)$function$;
alter function api.consume_frontend_post_command(uuid) owner to postgres;
revoke all on function api.consume_frontend_post_command(uuid) from public;
grant execute on function api.consume_frontend_post_command(uuid) to authenticated;
