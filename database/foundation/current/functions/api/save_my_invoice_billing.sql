-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_my_invoice_billing(p_invoice_number text, p_revision integer, p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_invoice_billing(p_invoice_number, p_revision, p_buyer_name, p_buyer_address,
    p_buyer_registration_number);
$function$;
alter function api.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function api.save_my_invoice_billing(text,integer,text,text,text) from public;
grant execute on function api.save_my_invoice_billing(text,integer,text,text,text) to authenticated;
