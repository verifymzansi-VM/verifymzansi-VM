-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.invoice_transfer_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- A recorded bank transfer is an audit record: never removed; recorded as
  -- waiting; changed only once, from waiting to confirmed (naming its invoice
  -- payment: that account, amount and plan), to declined, or (from
  -- 20261118044440_bank_transfer_expiry.sql) to expired once it has waited 14
  -- days, with nothing else changed.
  if tg_op = 'DELETE' then
    -- Only the retention job removes a record, five tax years on.
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
    raise exception 'recorded bank transfers are never removed' using errcode='23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'awaiting_confirmation' or new.confirmed_by is not null or new.confirmed_at is not null
        or new.payment_id is not null or new.declined_by is not null or new.declined_at is not null
        or new.decline_reason is not null or new.expired_at is not null then
      raise exception 'a bank transfer is recorded as waiting for confirmation' using errcode='23514';
    end if;
    return new;
  end if;
  -- An expired transfer is resolved once by a staff member (money returned
  -- outside the system, or it never arrived), with nothing else changed.
  if old.status = 'expired' then
    if old.resolved_at is not null or new.resolved_at is null or new.resolved_by is null
        or new.resolution is null or new.resolution_reason is null
        or (to_jsonb(new) - array['resolution','resolution_reason','resolved_by','resolved_at'])
          is distinct from (to_jsonb(old) - array['resolution','resolution_reason','resolved_by','resolved_at']) then
      raise exception 'an expired bank transfer is only resolved once, with nothing else changed' using errcode='23514';
    end if;
    return new;
  end if;
  if old.status <> 'awaiting_confirmation' or new.status not in ('confirmed', 'declined', 'expired')
      or (to_jsonb(new) - array['status','confirmed_by','confirmed_at','payment_id','declined_by','declined_at','decline_reason','expired_at'])
        is distinct from (to_jsonb(old) - array['status','confirmed_by','confirmed_at','payment_id','declined_by','declined_at','decline_reason','expired_at']) then
    raise exception 'a recorded bank transfer is confirmed or declined once and never changed' using errcode='23514';
  end if;
  if new.status = 'expired' then
    if new.expired_at is null or new.expired_at > statement_timestamp()
        or new.expired_at < old.recorded_at + internal.invoice_transfer_expires_after()
        or new.confirmed_by is not null or new.confirmed_at is not null or new.payment_id is not null
        or new.declined_by is not null or new.declined_at is not null or new.decline_reason is not null then
      raise exception 'a waiting bank transfer expires only 14 days after it was recorded, with nothing else changed'
        using errcode='23514';
    end if;
    return new;
  end if;
  if new.expired_at is not null then
    raise exception 'only an expired bank transfer has an expiry time' using errcode='23514';
  end if;
  -- Confirmed or declined: only while the transfer has not expired, also when
  -- the sweep has not marked it yet.
  if internal.invoice_transfer_expired(old) then
    raise exception 'a bank transfer that waited 14 days has expired and is never confirmed or declined'
      using errcode='23514';
  end if;
  if new.status = 'confirmed' then
    select * into pay from private.payments p where p.id = new.payment_id;
    if not found or pay.provider <> 'invoice' or pay.status <> 'complete' or pay.owner_id <> new.account_id
        or pay.amount_cents <> new.amount_received_cents or pay.plan_version_id <> new.plan_version_id
        or pay.snapshot->>'invoice_transfer_id' is distinct from new.id::text
        or (pay.snapshot->>'slots')::integer is distinct from new.slots
        or internal.same_identity(new.confirmed_by, new.recorded_by)
        or new.declined_by is not null or new.declined_at is not null or new.decline_reason is not null then
      raise exception 'a confirmed bank transfer names its invoice payment of that account and amount' using errcode='23514';
    end if;
  elsif new.confirmed_by is not null or new.confirmed_at is not null or new.payment_id is not null then
    raise exception 'a declined bank transfer has no payment' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.invoice_transfer_guard() owner to postgres;
revoke all on function internal.invoice_transfer_guard() from public;
