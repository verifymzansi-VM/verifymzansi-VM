-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.approve_staff_payment_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_staff_payment_refund(p_request_id);
$function$;
alter function api.approve_staff_payment_refund(uuid) owner to postgres;
revoke all on function api.approve_staff_payment_refund(uuid) from public;
grant execute on function api.approve_staff_payment_refund(uuid) to authenticated;
