-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_public_post(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_public_post(p_id);
$function$;
alter function api.get_public_post(uuid) owner to postgres;
revoke all on function api.get_public_post(uuid) from public;
grant execute on function api.get_public_post(uuid) to anon;
grant execute on function api.get_public_post(uuid) to authenticated;
