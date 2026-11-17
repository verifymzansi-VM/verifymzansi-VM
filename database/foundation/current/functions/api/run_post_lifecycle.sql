-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.run_post_lifecycle(p_limit);
$function$;
alter function api.run_post_lifecycle(integer) owner to postgres;
revoke all on function api.run_post_lifecycle(integer) from public;
grant execute on function api.run_post_lifecycle(integer) to service_role;
