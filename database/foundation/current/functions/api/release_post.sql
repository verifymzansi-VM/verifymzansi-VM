-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.release_post(p_post_id uuid, p_reason text DEFAULT 'owner'::text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.release_post(p_post_id, p_reason);
$function$;
alter function api.release_post(uuid,text) owner to postgres;
revoke all on function api.release_post(uuid,text) from public;
grant execute on function api.release_post(uuid,text) to authenticated;
