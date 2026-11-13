-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.decline_staff_payment_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.decline_staff_payment_refund(p_request_id, p_reason);
$function$;
alter function api.decline_staff_payment_refund(uuid,text) owner to postgres;
revoke all on function api.decline_staff_payment_refund(uuid,text) from public;
grant execute on function api.decline_staff_payment_refund(uuid,text) to authenticated;
