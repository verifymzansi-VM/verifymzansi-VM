-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.discard_post_edit(p_edit_id, p_expected_revision);
$function$;
alter function api.discard_post_edit(uuid,integer) owner to postgres;
revoke all on function api.discard_post_edit(uuid,integer) from public;
grant execute on function api.discard_post_edit(uuid,integer) to authenticated;
