-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_number(p_invoice_number text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_invoice_number is null or upper(btrim(p_invoice_number)) !~ '^VM-[0-9]{4}-[0-9]{6}$' then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  return upper(btrim(p_invoice_number));
end;
$function$;
alter function internal.customer_invoice_number(text) owner to postgres;
revoke all on function internal.customer_invoice_number(text) from public;
