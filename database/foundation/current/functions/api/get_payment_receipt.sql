-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_payment_receipt(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_payment_receipt(p_payment_id);
$function$;
alter function api.get_payment_receipt(uuid) owner to postgres;
revoke all on function api.get_payment_receipt(uuid) from public;
grant execute on function api.get_payment_receipt(uuid) to service_role;
