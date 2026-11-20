-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_system_void_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if not exists(select 1 from private.package_invoice_requests r where r.invoice_id = new.id and r.kind = 'add') then
    raise exception 'only an added-slots invoice is voided without a staff member' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_system_void_guard() owner to postgres;
revoke all on function internal.customer_invoice_system_void_guard() from public;
