-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.showroom_feed(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.showroom_feed(p_request);
$function$;
alter function api.showroom_feed(jsonb) owner to postgres;
revoke all on function api.showroom_feed(jsonb) from public;
grant execute on function api.showroom_feed(jsonb) to anon;
grant execute on function api.showroom_feed(jsonb) to authenticated;
