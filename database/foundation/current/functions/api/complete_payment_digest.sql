-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_payment_digest(p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_payment_digest(p_claim);
$function$;
alter function api.complete_payment_digest(uuid) owner to postgres;
revoke all on function api.complete_payment_digest(uuid) from public;
grant execute on function api.complete_payment_digest(uuid) to service_role;
