-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.confirm_staff_invoice_payment(p_transfer_id);
$function$;
alter function api.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function api.confirm_staff_invoice_payment(uuid) from public;
grant execute on function api.confirm_staff_invoice_payment(uuid) to authenticated;
