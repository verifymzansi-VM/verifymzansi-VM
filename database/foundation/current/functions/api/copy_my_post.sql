-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.copy_my_post(p_post uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.copy_my_post(p_post, p_request);
$function$;
alter function api.copy_my_post(uuid,uuid) owner to postgres;
revoke all on function api.copy_my_post(uuid,uuid) from public;
grant execute on function api.copy_my_post(uuid,uuid) to authenticated;
