-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_my_invoice_billing(p_invoice_number text, p_revision integer, p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; name text; address text; registration text;
begin
  name := regexp_replace(btrim(coalesce(p_buyer_name, '')), '\s+', ' ', 'g');
  address := regexp_replace(regexp_replace(btrim(coalesce(p_buyer_address, ''), E' \n\r\t'), E'\r\n?', E'\n', 'g'),
    E'[ \t]+', ' ', 'g');
  registration := nullif(regexp_replace(btrim(coalesce(p_buyer_registration_number, '')), '\s+', ' ', 'g'), '');
  if p_revision is null or not coalesce(internal.plain_text_valid(name, 2, 160, false), false)
      or not coalesce(internal.plain_text_valid(address, 5, 300, true), false)
      or (registration is not null and registration !~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{1,39}$') then
    raise exception 'business or buyer name (2 to 160 characters), address (5 to 300) and a registration number of letters and digits required'
      using errcode='22023', detail='invoice_billing_invalid';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if (inv.buyer_name, inv.buyer_address, inv.buyer_registration_number) is not distinct from (name, address, registration) then
    perform internal.price_draft_actor();
    return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', true);
  end if;
  if inv.revision <> p_revision then
    raise exception 'the invoice changed; reload it' using errcode='PT409', detail='invoice_revision_changed';
  end if;
  update private.customer_invoices set buyer_name = name, buyer_address = address,
      buyer_registration_number = registration, buyer_saved_at = statement_timestamp(), revision = revision + 1
    where id = inv.id returning * into inv;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function internal.save_my_invoice_billing(text,integer,text,text,text) from public;
grant execute on function internal.save_my_invoice_billing(text,integer,text,text,text) to authenticated;
