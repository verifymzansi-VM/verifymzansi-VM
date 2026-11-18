-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refund_by_bank_transfer(p_payment_id uuid, p_kind text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Money that goes back by bank transfer, recorded with the bank's reference:
  -- any reversal of a bank-transfer payment, and a refund of an Ozow payment
  -- once Ozow's refund window has passed.
  select coalesce((select p.provider = 'invoice' or (p.provider = 'ozow' and p_kind = 'refunded'
      and not internal.ozow_refund_window_open(p.id))
    from private.payments p where p.id = p_payment_id), false);
$function$;
alter function internal.refund_by_bank_transfer(uuid,text) owner to postgres;
revoke all on function internal.refund_by_bank_transfer(uuid,text) from public;
