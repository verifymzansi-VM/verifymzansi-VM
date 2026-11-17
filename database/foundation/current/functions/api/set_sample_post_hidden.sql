-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_sample_post_hidden(p_slug text, p_hidden boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_sample_post_hidden(p_slug, p_hidden);
$function$;
alter function api.set_sample_post_hidden(text,boolean) owner to postgres;
revoke all on function api.set_sample_post_hidden(text,boolean) from public;
grant execute on function api.set_sample_post_hidden(text,boolean) to authenticated;
