-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_refund_reference_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only a bank reference may hold a space: of a refund of a bank-transfer
  -- payment, or of an Ozow payment paid back by bank transfer once Ozow's
  -- refund window has passed (internal.refund_by_bank_transfer). Ozow's
  -- references never do. References never change afterwards
  -- (internal.payment_refund_request_guard).
  if position(' ' in new.ozow_reference) > 0
      and not (new.channel = 'manual' and internal.refund_by_bank_transfer(new.payment_id, new.kind)) then
    raise exception 'only the bank reference of a refund paid back by bank transfer may contain spaces' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_reference_rule() owner to postgres;
revoke all on function internal.payment_refund_reference_rule() from public;
