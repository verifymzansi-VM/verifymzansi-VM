-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.delete_my_post_template(p_template uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.delete_my_post_template(p_template);
$function$;
alter function api.delete_my_post_template(uuid) owner to postgres;
revoke all on function api.delete_my_post_template(uuid) from public;
grant execute on function api.delete_my_post_template(uuid) to authenticated;
