-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_post_content(p_post_id, p_expected_revision, p_content);
$function$;
alter function api.save_post_content(uuid,integer,jsonb) owner to postgres;
revoke all on function api.save_post_content(uuid,integer,jsonb) from public;
grant execute on function api.save_post_content(uuid,integer,jsonb) to authenticated;
