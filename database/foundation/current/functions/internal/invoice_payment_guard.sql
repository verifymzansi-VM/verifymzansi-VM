-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- A recorded bank transfer is an audit record: it never changes and is never
  -- removed. It belongs to an invoice payment, names the account that paid and
  -- the payment's own amount, and is never recorded for the payment's owner.
  if tg_op <> 'INSERT' then
    raise exception 'recorded bank transfers are immutable' using errcode='23514';
  end if;
  if not exists(select 1 from private.payments p where p.id = new.payment_id and p.provider = 'invoice'
      and p.owner_id = new.account_id and p.amount_cents = new.amount_received_cents) then
    raise exception 'a bank transfer is the invoice payment''s amount, for the account that paid' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.invoice_payment_guard() owner to postgres;
revoke all on function internal.invoice_payment_guard() from public;
