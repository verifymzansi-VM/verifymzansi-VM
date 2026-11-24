-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_my_post_template(p_name text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_post_template(p_name, p_data);
$function$;
alter function api.save_my_post_template(text,jsonb) owner to postgres;
revoke all on function api.save_my_post_template(text,jsonb) from public;
grant execute on function api.save_my_post_template(text,jsonb) to authenticated;
