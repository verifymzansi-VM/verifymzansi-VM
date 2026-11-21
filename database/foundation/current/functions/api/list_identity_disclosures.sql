-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_identity_disclosures()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_identity_disclosures();
$function$;
alter function api.list_identity_disclosures() owner to postgres;
revoke all on function api.list_identity_disclosures() from public;
grant execute on function api.list_identity_disclosures() to authenticated;
