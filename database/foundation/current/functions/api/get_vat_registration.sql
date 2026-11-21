-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_vat_registration()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_vat_registration();
$function$;
alter function api.get_vat_registration() owner to postgres;
revoke all on function api.get_vat_registration() from public;
grant execute on function api.get_vat_registration() to anon;
grant execute on function api.get_vat_registration() to authenticated;
