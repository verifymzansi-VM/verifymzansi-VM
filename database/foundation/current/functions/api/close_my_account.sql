-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.close_my_account()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.close_my_account();
$function$;
alter function api.close_my_account() owner to postgres;
revoke all on function api.close_my_account() from public;
grant execute on function api.close_my_account() to authenticated;
