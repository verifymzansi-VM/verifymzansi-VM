-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_owner_listing_editor(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_owner_listing_editor(p_post_id);
$function$;
alter function api.get_owner_listing_editor(uuid) owner to postgres;
revoke all on function api.get_owner_listing_editor(uuid) from public;
grant execute on function api.get_owner_listing_editor(uuid) to authenticated;
