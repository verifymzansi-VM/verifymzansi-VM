-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.read_listing_price_draft()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.read_listing_price_draft();
$function$;
alter function api.read_listing_price_draft() owner to postgres;
revoke all on function api.read_listing_price_draft() from public;
grant execute on function api.read_listing_price_draft() to authenticated;
