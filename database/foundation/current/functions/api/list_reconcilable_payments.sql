-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_reconcilable_payments(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_reconcilable_payments(p_limit);
$function$;
alter function api.list_reconcilable_payments(integer) owner to postgres;
revoke all on function api.list_reconcilable_payments(integer) from public;
grant execute on function api.list_reconcilable_payments(integer) to service_role;
