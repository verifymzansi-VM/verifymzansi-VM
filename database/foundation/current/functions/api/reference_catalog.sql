-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reference_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reference_catalog();
$function$;
alter function api.reference_catalog() owner to postgres;
revoke all on function api.reference_catalog() from public;
grant execute on function api.reference_catalog() to anon;
grant execute on function api.reference_catalog() to authenticated;
