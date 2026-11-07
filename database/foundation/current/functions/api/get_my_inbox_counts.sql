-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_my_inbox_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_inbox_counts();
$function$;
alter function api.get_my_inbox_counts() owner to postgres;
revoke all on function api.get_my_inbox_counts() from public;
grant execute on function api.get_my_inbox_counts() to authenticated;
