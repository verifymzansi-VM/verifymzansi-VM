-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_signup_mode()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_signup_mode();
$function$;
alter function api.get_signup_mode() owner to postgres;
revoke all on function api.get_signup_mode() from public;
grant execute on function api.get_signup_mode() to anon;
grant execute on function api.get_signup_mode() to authenticated;
