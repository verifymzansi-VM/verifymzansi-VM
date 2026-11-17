-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_staff_invoice_transfer(p_invoice_number text, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_invoice_transfer(p_invoice_number, p_bank_reference, p_cleared_on,
    p_cooling_off_waiver, p_reason);
$function$;
alter function api.record_staff_invoice_transfer(text,text,text,boolean,text) owner to postgres;
revoke all on function api.record_staff_invoice_transfer(text,text,text,boolean,text) from public;
grant execute on function api.record_staff_invoice_transfer(text,text,text,boolean,text) to authenticated;
