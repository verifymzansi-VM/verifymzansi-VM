-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_number_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoice number counters are never removed' using errcode='23514';
  end if;
  if tg_op = 'INSERT' then
    if new.last_number <> 1 then
      raise exception 'an invoice number counter starts at 1' using errcode='23514';
    end if;
    return new;
  end if;
  if new.invoice_year <> old.invoice_year or new.last_number <> old.last_number + 1 then
    raise exception 'invoice numbers move up by one, without gaps' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_number_guard() owner to postgres;
revoke all on function internal.customer_invoice_number_guard() from public;
