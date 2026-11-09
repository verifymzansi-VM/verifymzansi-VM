-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.search_post_cards(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.search_post_cards(p_request);
$function$;
alter function api.search_post_cards(jsonb) owner to postgres;
revoke all on function api.search_post_cards(jsonb) from public;
grant execute on function api.search_post_cards(jsonb) to anon;
grant execute on function api.search_post_cards(jsonb) to authenticated;
