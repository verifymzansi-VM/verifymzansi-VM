-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_checkout_request(p_payment_id uuid, p_owner_id uuid, p_claim_token uuid, p_request_id text, p_checkout_url text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_checkout_request(p_payment_id,p_owner_id,p_claim_token,p_request_id,p_checkout_url);
$function$;
alter function api.complete_checkout_request(uuid,uuid,uuid,text,text) owner to postgres;
revoke all on function api.complete_checkout_request(uuid,uuid,uuid,text,text) from public;
grant execute on function api.complete_checkout_request(uuid,uuid,uuid,text,text) to service_role;
