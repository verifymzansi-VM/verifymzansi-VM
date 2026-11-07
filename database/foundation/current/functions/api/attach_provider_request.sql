-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.attach_provider_request(p_payment_id uuid, p_request_id text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.attach_provider_request(p_payment_id, p_request_id);
$function$;
alter function api.attach_provider_request(uuid,text) owner to postgres;
revoke all on function api.attach_provider_request(uuid,text) from public;
grant execute on function api.attach_provider_request(uuid,text) to service_role;
