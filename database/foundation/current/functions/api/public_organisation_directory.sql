-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.public_organisation_directory()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.public_organisation_directory();
$function$;
alter function api.public_organisation_directory() owner to postgres;
revoke all on function api.public_organisation_directory() from public;
grant execute on function api.public_organisation_directory() to anon;
grant execute on function api.public_organisation_directory() to authenticated;
