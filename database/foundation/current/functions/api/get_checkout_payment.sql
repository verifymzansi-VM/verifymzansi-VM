-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_checkout_payment(p_payment_id uuid DEFAULT NULL::uuid, p_merchant_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_checkout_payment(p_payment_id,p_merchant_reference);
$function$;
alter function api.get_checkout_payment(uuid,text) owner to postgres;
revoke all on function api.get_checkout_payment(uuid,text) from public;
grant execute on function api.get_checkout_payment(uuid,text) to service_role;
