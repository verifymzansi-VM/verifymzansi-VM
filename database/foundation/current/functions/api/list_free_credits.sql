-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_free_credits()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_free_credits();
$function$;
alter function api.list_free_credits() owner to postgres;
revoke all on function api.list_free_credits() from public;
grant execute on function api.list_free_credits() to authenticated;
