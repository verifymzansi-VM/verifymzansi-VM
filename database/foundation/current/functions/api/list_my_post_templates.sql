-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_my_post_templates()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_my_post_templates();
$function$;
alter function api.list_my_post_templates() owner to postgres;
revoke all on function api.list_my_post_templates() from public;
grant execute on function api.list_my_post_templates() to authenticated;
