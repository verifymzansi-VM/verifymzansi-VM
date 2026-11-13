-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_refund_reference_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only the reference of a refund of a bank-transfer payment may hold a
  -- space; Ozow's references never do. References never change afterwards
  -- (internal.payment_refund_request_guard).
  if position(' ' in new.ozow_reference) > 0
      and not exists(select 1 from private.payments p where p.id = new.payment_id and p.provider = 'invoice') then
    raise exception 'only the refund reference of a bank-transfer payment may contain spaces' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_reference_rule() owner to postgres;
revoke all on function internal.payment_refund_reference_rule() from public;
