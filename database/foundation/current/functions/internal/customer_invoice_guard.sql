-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.customer_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; counter integer; issued_on date;
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
    raise exception 'invoices are never removed; void it instead' using errcode='23514';
  end if;
  if tg_op = 'INSERT' then
    select n.last_number into counter from private.customer_invoice_numbers n
      where n.invoice_year = new.invoice_year for update;
    issued_on := (new.issued_at at time zone 'Africa/Johannesburg')::date;
    if counter is distinct from new.sequence_number
        or new.invoice_year <> extract(year from issued_on)::integer
        or new.due_on not between issued_on + 1 and issued_on + 30
        or new.status <> 'issued' or new.payment_id is not null or new.paid_at is not null
        or new.voided_by is not null or new.voided_at is not null or new.void_reason is not null
        or new.buyer_name is not null or new.cooling_off_consent_at is not null or new.revision <> 1 then
      raise exception 'an invoice is issued unpaid, with the next number of its year' using errcode='23514';
    end if;
    return new;
  end if;
  if (new.id, new.invoice_number, new.invoice_year, new.sequence_number, new.account_id, new.plan_version_id,
      new.slots, new.unit_price_cents, new.total_cents, new.description, new.issued_at, new.due_on, new.issued_by,
      new.issue_reason, new.request_id, new.seller)
    is distinct from (old.id, old.invoice_number, old.invoice_year, old.sequence_number, old.account_id,
      old.plan_version_id, old.slots, old.unit_price_cents, old.total_cents, old.description, old.issued_at,
      old.due_on, old.issued_by, old.issue_reason, old.request_id, old.seller)
    or old.status <> 'issued'
    or (old.cooling_off_consent_at is not null
      and (new.cooling_off_consent_at, new.cooling_off_consent_version)
        is distinct from (old.cooling_off_consent_at, old.cooling_off_consent_version)) then
    raise exception 'an issued invoice keeps its facts; a paid or void invoice never changes' using errcode='23514';
  end if;
  if (new.buyer_name, new.buyer_address, new.buyer_registration_number, new.buyer_saved_at)
      is distinct from (old.buyer_name, old.buyer_address, old.buyer_registration_number, old.buyer_saved_at) then
    if new.status <> 'issued' or new.revision <> old.revision + 1 or new.buyer_name is null then
      raise exception 'billing details change only on an issued invoice, as a new revision' using errcode='23514';
    end if;
  elsif new.revision <> old.revision then
    raise exception 'an invoice revision changes only with its billing details' using errcode='23514';
  end if;
  if new.status = 'paid' then
    select * into pay from private.payments p where p.id = new.payment_id;
    if not found or pay.status <> 'complete' or pay.provider <> 'ozow' or pay.owner_id <> new.account_id
        or pay.amount_cents <> new.total_cents or new.paid_at is distinct from pay.completed_at
        or not exists(select 1 from private.customer_invoice_payments l
          where l.payment_id = new.payment_id and l.invoice_id = new.id)
        or new.voided_by is not null or new.voided_at is not null or new.void_reason is not null then
      raise exception 'a paid invoice names its complete Ozow payment of that account and amount' using errcode='23514';
    end if;
  elsif new.status = 'void' then
    if new.payment_id is not null or new.paid_at is not null then
      raise exception 'a void invoice has no payment' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_guard() owner to postgres;
revoke all on function internal.customer_invoice_guard() from public;
