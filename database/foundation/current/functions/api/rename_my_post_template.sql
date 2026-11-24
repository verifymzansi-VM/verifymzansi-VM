-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.rename_my_post_template(p_template uuid, p_name text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.rename_my_post_template(p_template, p_name);
$function$;
alter function api.rename_my_post_template(uuid,text) owner to postgres;
revoke all on function api.rename_my_post_template(uuid,text) from public;
grant execute on function api.rename_my_post_template(uuid,text) to authenticated;
