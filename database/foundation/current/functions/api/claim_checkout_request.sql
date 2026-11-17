-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_checkout_request(p_payment_id uuid, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_checkout_request(p_payment_id,p_owner_id);
$function$;
alter function api.claim_checkout_request(uuid,uuid) owner to postgres;
revoke all on function api.claim_checkout_request(uuid,uuid) from public;
grant execute on function api.claim_checkout_request(uuid,uuid) to service_role;
