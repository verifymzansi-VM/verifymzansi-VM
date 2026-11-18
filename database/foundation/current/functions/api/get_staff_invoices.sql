-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_staff_invoices()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  -- Customer emails, billing details and bank references: a second factor
  -- from the last 15 minutes.
  select internal.staff_actor_recent('payments:view');
  select internal.get_staff_invoices();
$function$;
alter function api.get_staff_invoices() owner to postgres;
revoke all on function api.get_staff_invoices() from public;
grant execute on function api.get_staff_invoices() to authenticated;
