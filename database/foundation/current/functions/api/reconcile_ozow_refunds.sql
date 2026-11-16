-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reconcile_ozow_refunds(p_refunds jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reconcile_ozow_refunds(p_refunds);
$function$;
alter function api.reconcile_ozow_refunds(jsonb) owner to postgres;
revoke all on function api.reconcile_ozow_refunds(jsonb) from public;
grant execute on function api.reconcile_ozow_refunds(jsonb) to service_role;
