-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.preview_duplicate_events(p_post_a uuid, p_post_b uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.preview_duplicate_events(p_post_a,p_post_b);
$function$;
alter function api.preview_duplicate_events(uuid,uuid) owner to postgres;
revoke all on function api.preview_duplicate_events(uuid,uuid) from public;
grant execute on function api.preview_duplicate_events(uuid,uuid) to authenticated;
