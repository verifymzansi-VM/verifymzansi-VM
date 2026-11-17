-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.void_staff_invoice(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.void_staff_invoice(p_invoice_id, p_reason);
$function$;
alter function api.void_staff_invoice(uuid,text) owner to postgres;
revoke all on function api.void_staff_invoice(uuid,text) from public;
grant execute on function api.void_staff_invoice(uuid,text) to authenticated;
