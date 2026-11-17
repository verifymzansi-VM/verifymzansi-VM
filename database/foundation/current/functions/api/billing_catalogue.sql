-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.billing_catalogue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.billing_catalogue();
$function$;
alter function api.billing_catalogue() owner to postgres;
revoke all on function api.billing_catalogue() from public;
grant execute on function api.billing_catalogue() to anon;
grant execute on function api.billing_catalogue() to authenticated;
