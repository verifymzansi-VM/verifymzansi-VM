-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.my_partner_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.my_partner_dashboard();
$function$;
alter function api.my_partner_dashboard() owner to postgres;
revoke all on function api.my_partner_dashboard() from public;
grant execute on function api.my_partner_dashboard() to authenticated;
