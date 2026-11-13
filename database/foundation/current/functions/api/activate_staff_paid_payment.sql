-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.activate_staff_paid_payment(p_payment_id, p_reason);
$function$;
alter function api.activate_staff_paid_payment(uuid,text) owner to postgres;
revoke all on function api.activate_staff_paid_payment(uuid,text) from public;
grant execute on function api.activate_staff_paid_payment(uuid,text) to authenticated;
