-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.submit_post(p_post_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.submit_post(p_post_id, p_expected_revision);
$function$;
alter function api.submit_post(uuid,integer) owner to postgres;
revoke all on function api.submit_post(uuid,integer) from public;
grant execute on function api.submit_post(uuid,integer) to authenticated;
