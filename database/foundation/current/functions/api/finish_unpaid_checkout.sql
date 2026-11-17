-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.finish_unpaid_checkout(p_payment_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.finish_unpaid_checkout(p_payment_id,p_status);
$function$;
alter function api.finish_unpaid_checkout(uuid,text) owner to postgres;
revoke all on function api.finish_unpaid_checkout(uuid,text) from public;
grant execute on function api.finish_unpaid_checkout(uuid,text) to service_role;
