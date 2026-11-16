-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_numbers_gapless()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare issued integer; highest integer;
begin
  select count(*), coalesce(max(i.sequence_number), 0) into issued, highest
    from private.customer_invoices i where i.invoice_year = new.invoice_year;
  if issued <> new.last_number or highest <> new.last_number then
    raise exception 'invoice numbers of % must run from 1 to % without gaps', new.invoice_year, new.last_number
      using errcode='23514';
  end if;
  return null;
end;
$function$;
alter function internal.customer_invoice_numbers_gapless() owner to postgres;
revoke all on function internal.customer_invoice_numbers_gapless() from public;
