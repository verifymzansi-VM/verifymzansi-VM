-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_invoice(p_invoice_number text, p_link_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices := internal.customer_invoice_for_caller(p_invoice_number, p_link_hash); dto jsonb;
begin
  dto := internal.customer_invoice_dto(inv, null);
  if p_link_hash is null then
    perform internal.price_draft_actor();
    return dto;
  end if;
  -- Through a payment link: the invoice as its payer needs it, without the
  -- invoice's or its payments' ids.
  return dto - 'invoice_id' - 'payment_id' || jsonb_build_object('latest_attempt',
    case when jsonb_typeof(dto->'latest_attempt') = 'object' then (dto->'latest_attempt') - 'payment_id' else 'null'::jsonb end);
end;
$function$;
alter function internal.get_my_invoice(text,text) owner to postgres;
revoke all on function internal.get_my_invoice(text,text) from public;
grant execute on function internal.get_my_invoice(text,text) to authenticated;
grant execute on function internal.get_my_invoice(text,text) to service_role;
