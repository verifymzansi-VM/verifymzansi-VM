-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_hidden_sample_posts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_hidden_sample_posts();
$function$;
alter function api.get_hidden_sample_posts() owner to postgres;
revoke all on function api.get_hidden_sample_posts() from public;
grant execute on function api.get_hidden_sample_posts() to anon;
grant execute on function api.get_hidden_sample_posts() to authenticated;
