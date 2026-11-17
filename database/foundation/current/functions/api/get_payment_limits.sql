-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_payment_limits()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_payment_limits();
$function$;
alter function api.get_payment_limits() owner to postgres;
revoke all on function api.get_payment_limits() from public;
grant execute on function api.get_payment_limits() to anon;
grant execute on function api.get_payment_limits() to authenticated;
