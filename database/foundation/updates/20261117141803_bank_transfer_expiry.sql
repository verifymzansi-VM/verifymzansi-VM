-- Waiting bank transfers expire after 14 days (owner's decision of 16 November
-- 2026).
--
-- A bank transfer staff record (api.record_staff_invoice_payment, or
-- api.record_staff_invoice_transfer for a customer invoice) waits in
-- private.invoice_transfers with status 'awaiting_confirmation' until a second
-- staff member confirms or declines it. Until now it could wait for ever; while
-- it waits, an invoice it names cannot be paid online, voided or given another
-- transfer, and the account cannot be erased.
--
-- Apply after 20261117123240_skipped_email_status.sql (filename order; this
-- update does not depend on it), and only once staff have confirmed or declined
-- every transfer that has waited 14 days or more: from this update on those can
-- never be confirmed (the preflight lists them). It refuses with 55000 unless
-- the thirteen functions it replaces have their reviewed bodies (or this
-- update's) and the audit view lists bank transfers. Only adds: no API
-- command, argument or grant is removed or changed, and no row is written. In
-- one transaction it:
--
-- 1. Adds private.invoice_transfers.expired_at and a fourth status 'expired'
--    (constraint invoice_transfers_expired: expired exactly when expired_at is
--    set). Existing rows are not changed.
-- 2. One rule, internal.invoice_transfer_expired(t): a transfer has expired
--    when it is marked expired, or when it still waits and was recorded 14 days
--    ago or longer (internal.invoice_transfer_expires_after(), the one
--    setting). internal.invoice_transfer_waiting(t) is "waiting and not
--    expired". Every command and read below uses them, so nothing depends on
--    the sweep having run:
--    - confirming and declining refuse an expired transfer (PT409
--      transfer_not_waiting), and so does the record guard;
--    - Pay now (internal.start_invoice_payment), voiding an invoice, recording
--      a transfer to an invoice and the account erasure hold wait only for a
--      transfer that is still waiting;
--    - the staff waiting list, the invoice "transfer_waiting" flag (staff and
--      member), the "Possible duplicate" count and the two new reads count an
--      expired transfer as expired.
-- 3. The sweep api.expire_waiting_bank_transfers(p_limit) (service role only,
--    1 to 50, so the subtransactions stay within the per-transaction cache)
--    records the status and the time of every transfer that has waited 14
--    days, oldest first, each row on its own: a row that cannot be changed is
--    returned with its SQLSTATE (the website's job logs it), tried again next
--    run, and never stops the others. Rows a staff member holds are skipped.
--    The website's operation job runs it every minute with p_limit 50.
-- 4. Recording a bank credit again: both record commands first record the
--    expiry of any waiting record of the same credit (or, for an invoice, to
--    the same invoice) that has waited 14 days, so the unique indexes (which,
--    like the commands, leave out declined and expired records) still allow
--    exactly one open record of a credit and of an invoice. A credit that
--    cleared more than 90 days ago is accepted only when it is exactly the
--    credit (bank reference, amount, date cleared) of an expired transfer of
--    the same account, and of the same invoice when that transfer named one.
--    The "Possible duplicate" count includes expired records of the same
--    money, so the second staff member is warned.
-- 5. The staff audit trail (private.frontend_staff_audit_events) lists each
--    expiry as 'payment:invoice_expired' with no staff member, the transfer as
--    its target and "Bank transfer <reference> expired: not confirmed within 14
--    days of being recorded", at the recorded expiry or, while the sweep has
--    not marked it, at the moment it passed 14 days; and each resolution
--    (below) as 'payment:invoice_expired_resolved' with the staff member.
-- 6. Retention (internal.retention_commerce) counts an expired transfer's five
--    tax years from its expiry; the privacy export
--    (internal.frontend_privacy_export_data) adds expired_at to each bank
--    transfer.
-- 7. Staff follow-up: api.resolve_expired_invoice_transfer(p_transfer_id,
--    p_resolution, p_reason) (payments:confirm_transfer, as confirming)
--    records once, with an audited reason, that the money of an expired
--    transfer was returned outside VerifyMzansi ('returned') or never arrived
--    ('never_arrived'): columns resolution, resolution_reason, resolved_by,
--    resolved_at, set only on an expired transfer, never by the staff member
--    who recorded it. Money so resolved cannot be recorded again as old
--    money, and the account erasure hold waits for an expired transfer not
--    yet followed up (internal.invoice_transfer_follow_up_open).
--    api.get_staff_expired_invoice_transfers() (payments:view) lists every
--    expired transfer not yet followed up, that is, neither resolved nor with
--    the same money recorded again and confirmed; oldest first, at most 200,
--    with the count. api.get_my_invoice_transfer_expiry(p_invoice_number) (the
--    member's own invoice) says when its latest transfer expired while the
--    invoice is unpaid,
--    else null). No existing read changes shape.
--
-- No email is sent; the member sees the expiry on the invoice page.
--
-- Safe in either order. Database first: the earlier website never calls the
-- sweep or the reads; transfers that have waited 14 days count as expired at
-- once (their invoices can be paid again) and confirming one shows the earlier
-- website's "no longer waiting" message. Website first: the release tolerates
-- the missing sweep and reads (no expiry shown) until this update is applied.
-- Read-only preflight: ../preflight/20261117141803_bank_transfer_expiry.check.sql.
-- Rollback: ../rollback/20261117141803_bank_transfer_expiry.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces have the reviewed bodies
-- (or this update's), and the audit view already lists bank transfers.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.invoice_transfer_guard()'),
      ('internal.confirm_staff_invoice_payment(uuid)'),
      ('internal.decline_staff_invoice_payment(uuid,text)'),
      ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)'),
      ('internal.get_staff_invoice_transfers()'),
      ('internal.customer_invoice_dto(private.customer_invoices,uuid)'),
      ('internal.start_invoice_payment(text,bigint,boolean)'),
      ('internal.void_staff_invoice(uuid,text)'),
      ('internal.account_erasure_hold(uuid)'),
      ('internal.retention_commerce(integer)'),
      ('internal.frontend_privacy_export_data(uuid)')) v(sig)
  loop
    if shape not in (
        'internal.invoice_transfer_guard() 494dcdb720573571dd36edf97b055332',
        'internal.invoice_transfer_guard() 40022dab9a8357b0b1ba4101c48f5196',
        'internal.confirm_staff_invoice_payment(uuid) e0c308df14f38f1de76bdced4e8683f2',
        'internal.confirm_staff_invoice_payment(uuid) 66e96f9682fbab67236ccf83142fbd05',
        'internal.decline_staff_invoice_payment(uuid,text) cc8641faee31c5a9a043e4c510d26302',
        'internal.decline_staff_invoice_payment(uuid,text) 2812080d676629d5f74e4f4d0063c368',
        'internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) 594b47bc794e335a3f3be505a4b1637e',
        'internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) dbf38f038bee7e1cf43b91288dbdab94',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 171c0ad6f18a7f5329ff00dcfff4608d',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 4f74538d08ca0abdac2103d71e0fdd07',
        'internal.invoice_transfer_dto(private.invoice_transfers,uuid) b91dbdd96bec847ddb165d6a663cc7cb',
        'internal.invoice_transfer_dto(private.invoice_transfers,uuid) 1817387f19f8a1fd9b278247f9e69c15',
        'internal.get_staff_invoice_transfers() 37ec35ae8968df035025e3c69234f3be',
        'internal.get_staff_invoice_transfers() 13f1c0cf67460052d334b32e70b1ebe8',
        'internal.customer_invoice_dto(private.customer_invoices,uuid) 5ce8a88fc44ed9e59a1cfd7dd6214382',
        'internal.customer_invoice_dto(private.customer_invoices,uuid) 27604995d3de7e7a5794c1bf220b3213',
        'internal.start_invoice_payment(text,bigint,boolean) 58e3e24aa91f41a476435c8b152b94d2',
        'internal.start_invoice_payment(text,bigint,boolean) ea362defef15f7d6116a0f96cc53fef5',
        'internal.void_staff_invoice(uuid,text) 21763bcb62e398b6d1b8e8d64ef38ea5',
        'internal.void_staff_invoice(uuid,text) 6c997c846aa9d114150e11d2591d5ad7',
        'internal.account_erasure_hold(uuid) 5bd01c33cf23f3e6516ceb96c3dc3236',
        'internal.account_erasure_hold(uuid) 42edfda741d3096f7ea7a7b0cb897d49',
        'internal.retention_commerce(integer) 422a63c6d6fd2be5a1556893a8975d3f',
        'internal.retention_commerce(integer) 55051470a07c224838cb58dc45d66406',
        'internal.frontend_privacy_export_data(uuid) 1a16274c11f77a9a6d72482ca43d6753',
        'internal.frontend_privacy_export_data(uuid) 86a879279ebd9dcadf6f3f4fa11e7f44') then
      raise exception 'bank transfer expiry precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.invoice_transfers') is null
    or not exists(select 1 from pg_attribute a where a.attrelid='private.invoice_transfers'::regclass
      and a.attname='customer_invoice_id' and not a.attisdropped)
    or coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) not like '%payment:invoice_declined%', true) then
    raise exception 'bank transfer expiry precondition: apply 20261114041000_customer_invoice_pay_now.sql first'
      using errcode='55000';
  end if;
end$$;

-- 1. The expired state.
alter table private.invoice_transfers add column if not exists expired_at timestamp with time zone;
alter table private.invoice_transfers drop constraint if exists invoice_transfers_status_check,
  add constraint invoice_transfers_status_check
    check (status = any (array['awaiting_confirmation'::text, 'confirmed'::text, 'declined'::text, 'expired'::text])),
  drop constraint if exists invoice_transfers_expired,
  add constraint invoice_transfers_expired check ((status = 'expired'::text) = (expired_at is not null));
-- An expired transfer's follow-up by staff (api.resolve_expired_invoice_transfer).
alter table private.invoice_transfers add column if not exists resolution text,
  add column if not exists resolution_reason text,
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolved_at timestamp with time zone;
alter table private.invoice_transfers drop constraint if exists invoice_transfers_resolution_check,
  add constraint invoice_transfers_resolution_check
    check (resolution is null or resolution = any (array['returned'::text, 'never_arrived'::text])),
  drop constraint if exists invoice_transfers_resolution_reason_check,
  add constraint invoice_transfers_resolution_reason_check
    check (resolution_reason is null or internal.plain_text_valid(resolution_reason, 5, 500, true)),
  drop constraint if exists invoice_transfers_resolved,
  add constraint invoice_transfers_resolved check ((resolved_at is null) = (resolved_by is null)
    and (resolved_at is null) = (resolution is null) and (resolved_at is null) = (resolution_reason is null)
    and (resolved_at is null or status = 'expired'::text));
create index if not exists invoice_transfers_resolved_by_idx on private.invoice_transfers (resolved_by)
  where resolved_by is not null;

-- 4. An expired transfer, like a declined one, holds neither its bank credit
-- nor its invoice.
drop index if exists private.invoice_transfers_open_reference_idx;
create unique index invoice_transfers_open_reference_idx on private.invoice_transfers
  (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')), amount_received_cents, cleared_on)
  where status <> all (array['declined'::text, 'expired'::text]);
drop index if exists private.invoice_transfers_customer_invoice_open_idx;
create unique index invoice_transfers_customer_invoice_open_idx on private.invoice_transfers (customer_invoice_id)
  where customer_invoice_id is not null and status <> all (array['declined'::text, 'expired'::text]);
create index if not exists invoice_transfers_expired_idx on private.invoice_transfers (expired_at)
  where status = 'expired';

-- 2. The setting and the rule (used by the bodies below).
-- The one setting: how long a recorded bank transfer may wait for a second
-- staff member before it expires. STABLE, not IMMUTABLE, so a changed value
-- is never folded into a plan a pooled connection keeps.
CREATE OR REPLACE FUNCTION internal.invoice_transfer_expires_after()
 RETURNS interval
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select interval '14 days';
$function$;
alter function internal.invoice_transfer_expires_after() owner to postgres;
revoke all on function internal.invoice_transfer_expires_after() from public, anon, authenticated, service_role;

-- The one rule: a transfer has expired when it is marked expired, or when it
-- still waits and was recorded 14 days ago or longer (the sweep has not marked
-- it yet). Every command and read uses this, so nothing depends on the sweep
-- having run.
CREATE OR REPLACE FUNCTION internal.invoice_transfer_expired(t private.invoice_transfers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select t.status = 'expired' or (t.status = 'awaiting_confirmation'
    and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after());
$function$;
alter function internal.invoice_transfer_expired(private.invoice_transfers) owner to postgres;
revoke all on function internal.invoice_transfer_expired(private.invoice_transfers) from public, anon, authenticated, service_role;

-- Waiting for a second staff member: recorded, not decided, not expired.
CREATE OR REPLACE FUNCTION internal.invoice_transfer_waiting(t private.invoice_transfers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select t.status = 'awaiting_confirmation' and not internal.invoice_transfer_expired(t);
$function$;
alter function internal.invoice_transfer_waiting(private.invoice_transfers) owner to postgres;
revoke all on function internal.invoice_transfer_waiting(private.invoice_transfers) from public, anon, authenticated, service_role;

-- An expired transfer not yet followed up: not resolved by staff, and its
-- money (reference, amount, date cleared) not recorded again and confirmed.
CREATE OR REPLACE FUNCTION internal.invoice_transfer_follow_up_open(t private.invoice_transfers)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.invoice_transfer_expired(t) and t.resolved_at is null
    and not exists(select 1 from private.invoice_transfers x where x.id <> t.id and x.status = 'confirmed'
      and x.amount_received_cents = t.amount_received_cents and x.cleared_on = t.cleared_on
      and upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
        = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')));
$function$;
alter function internal.invoice_transfer_follow_up_open(private.invoice_transfers) owner to postgres;
revoke all on function internal.invoice_transfer_follow_up_open(private.invoice_transfers) from public, anon, authenticated, service_role;

-- A bank credit (reference, amount, date cleared) that an expired, unresolved
-- transfer of the same account named (and of the same invoice, when that
-- transfer named one): it may be recorded again for them whatever its age.
-- Money staff marked returned or never arrived may not.
CREATE OR REPLACE FUNCTION internal.invoice_transfer_credit_expired(p_reference_key text, p_amount_cents bigint, p_cleared_on date, p_account_id uuid, p_invoice_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = p_reference_key
      and t.amount_received_cents = p_amount_cents and t.cleared_on = p_cleared_on
      and t.account_id = p_account_id
      and (t.customer_invoice_id is null or t.customer_invoice_id = p_invoice_id)
      and t.resolved_at is null
      and internal.invoice_transfer_expired(t));
$function$;
alter function internal.invoice_transfer_credit_expired(text,bigint,date,uuid,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_credit_expired(text,bigint,date,uuid,uuid) from public, anon, authenticated, service_role;

-- Records the expiry of one transfer that has waited 14 days (status, time;
-- the audit trail reads them); false when it is not such a transfer.
CREATE OR REPLACE FUNCTION internal.expire_invoice_transfer(p_transfer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.invoice_transfers t set status = 'expired', expired_at = statement_timestamp()
    where t.id = p_transfer_id and t.status = 'awaiting_confirmation'
      and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after();
  return found;
end;
$function$;
alter function internal.expire_invoice_transfer(uuid) owner to postgres;
revoke all on function internal.expire_invoice_transfer(uuid) from public, anon, authenticated, service_role;

-- 2, 4, 6. The replaced bodies.
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
  -- 20261117141803_bank_transfer_expiry.sql) to expired once it has waited 14
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

CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint; inv private.customer_invoices;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  t := internal.lock_invoice_transfer_for_review(p_transfer_id, actor);
  if t.status = 'confirmed' and t.confirmed_by = actor then
    return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('commissions',
      (select count(*) from private.partner_commissions c where c.payment_id = t.payment_id), 'repeated', true);
  end if;
  if t.status <> 'awaiting_confirmation' then
    raise exception 'this bank transfer was already %; it cannot be confirmed', t.status
      using errcode='PT409', detail='transfer_not_waiting';
  end if;
  -- One rule (20261117141803_bank_transfer_expiry.sql): a transfer that has
  -- waited 14 days has expired, whether or not the sweep has marked it.
  if internal.invoice_transfer_expired(t) then
    raise exception 'this bank transfer waited 14 days without confirmation and expired; it cannot be confirmed'
      using errcode='PT409', detail='transfer_not_waiting';
  end if;
  if internal.same_identity(actor, t.recorded_by) then
    raise exception 'a different staff member must confirm this bank transfer' using errcode='42501', detail='transfer_confirmer_same';
  end if;
  -- The recorder must still hold the authority to record, and must not have
  -- come to earn commission on this customer since recording.
  if not exists(select 1 from private.staff_roles r join private.staff_capabilities c on c.role = r.role
      where r.user_id = t.recorded_by and r.revoked_at is null and c.capability = 'payments:refund')
    or not exists(select 1 from private.current_account_access a where a.id = t.recorded_by) then
    raise exception 'the staff member who recorded this bank transfer can no longer record payments; decline it'
      using errcode='PT409', detail='transfer_recorder_inactive';
  end if;
  if exists(select 1 from private.account_acquisitions a join private.partners p on p.id = a.partner_id
      where a.account_id = t.account_id and internal.same_identity(t.recorded_by, p.account_id)) then
    raise exception 'the staff member who recorded this bank transfer referred the customer; decline it'
      using errcode='42501', detail='staff_referred_customer';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id = t.account_id) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(t.account_id);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before slots start'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, t.account_id) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  select * into plan from private.plan_versions v where v.id = t.plan_version_id;
  if plan.price_cents * t.slots <> t.amount_received_cents or not internal.individual_slot_plan(plan.plan_code) then
    raise exception 'the recorded amount is not the order total' using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  -- A transfer to an invoice pays that invoice: still issued and with no
  -- payment attempt that could still be paid.
  if t.customer_invoice_id is not null then
    select * into inv from private.customer_invoices i where i.id = t.customer_invoice_id for update;
    if inv.status = 'paid' then
      raise exception 'this invoice was already paid; decline this transfer and return the money'
        using errcode='PT409', detail='invoice_paid';
    elsif inv.status = 'void' then
      raise exception 'this invoice was voided; decline this transfer and return the money'
        using errcode='PT409', detail='invoice_void';
    end if;
    if exists(select 1 from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
        where l.invoice_id = inv.id and internal.customer_invoice_attempt_live(p)) then
      raise exception 'a payment of this invoice is still open at Ozow; try again when it has closed'
        using errcode='PT409', detail='invoice_payment_open';
    end if;
    -- An attempt never sent to Ozow is closed (as voiding does): the slot
    -- checkout cannot continue it, and it no longer counts as open below.
    update private.payments p set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
      from private.customer_invoice_payments l
      where l.invoice_id = inv.id and l.payment_id = p.id and p.status = 'pending';
  end if;
  -- Within the person's Individual slot limit (every account of the
  -- identity), counting checkouts still open at Ozow as checkout does, so a
  -- later Ozow payment is not pushed over the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  if (internal.individual_slots_counted(fingerprint, t.account_id, null)->>'held')::integer
      + (internal.individual_slots_counted(fingerprint, t.account_id, null)->>'pending')::integer + t.slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit or decline' using errcode='PT429', detail='slot_limit_reached';
  end if;
  insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, provider,
      status, fulfillment_status, completed_at, status_changed_at)
    values (t.account_id, 'plan', plan.id, t.amount_received_cents, plan.currency, jsonb_build_object('kind', 'plan',
        'category', 'individual', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', t.slots, 'total_cents', t.amount_received_cents,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', case when t.slots = 1 then plan.label else t.slots::text || ' × ' || plan.label end,
        'payment_method', 'invoice', 'invoice_transfer_id', t.id,
        'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'),
        'cooling_off_consent', jsonb_build_object('method', 'written', 'recorded_by_staff_at', t.recorded_at,
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording', 'My slot starts now; the 7-day cooling-off does not apply because the service starts immediately'))
        || case when inv.id is null then '{}'::jsonb else jsonb_build_object('customer_invoice_id', inv.id,
          'customer_invoice_number', inv.invoice_number) end,
      'invoice', 'complete', 'fulfilled', statement_timestamp(), statement_timestamp())
    returning * into pay;
  insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
    select pay.id, n, plan.id, plan.price_cents from pg_catalog.generate_series(1, t.slots) n;
  -- One slot per line, starting now, exactly as a confirmed Ozow payment.
  insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
    activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
  select pay.owner_id, 'retail_paid', plan.area, pay.id, l.id, plan.slot_capacity, plan.activations_per_period,
    plan.activation_period_days, plan.max_photos, plan.max_videos, statement_timestamp(),
    statement_timestamp() + make_interval(days => plan.duration_days), plan.addon_capabilities
  from private.payment_lines l where l.payment_id = pay.id order by l.line_number;
  get diagnostics made = row_count;
  vat := internal.payment_invoice_vat(pay);
  insert into private.invoices (payment_id, invoice_number, amount_ex_vat_cents, vat_cents, total_cents, description)
  values (pay.id, 'INV-' || to_char(statement_timestamp() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-'
      || upper(left(replace(pay.id::text, '-', ''), 10)),
    pay.amount_cents - vat, vat, pay.amount_cents, pay.snapshot->>'invoice_description');
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_completed', pay.id, pay.owner_id, 'payment_completed:' || pay.id);
  -- The payment is inserted complete, so the commission trigger (on a status
  -- change) does not fire: the delivered purchase earns its commission here.
  commissions := internal.payment_delivery_commission(pay.id);
  update private.invoice_transfers set status = 'confirmed', confirmed_by = actor,
      confirmed_at = statement_timestamp(), payment_id = pay.id
    where id = t.id returning * into t;
  if inv.id is not null then
    update private.customer_invoices set status = 'paid', payment_id = pay.id, paid_at = pay.completed_at
      where id = inv.id;
  end if;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(actor, t.account_id);
  return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('commissions', commissions,
    'slots_started', made, 'ends_at', statement_timestamp() + make_interval(days => plan.duration_days),
    'repeated', false);
end;
$function$;
alter function internal.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function internal.confirm_staff_invoice_payment(uuid) from public;
grant execute on function internal.confirm_staff_invoice_payment(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.decline_staff_invoice_payment(p_transfer_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'decline reason required' using errcode='22023';
  end if;
  t := internal.lock_invoice_transfer_for_review(p_transfer_id, actor);
  if t.status = 'declined' and t.declined_by = actor and t.decline_reason = btrim(p_reason) then
    return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('repeated', true);
  end if;
  if t.status <> 'awaiting_confirmation' then
    raise exception 'this bank transfer was already %; it cannot be declined', t.status
      using errcode='PT409', detail='transfer_not_waiting';
  end if;
  -- One rule (20261117141803_bank_transfer_expiry.sql): a transfer that has
  -- waited 14 days has expired, whether or not the sweep has marked it.
  if internal.invoice_transfer_expired(t) then
    raise exception 'this bank transfer waited 14 days without confirmation and expired; it cannot be declined'
      using errcode='PT409', detail='transfer_not_waiting';
  end if;
  update private.invoice_transfers set status = 'declined', declined_by = actor,
      declined_at = statement_timestamp(), decline_reason = btrim(p_reason)
    where id = t.id returning * into t;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.decline_staff_invoice_payment(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_invoice_payment(uuid,text) from public;
grant execute on function internal.decline_staff_invoice_payment(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_invoice_payment(p_account_email text, p_term_days integer, p_slots integer, p_amount_cents bigint, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; reference text; reference_key text; cleared date; today date;
  plan private.plan_versions; prior private.invoice_transfers; made private.invoice_transfers; fingerprint text;
  open_invoice private.customer_invoices;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 or p_term_days is null
      or p_term_days not in (30, 90, 180) or p_slots is null or p_slots not between 1 and 25
      or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'customer email, slot term, number of slots and amount received required'
      using errcode='22023', detail='invoice_payment_invalid';
  end if;
  if p_amount_cents > 5000000 then
    raise exception 'bank transfers above R50,000 cannot be recorded yet' using errcode='PT413', detail='invoice_amount_above_limit';
  end if;
  reference := regexp_replace(btrim(coalesce(p_bank_reference, '')), '\s+', ' ', 'g');
  if reference = '' then
    raise exception 'bank reference required' using errcode='22023', detail='bank_reference_required';
  end if;
  if reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'
      or length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) < 4 then
    raise exception 'bank reference must be 4 to 60 letters, digits, spaces or . _ : / -'
      using errcode='22023', detail='bank_reference_invalid';
  end if;
  reference_key := upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g'));
  today := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  if p_cleared_on is null or p_cleared_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end if;
  begin
    cleared := p_cleared_on::date;
  exception when others then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end;
  -- More than 90 days ago only to record again exactly the bank credit of an
  -- expired transfer (checked below, under the locks).
  if cleared > today then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  if p_cooling_off_waiver is distinct from true then
    raise exception 'confirm the customer agreed in writing to the cooling-off waiver'
      using errcode='22023', detail='cooling_off_waiver_required';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- One bank reference at a time, then the person.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-bank-reference:'||reference_key, 707));
  perform internal.lock_evidence_subject(buyer);
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  -- 20261117141803_bank_transfer_expiry.sql: a waiting record of this bank
  -- credit that has waited 14 days is marked expired first, so it
  -- no longer holds them; the unique indexes still allow one open record. A
  -- credit that cleared more than 90 days ago is accepted only to record again
  -- exactly the credit of an expired transfer of the same account (and of the
  -- same invoice, when that transfer named one).
  perform internal.expire_invoice_transfer(t.id) from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and (t.amount_received_cents = p_amount_cents and t.cleared_on = cleared
        and upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key);
  if cleared < today - 90 and not internal.invoice_transfer_credit_expired(reference_key, p_amount_cents, cleared,
      buyer, null) then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  -- The same bank credit (reference, amount, date cleared) waiting or
  -- confirmed: the same request again by the same staff member returns it;
  -- anything else is refused. A declined or expired record does not count.
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key
      and t.amount_received_cents = p_amount_cents and t.cleared_on = cleared
      and t.status not in ('declined', 'expired');
  if found then
    if prior.recorded_by = actor and prior.account_id = buyer and prior.reason = btrim(p_reason)
        and prior.slots = p_slots
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.invoice_transfer_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'a bank transfer with that reference, amount and date was already recorded (%)', replace(prior.status, '_', ' ')
      using errcode='PT409', detail='bank_reference_used';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id = buyer) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  select * into plan from private.plan_versions v
    where v.plan_code = 'individual_'||p_term_days||'d' and v.retired_at is null and v.is_public
      and internal.individual_slot_plan(v.plan_code)
    order by v.version desc limit 1;
  if not found then
    raise exception 'no slot for that term is on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(buyer);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before slots are recorded'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, buyer) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  if plan.price_cents * p_slots <> p_amount_cents then
    raise exception 'the amount received is not the order total of % cents', plan.price_cents * p_slots
      using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  -- A transfer of the total of one of the customer's unpaid invoices is
  -- recorded against that invoice (api.record_staff_invoice_transfer), so it
  -- pays the invoice.
  select * into open_invoice from private.customer_invoices i
    where i.account_id = buyer and i.status = 'issued' and i.total_cents = p_amount_cents
    order by i.issued_at limit 1;
  if found then
    raise exception 'this customer has unpaid invoice % for this amount; record the transfer on the invoice',
      open_invoice.invoice_number using errcode='PT409', detail='invoice_transfer_required';
  end if;
  -- An early check of the slot limit; confirmation checks it again.
  if (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer + p_slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  insert into private.invoice_transfers (account_id, plan_version_id, slots, amount_received_cents, bank_reference,
      cleared_on, cooling_off_waiver_confirmed, reason, recorded_by)
    values (buyer, plan.id, p_slots, p_amount_cents, reference, cleared, true, btrim(p_reason), actor)
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  return internal.invoice_transfer_dto(made, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) from public;
grant execute on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_invoice_transfer(p_invoice_number text, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices; plan private.plan_versions; reference text; reference_key text;
  cleared date; today date; audit_reason text; prior private.invoice_transfers; made private.invoice_transfers;
  fingerprint text;
begin
  actor := internal.staff_actor('payments:refund');
  reference := regexp_replace(btrim(coalesce(p_bank_reference, '')), '\s+', ' ', 'g');
  if reference = '' then
    raise exception 'bank reference required' using errcode='22023', detail='bank_reference_required';
  end if;
  if reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'
      or length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) < 4 then
    raise exception 'bank reference must be 4 to 60 letters, digits, spaces or . _ : / -'
      using errcode='22023', detail='bank_reference_invalid';
  end if;
  reference_key := upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g'));
  today := internal.customer_invoice_day(statement_timestamp());
  if p_cleared_on is null or p_cleared_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end if;
  begin
    cleared := p_cleared_on::date;
  exception when others then
    raise exception 'date the money cleared required' using errcode='22023', detail='cleared_date_invalid';
  end;
  -- More than 90 days ago only to record again exactly the bank credit of an
  -- expired transfer (checked below, under the locks).
  if cleared > today then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  if p_cooling_off_waiver is distinct from true then
    raise exception 'confirm the customer agreed in writing to the cooling-off waiver'
      using errcode='22023', detail='cooling_off_waiver_required';
  end if;
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number);
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  audit_reason := 'Invoice ' || inv.invoice_number || ': ' || btrim(coalesce(p_reason, ''));
  if not coalesce(internal.plain_text_valid(btrim(coalesce(p_reason, '')), 5, 478, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  -- One bank reference at a time, then the person, then the invoice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-bank-reference:'||reference_key, 707));
  perform internal.lock_evidence_subject(inv.account_id);
  select * into inv from private.customer_invoices i where i.id = inv.id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  perform internal.assert_staff_not_referrer(actor, inv.account_id);
  -- 20261117141803_bank_transfer_expiry.sql: a waiting record of this bank
  -- credit or of this invoice that has waited 14 days is marked expired first, so it
  -- no longer holds them; the unique indexes still allow one open record. A
  -- credit that cleared more than 90 days ago is accepted only to record again
  -- exactly the credit of an expired transfer of the same account (and of the
  -- same invoice, when that transfer named one).
  perform internal.expire_invoice_transfer(t.id) from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and (t.customer_invoice_id = inv.id or (t.amount_received_cents = inv.total_cents and t.cleared_on = cleared
        and upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key));
  if cleared < today - 90 and not internal.invoice_transfer_credit_expired(reference_key, inv.total_cents, cleared,
      inv.account_id, inv.id) then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  -- The same bank credit waiting or confirmed: the same request again by the
  -- same staff member returns it; anything else is refused. A declined or
  -- expired record does not count.
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key
      and t.amount_received_cents = inv.total_cents and t.cleared_on = cleared
      and t.status not in ('declined', 'expired');
  if found then
    if prior.recorded_by = actor and prior.customer_invoice_id = inv.id and prior.reason = audit_reason then
      return internal.invoice_transfer_dto(prior, actor)
        || jsonb_build_object('invoice_number', inv.invoice_number, 'repeated', true);
    end if;
    raise exception 'a bank transfer with that reference, amount and date was already recorded (%)', replace(prior.status, '_', ' ')
      using errcode='PT409', detail='bank_reference_used';
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
  elsif inv.status = 'void' then
    raise exception 'this invoice was voided' using errcode='PT409', detail='invoice_void';
  end if;
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and internal.invoice_transfer_waiting(t)) then
    raise exception 'a bank transfer to this invoice already waits for confirmation'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  if exists(select 1 from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = inv.id and internal.customer_invoice_attempt_live(p)) then
    raise exception 'a payment of this invoice is still open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_payment_open';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id = inv.account_id) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and internal.individual_slot_plan(v.plan_code) and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice''s slot is no longer sold at its price' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(inv.account_id);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before slots are recorded'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, inv.account_id) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  -- An early check of the slot limit; confirmation checks it again.
  if (internal.individual_slots_counted(fingerprint, inv.account_id, null)->>'held')::integer + inv.slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  -- An attempt never sent to Ozow is closed, so the slot checkout cannot
  -- continue it while the transfer waits.
  update private.payments p set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
    from private.customer_invoice_payments l
    where l.invoice_id = inv.id and l.payment_id = p.id and p.status = 'pending';
  insert into private.invoice_transfers (account_id, plan_version_id, slots, amount_received_cents, bank_reference,
      cleared_on, cooling_off_waiver_confirmed, reason, recorded_by, customer_invoice_id)
    values (inv.account_id, plan.id, inv.slots, inv.total_cents, reference, cleared, true, audit_reason, actor, inv.id)
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  return internal.invoice_transfer_dto(made, actor)
    || jsonb_build_object('invoice_number', inv.invoice_number, 'repeated', false);
end;
$function$;
alter function internal.record_staff_invoice_transfer(text,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_staff_invoice_transfer(text,text,text,boolean,text) from public;
grant execute on function internal.record_staff_invoice_transfer(text,text,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.invoice_transfer_dto(t private.invoice_transfers, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('transfer_id', t.id, 'status', t.status, 'account_id', t.account_id,
    'customer_email', (select u.email from auth.users u where u.id = t.account_id),
    'similar_records', (select count(*) from private.invoice_transfers x where x.id <> t.id
      and x.status <> 'declined' and x.amount_received_cents = t.amount_received_cents
      -- 20261117141803: an expired record counts only for the same money
      -- (reference, amount, date cleared), so a record of it again is flagged.
      and ((not internal.invoice_transfer_expired(x)
          and (upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
              = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g'))
            or (x.account_id = t.account_id and x.cleared_on = t.cleared_on)))
        or (internal.invoice_transfer_expired(x) and x.cleared_on = t.cleared_on
          and upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
            = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g'))))),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.account_id)),
    'term_days', (select v.duration_days from private.plan_versions v where v.id = t.plan_version_id),
    'slots', t.slots, 'amount_received_cents', t.amount_received_cents, 'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'), 'reason', t.reason,
    'recorded_at', t.recorded_at, 'recorded_by_me', internal.same_identity(t.recorded_by, p_actor),
    'recorded_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.recorded_by)),
    'payment_id', t.payment_id);
$function$;
alter function internal.invoice_transfer_dto(private.invoice_transfers,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_dto(private.invoice_transfers,uuid) from public;

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_transfers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  select jsonb_build_object('waiting', (select count(*) from private.invoice_transfers t where internal.invoice_transfer_waiting(t)),
      'items', coalesce(jsonb_agg(internal.invoice_transfer_dto(t, actor) order by t.recorded_at, t.id), '[]'::jsonb))
    into result
  from (select * from private.invoice_transfers x where internal.invoice_transfer_waiting(x)
    order by x.recorded_at, x.id limit 50) t;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_invoice_transfers() from public;
grant execute on function internal.get_staff_invoice_transfers() to authenticated;

CREATE OR REPLACE FUNCTION internal.customer_invoice_dto(i private.customer_invoices, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issued_at', i.issued_at, 'due_on', to_char(i.due_on::timestamp, 'YYYY-MM-DD'),
    'seller', i.seller,
    'buyer', case when i.buyer_name is null then null else jsonb_build_object('name', i.buyer_name,
      'address', i.buyer_address, 'registration_number', i.buyer_registration_number) end,
    'revision', i.revision, 'term_days', (select v.duration_days from private.plan_versions v where v.id = i.plan_version_id),
    'slots', i.slots, 'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents,
    'description', i.description, 'currency', 'ZAR', 'payment_reference', i.invoice_number,
    'cooling_off_consent_at', i.cooling_off_consent_at, 'cooling_off_consent_version', i.cooling_off_consent_version,
    'consent', internal.customer_invoice_consent(),
    'paid_at', i.paid_at, 'payment_id', i.payment_id,
    'payment_status', (select p.status from private.payments p where p.id = i.payment_id),
    'voided_at', i.voided_at,
    'transfer_waiting', exists(select 1 from private.invoice_transfers t
      where t.customer_invoice_id = i.id and internal.invoice_transfer_waiting(t)),
    'latest_attempt', (select jsonb_build_object('payment_id', p.id, 'attempt', l.attempt, 'status', p.status,
        'checkout_open', p.status = 'pending' and p.checkout_url is not null
          and p.checkout_expires_at > pg_catalog.clock_timestamp())
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id order by l.attempt desc limit 1))
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', i.account_id,
    'customer_email', (select u.email from auth.users u where u.id = i.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.account_id)),
    'issued_by_me', internal.same_identity(i.issued_by, p_staff),
    'issued_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.issued_by)),
    'issue_reason', i.issue_reason, 'void_reason', i.void_reason,
    'attempts', (select count(*) from private.customer_invoice_payments l where l.invoice_id = i.id),
    'extra_payments', coalesce((select jsonb_agg(p.id order by p.completed_at, p.id)
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id and p.completed_at is not null and p.id is distinct from i.payment_id), '[]'::jsonb)) end;
$function$;
alter function internal.customer_invoice_dto(private.customer_invoices,uuid) owner to postgres;
revoke all on function internal.customer_invoice_dto(private.customer_invoices,uuid) from public;

CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent();
begin
  if p_expected_total_cents is null then
    raise exception 'invoice total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023', detail='invoice_consent_required';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and internal.invoice_transfer_waiting(t)) then
    raise exception 'your bank transfer to this invoice is being checked; you do not need to pay again'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  if inv.buyer_name is null then
    raise exception 'add your billing details before paying' using errcode='PT409', detail='invoice_billing_required';
  end if;
  if inv.total_cents <> p_expected_total_cents then
    raise exception 'the invoice total is % cents', inv.total_cents using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id and v.retired_at is null
    and v.is_public and internal.individual_slot_plan(v.plan_code) and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice can no longer be paid online; ask for a new one'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you pay' using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, actor) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  -- One person at a time (every account of the identity), then this account,
  -- as the slot checkout does.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select p.* into latest from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
    where l.invoice_id = inv.id order by l.attempt desc limit 1 for update of p;
  if latest.id is not null then
    if latest.status in ('complete', 'refunded', 'chargeback') then
      raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
    end if;
    if latest.status = 'pending' and latest.checkout_url is not null
        and latest.checkout_expires_at > pg_catalog.clock_timestamp() then
      -- Its Ozow page is still open: the customer continues there.
      perform internal.price_draft_actor();
      return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
        'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
        'slots', inv.slots, 'reused', true);
    end if;
    if internal.customer_invoice_attempt_live(latest) then
      raise exception 'your last payment of this invoice is still being checked; try again in a few minutes'
        using errcode='PT409', detail='invoice_payment_checking';
    end if;
    if latest.status <> 'pending' then
      latest := null; -- closed (expired, cancelled or failed): a new attempt
    end if;
  end if;
  -- Above the most Ozow accepts in one payment: the invoice is paid by bank
  -- transfer only (staff record it; a second staff member confirms it). After
  -- the "already paid" check, so a paid invoice still says it is paid.
  if inv.total_cents > internal.online_payment_max_cents() then
    raise exception 'this invoice is above the online payment limit of % cents; pay it by bank transfer',
      internal.online_payment_max_cents() using errcode='PT413', detail='online_payment_above_limit';
  end if;
  if latest.id is null then
    select count(*) into attempts from private.customer_invoice_payments l where l.invoice_id = inv.id;
    if attempts >= 20 then
      raise exception 'this invoice has had too many payment attempts; contact us'
        using errcode='PT429', detail='invoice_attempts_exhausted';
    end if;
    -- Another payment open for the same slot term (one per term at a time).
    select * into other from private.payments p
      where p.owner_id = actor and p.status = 'pending' and p.plan_version_id = plan.id and p.target_post_id is null
      for update;
    if found then
      if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
        raise exception 'finish or cancel your other open payment for this slot first'
          using errcode='PT409', detail='invoice_checkout_open';
      end if;
      -- Never sent to Ozow, so it can never be paid: closed.
      update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
        where id = other.id;
    end if;
  end if;
  counted := internal.individual_slots_counted(fingerprint, actor, latest.id);
  if (counted->>'held')::integer + (counted->>'pending')::integer + inv.slots > internal.individual_slot_limit(fingerprint) then
    raise exception 'you can hold at most % Individual slots at a time', internal.individual_slot_limit(fingerprint)
      using errcode='PT429', detail='slot_limit_reached';
  end if;
  if inv.cooling_off_consent_at is null then
    update private.customer_invoices set cooling_off_consent_at = statement_timestamp(),
        cooling_off_consent_version = consent->>'version'
      where id = inv.id returning * into inv;
  end if;
  if latest.id is not null then
    -- An attempt never sent to Ozow: the website sends it now.
    perform internal.price_draft_actor();
    return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
      'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
      'slots', inv.slots, 'reused', true);
  end if;
  insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
    values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
        'category', 'individual', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', inv.description,
        'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
        'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
          'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton))),
      case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
    returning * into pay;
  insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
    select pay.id, n, plan.id, inv.unit_price_cents from pg_catalog.generate_series(1, inv.slots) n;
  insert into private.customer_invoice_payments (payment_id, invoice_id, attempt) values (pay.id, inv.id, attempts + 1);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', inv.slots, 'reused', false);
end;
$function$;
alter function internal.start_invoice_payment(text,bigint,boolean) owner to postgres;
revoke all on function internal.start_invoice_payment(text,bigint,boolean) from public;
grant execute on function internal.start_invoice_payment(text,bigint,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.void_staff_invoice(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices;
begin
  actor := internal.staff_actor('payments:refund');
  if p_invoice_id is null then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  select * into inv from private.customer_invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  perform internal.lock_kept_record_subject(inv.account_id, inv.id);
  select * into inv from private.customer_invoices i where i.id = p_invoice_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after the lock waits
  perform internal.assert_staff_payment_actor(actor, inv.account_id);
  if inv.status = 'void' and inv.voided_by = actor and inv.void_reason = btrim(p_reason) then
    return internal.customer_invoice_dto(inv, actor) || jsonb_build_object('repeated', true);
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is paid; refund the payment instead' using errcode='PT409', detail='invoice_paid';
  elsif inv.status = 'void' then
    raise exception 'this invoice is already void' using errcode='PT409', detail='invoice_void';
  end if;
  if exists(select 1 from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = inv.id and internal.customer_invoice_attempt_live(p)) then
    raise exception 'a payment of this invoice is still open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_payment_open';
  end if;
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and internal.invoice_transfer_waiting(t)) then
    raise exception 'a bank transfer to this invoice waits for confirmation; confirm or decline it first'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  update private.payments p set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
    from private.customer_invoice_payments l
    where l.invoice_id = inv.id and l.payment_id = p.id and p.status = 'pending';
  update private.customer_invoices set status = 'void', voided_by = actor, voided_at = statement_timestamp(),
      void_reason = btrim(p_reason)
    where id = inv.id returning * into inv;
  perform internal.staff_actor('payments:refund');
  return internal.customer_invoice_dto(inv, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.void_staff_invoice(uuid,text) owner to postgres;
revoke all on function internal.void_staff_invoice(uuid,text) from public;
grant execute on function internal.void_staff_invoice(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.account_erasure_hold(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when exists (select 1 from private.legal_holds h where h.subject_id = p_user and h.released_at is null)
      then 'legal_hold'
    when exists (select 1 from private.evidence_cases c join private.evidence_fraud_holds f on f.case_id = c.id
        where c.subject_id = p_user and f.closed_at is null)
      then 'fraud_hold'
    when exists (select 1 from private.frontend_content_holds h where h.released_at is null
        and (h.account_id = p_user or h.post_id in (select p.id from private.posts p where p.owner_id = p_user)))
      then 'content_hold'
    when exists (select 1 from private.reports r where r.status = 'open'
        and (r.subject_account_id = p_user or r.post_id in (select p.id from private.posts p where p.owner_id = p_user)))
      then 'report_open'
    when exists (select 1 from private.staff_roles r where r.user_id = p_user and r.revoked_at is null)
      then 'staff_role'
    -- Staff rejected the deletion request (recorded on the erasure itself, so
    -- it outlives the request record) and no later request was ordered.
    when exists (select 1 from private.account_erasures e where e.user_id = p_user and e.rejected_at is not null)
      then 'request_rejected'
    when exists (select 1 from private.payments p where p.owner_id = p_user and p.status = 'pending')
      then 'payment_pending'
    when exists (select 1 from private.payments p where p.owner_id = p_user and p.status = 'complete'
        and p.fulfillment_status = 'needs_reconciliation')
      then 'payment_unresolved'
    when exists (select 1 from private.payment_refund_requests r where r.account_id = p_user
        and r.status in ('awaiting_approval', 'approved', 'sent'))
      then 'refund_open'
    -- 20261117141803: also an expired transfer not yet followed up, so the
    -- erasure never leaves an expiry without its follow-up.
    when exists (select 1 from private.invoice_transfers t where t.account_id = p_user
        and (internal.invoice_transfer_waiting(t) or internal.invoice_transfer_follow_up_open(t)))
      then 'transfer_waiting'
    when exists (select 1 from private.customer_invoices i where i.account_id = p_user and i.status = 'issued')
      then 'invoice_unpaid'
    when exists (select 1 from private.partner_commissions c join private.partners x on x.id = c.partner_id
        where x.account_id = p_user and c.status in ('pending', 'approved'))
      then 'commission_unpaid'
  end;
$function$;
alter function internal.account_erasure_hold(uuid) owner to postgres;
revoke all on function internal.account_erasure_hold(uuid) from public;

CREATE OR REPLACE FUNCTION internal.retention_commerce(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer; customer_invoices integer; bank_transfers integer; slot_packages integer;
begin
  delete from private.provider_events where id in(select e.id from private.provider_events e
    where internal.retention_tax_year_due(e.received_at) order by e.received_at limit p_limit);
  get diagnostics provider_events=row_count;
  delete from private.invoices where id in(select i.id from private.invoices i
    where internal.retention_tax_year_due(i.issued_at) order by i.issued_at limit p_limit);
  get diagnostics invoices=row_count;
  -- Recorded bank transfers: five tax years after they were confirmed,
  -- declined, expired or recorded, and always with the invoice they name.
  delete from private.invoice_transfers where id in(select t.id from private.invoice_transfers t
    where internal.retention_tax_year_due(coalesce(t.confirmed_at,t.declined_at,t.expired_at,t.recorded_at))
      or t.customer_invoice_id in(select i.id from private.customer_invoices i
        where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at)))
    order by t.recorded_at limit p_limit);
  get diagnostics bank_transfers=row_count;
  delete from private.customer_invoice_payments where invoice_id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at))
      and not exists(select 1 from private.invoice_transfers t where t.customer_invoice_id=i.id)
    order by i.issued_at limit p_limit);
  delete from private.customer_invoices where id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at))
      and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id=i.id)
      and not exists(select 1 from private.invoice_transfers t where t.customer_invoice_id=i.id)
    order by i.issued_at limit p_limit);
  get diagnostics customer_invoices=row_count;
  delete from private.post_addon_windows where id in(select w.id from private.post_addon_windows w
    where coalesce(w.revoked_at,w.ends_at)<=statement_timestamp()
      and internal.retention_tax_year_due(coalesce(w.revoked_at,w.ends_at)) order by w.ends_at limit p_limit);
  get diagnostics addon_windows=row_count;
  delete from private.partner_events where id in(select e.id from private.partner_events e
    where internal.retention_tax_year_due(e.created_at) order by e.created_at limit p_limit);
  get diagnostics partner_events=row_count;
  delete from private.partner_commissions where id in(select c.id from private.partner_commissions c
    where c.status in('paid','reversed') and internal.retention_tax_year_due(coalesce(c.reversed_at,c.paid_at))
      and not exists(select 1 from private.partner_events e where e.commission_id=c.id)
    order by c.created_at limit p_limit for update skip locked);
  get diagnostics commissions=row_count;
  delete from private.account_acquisitions where account_id in(select a.account_id from private.account_acquisitions a
    where internal.retention_tax_year_due(a.recorded_at) order by a.recorded_at limit p_limit);
  get diagnostics acquisitions=row_count;
  delete from private.organisation_sponsorships where id in(select s.id from private.organisation_sponsorships s
    where s.status in('ended','revoked') and internal.retention_tax_year_due(s.ended_at)
    order by s.ended_at limit p_limit for update skip locked);
  get diagnostics sponsorships=row_count;
  delete from private.post_trial_claims where post_id in(select c.post_id from private.post_trial_claims c
    where internal.retention_tax_year_due(coalesce(c.converted_at,c.claimed_at)) order by c.claimed_at limit p_limit);
  get diagnostics trial_claims=row_count;
  delete from private.post_activations where id in(select a.id from private.post_activations a
    where a.released_at is not null and internal.retention_tax_year_due(a.released_at)
      and not exists(select 1 from private.post_trial_claims c where c.converted_by_activation_id=a.id)
    order by a.released_at limit p_limit for update skip locked);
  get diagnostics activations=row_count;
  -- A slot's periods go newest first: a grant stays while a later renewal (or
  -- a payment line) still names it.
  delete from private.entitlements where id in(select e.id from private.entitlements e
    where (e.status='revoked' or e.ends_at<=statement_timestamp())
      and internal.retention_tax_year_due(coalesce(e.ends_at,e.created_at))
      and not exists(select 1 from private.organisation_sponsorships s where s.entitlement_id=e.id)
      and not exists(select 1 from private.post_activations a where a.entitlement_id=e.id)
      and not exists(select 1 from private.post_trial_claims c where c.trial_entitlement_id=e.id)
      and not exists(select 1 from private.trial_identities t where t.entitlement_id=e.id)
      and not exists(select 1 from private.entitlements r where r.renews_entitlement_id=e.id or r.slot_id=e.id)
      and not exists(select 1 from private.payment_lines l where l.renews_entitlement_id=e.id)
    order by e.created_at limit p_limit for update skip locked);
  get diagnostics entitlements=row_count;
  -- A Multi-listing package (20261114154823) goes with the last of its grants,
  -- which follow their payments' five tax years.
  delete from private.slot_packages where id in(select k.id from private.slot_packages k
    where internal.retention_tax_year_due(k.created_at)
      and not exists(select 1 from private.entitlements e where e.package_id=k.id)
    order by k.created_at limit p_limit for update skip locked);
  get diagnostics slot_packages=row_count;
  delete from private.payments where id in(select p.id from private.payments p
    where p.status<>'pending' and internal.retention_tax_year_due(coalesce(p.completed_at,p.status_changed_at,p.created_at))
      and not exists(select 1 from private.entitlements e where e.payment_id=p.id)
      and not exists(select 1 from private.invoices i where i.payment_id=p.id)
      and not exists(select 1 from private.partner_commissions c where c.payment_id=p.id)
      and not exists(select 1 from private.post_addon_windows w where w.payment_id=p.id)
      and not exists(select 1 from private.provider_events e where e.payment_id=p.id)
      and not exists(select 1 from private.customer_invoice_payments l where l.payment_id=p.id)
      and not exists(select 1 from private.customer_invoices ci where ci.payment_id=p.id)
      and not exists(select 1 from private.invoice_transfers t where t.payment_id=p.id)
    order by p.created_at limit p_limit for update skip locked);
  get diagnostics payments=row_count;
  return jsonb_build_object('provider_events',provider_events,'invoices',invoices,'addon_windows',addon_windows,
    'partner_events',partner_events,'partner_commissions',commissions,'account_acquisitions',acquisitions,
    'sponsorships',sponsorships,'post_trial_claims',trial_claims,'post_activations',activations,
    'entitlements',entitlements,'payments',payments,'customer_invoices',customer_invoices,
    'bank_transfers',bank_transfers,'slot_packages',slot_packages);
end;
$function$;
alter function internal.retention_commerce(integer) owner to postgres;
revoke all on function internal.retention_commerce(integer) from public;

CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('signup_terms',$q$select version,document_hash,method,accepted_at from private.signup_terms_acceptances where account_id=$1$q$),
    ('communication_choices',$q$select purpose,granted,wording_version,recorded_at from private.communication_choice_events
      where account_id=$1 order by recorded_at,id$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

-- 3 and 7. The sweep and the two reads.
-- The sweep: records the expiry of every transfer that has waited 14 days,
-- oldest first, at most p_limit (1 to 50, so the subtransactions stay within
-- the per-transaction cache) per run, each in its own subtransaction so one
-- row that cannot be changed never stops the others: it is returned with its
-- SQLSTATE (the worker logs it) and tried again next run, and every command,
-- read and the audit trail already treat it as expired. Rows a staff member
-- holds at that moment are skipped.
CREATE OR REPLACE FUNCTION internal.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare due uuid[]; one uuid; expired integer := 0; with_invoice integer := 0; failures jsonb := '[]'::jsonb;
  state text;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'limit 1 to 50' using errcode='22023';
  end if;
  select coalesce(array_agg(x.id order by x.recorded_at, x.id), '{}') into due
  from (select t.id, t.recorded_at from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after()
    order by t.recorded_at, t.id
    limit p_limit
    for update skip locked) x;
  foreach one in array due loop
    begin
      if internal.expire_invoice_transfer(one) then
        expired := expired + 1;
        if exists(select 1 from private.invoice_transfers t where t.id = one and t.customer_invoice_id is not null) then
          with_invoice := with_invoice + 1;
        end if;
      end if;
    exception when others then
      get stacked diagnostics state = returned_sqlstate;
      failures := failures || jsonb_build_array(jsonb_build_object('transfer_id', one, 'sqlstate', state));
    end;
  end loop;
  return jsonb_build_object('expired', expired, 'with_invoice', with_invoice,
    'failed', jsonb_array_length(failures), 'failures', failures);
end;
$function$;
alter function internal.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function internal.expire_waiting_bank_transfers(integer) from public, anon, authenticated, service_role;
grant execute on function internal.expire_waiting_bank_transfers(integer) to service_role;

CREATE OR REPLACE FUNCTION api.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.expire_waiting_bank_transfers(p_limit);
$function$;
alter function api.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function api.expire_waiting_bank_transfers(integer) from public, anon, authenticated, service_role;
grant execute on function api.expire_waiting_bank_transfers(integer) to service_role;

-- Staff (payments:view): every expired transfer still to be followed up,
-- oldest expiry first, at most 200 (with the full count). One is followed up
-- only when the same money (reference, amount, date cleared) was recorded
-- again and confirmed, or a staff member resolved it
-- (api.resolve_expired_invoice_transfer). Each as the waiting list shows it,
-- with status 'expired', when it expired (or, before the sweep marked it, when
-- it passed 14 days) and the invoice number.
CREATE OR REPLACE FUNCTION internal.get_staff_expired_invoice_transfers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  with open as (
    select t as transfer, t.id, coalesce(t.expired_at, t.recorded_at + internal.invoice_transfer_expires_after()) as expired_on
    from private.invoice_transfers t
    where internal.invoice_transfer_follow_up_open(t)
  )
  select jsonb_build_object('unresolved', (select count(*) from open),
      'items', coalesce((select jsonb_agg(internal.invoice_transfer_dto(o.transfer, actor)
        || jsonb_build_object('status', 'expired', 'expired_at', o.expired_on, 'invoice_number',
          (select i.invoice_number from private.customer_invoices i where i.id = (o.transfer).customer_invoice_id))
        order by o.expired_on, o.id)
      from (select * from open order by expired_on, id limit 200) o), '[]'::jsonb))
    into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_expired_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_expired_invoice_transfers() from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_expired_invoice_transfers() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_expired_invoice_transfers()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_expired_invoice_transfers();
$function$;
alter function api.get_staff_expired_invoice_transfers() owner to postgres;
revoke all on function api.get_staff_expired_invoice_transfers() from public, anon, authenticated, service_role;
grant execute on function api.get_staff_expired_invoice_transfers() to authenticated;

-- The member (own invoice only): when the latest bank transfer recorded to
-- this still unpaid invoice expired, or null. Nothing else about the transfer;
-- a declined transfer is not shown, as before.
CREATE OR REPLACE FUNCTION internal.get_my_invoice_transfer_expiry(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; latest private.invoice_transfers;
begin
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = actor;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if inv.status = 'issued' then
    select * into latest from private.invoice_transfers t where t.customer_invoice_id = inv.id
      order by t.recorded_at desc, t.id desc limit 1;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('invoice_number', inv.invoice_number,
    'transfer_expired_at', case when latest.id is not null and internal.invoice_transfer_expired(latest)
      then coalesce(latest.expired_at, latest.recorded_at + internal.invoice_transfer_expires_after()) end);
end;
$function$;
alter function internal.get_my_invoice_transfer_expiry(text) owner to postgres;
revoke all on function internal.get_my_invoice_transfer_expiry(text) from public, anon, authenticated, service_role;
grant execute on function internal.get_my_invoice_transfer_expiry(text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_invoice_transfer_expiry(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_invoice_transfer_expiry(p_invoice_number);
$function$;
alter function api.get_my_invoice_transfer_expiry(text) owner to postgres;
revoke all on function api.get_my_invoice_transfer_expiry(text) from public, anon, authenticated, service_role;
grant execute on function api.get_my_invoice_transfer_expiry(text) to authenticated;

-- Staff (payments:confirm_transfer, as for confirming or declining) resolve an
-- expired transfer that will not be recorded again: the money was returned
-- outside the system ('returned') or never arrived ('never_arrived'), with an
-- audited reason. Once only; the same request again returns the result. A
-- transfer that has waited 14 days but is not marked yet is marked first.
CREATE OR REPLACE FUNCTION internal.resolve_expired_invoice_transfer(p_transfer_id uuid, p_resolution text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  if p_resolution is null or p_resolution not in ('returned', 'never_arrived') then
    raise exception 'resolution must be returned or never_arrived' using errcode='22023';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'resolution reason required' using errcode='22023';
  end if;
  t := internal.lock_invoice_transfer_for_review(p_transfer_id, actor);
  -- Two people, as for confirming: never the staff member who recorded it.
  if internal.same_identity(actor, t.recorded_by) then
    raise exception 'a different staff member must resolve this bank transfer' using errcode='42501',
      detail='transfer_resolver_same';
  end if;
  if t.resolved_at is not null then
    if t.resolved_by = actor and t.resolution = p_resolution and t.resolution_reason = btrim(p_reason) then
      return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('status', 'expired',
        'resolution', t.resolution, 'repeated', true);
    end if;
    raise exception 'this expired bank transfer was already resolved' using errcode='PT409', detail='transfer_resolved';
  end if;
  if not internal.invoice_transfer_expired(t) then
    raise exception 'only an expired bank transfer is resolved; confirm or decline a waiting one'
      using errcode='PT409', detail='transfer_not_expired';
  end if;
  if t.status = 'awaiting_confirmation' then
    perform internal.expire_invoice_transfer(t.id);
  end if;
  update private.invoice_transfers set resolution = p_resolution, resolution_reason = btrim(p_reason),
      resolved_by = actor, resolved_at = statement_timestamp()
    where id = t.id returning * into t;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.invoice_transfer_dto(t, actor) || jsonb_build_object('status', 'expired',
    'resolution', t.resolution, 'repeated', false);
end;
$function$;
alter function internal.resolve_expired_invoice_transfer(uuid,text,text) owner to postgres;
revoke all on function internal.resolve_expired_invoice_transfer(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.resolve_expired_invoice_transfer(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.resolve_expired_invoice_transfer(p_transfer_id uuid, p_resolution text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.resolve_expired_invoice_transfer(p_transfer_id, p_resolution, p_reason);
$function$;
alter function api.resolve_expired_invoice_transfer(uuid,text,text) owner to postgres;
revoke all on function api.resolve_expired_invoice_transfer(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.resolve_expired_invoice_transfer(uuid,text,text) to authenticated;

-- 5. The staff audit trail.
create or replace view private.frontend_staff_audit_events with (security_invoker=true) as
 SELECT frontend_staff_nonpayment_audit_events.id,
    frontend_staff_nonpayment_audit_events.occurred_at,
    frontend_staff_nonpayment_audit_events.actor_id,
    frontend_staff_nonpayment_audit_events.target_id,
    frontend_staff_nonpayment_audit_events.target_type,
    frontend_staff_nonpayment_audit_events.action,
    frontend_staff_nonpayment_audit_events.reason
   FROM private.frontend_staff_nonpayment_audit_events
UNION ALL
 SELECT 'payment:'::text || r.payment_id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || r.kind AS action,
    r.reason
   FROM private.frontend_payment_reversals r
UNION ALL
 SELECT 'payment_activation:'::text || a.payment_id::text AS id,
    a.created_at AS occurred_at,
    a.actor_id,
    a.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:activated'::text AS action,
    a.reason
   FROM private.payment_activations a
UNION ALL
 SELECT 'payment_refund_request:'::text || q.id::text AS id,
    q.requested_at AS occurred_at,
    q.requested_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_recorded'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_approved'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_declined'::text AS action,
    q.decline_reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_slot:'::text || l.id::text AS id,
    l.reversed_at AS occurred_at,
    l.reversed_by AS actor_id,
    l.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:slot_'::text || l.reversal_kind AS action,
    l.reversal_reason AS reason
   FROM private.payment_lines l
  WHERE l.reversed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_recorded:'::text || t.id::text AS id,
    t.recorded_at AS occurred_at,
    t.recorded_by AS actor_id,
    COALESCE(t.payment_id, t.id) AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_recorded'::text AS action,
    (((((((('Bank transfer '::text || t.bank_reference) || ' cleared '::text) || to_char(t.cleared_on::timestamp without time zone, 'YYYY-MM-DD'::text)) || ' ('::text) || t.slots) || ' slots, '::text) || t.amount_received_cents) || ' cents): '::text) || t.reason AS reason
   FROM private.invoice_transfers t
UNION ALL
 SELECT 'payment_invoice_confirmed:'::text || t.id::text AS id,
    t.confirmed_at AS occurred_at,
    t.confirmed_by AS actor_id,
    t.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_confirmed'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' confirmed'::text AS reason
   FROM private.invoice_transfers t
  WHERE t.confirmed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_declined:'::text || t.id::text AS id,
    t.declined_at AS occurred_at,
    t.declined_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_declined'::text AS action,
    (('Bank transfer '::text || t.bank_reference) || ' declined: '::text) || t.decline_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_expired:'::text || t.id::text AS id,
    COALESCE(t.expired_at, t.recorded_at + internal.invoice_transfer_expires_after()) AS occurred_at,
    NULL::uuid AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' expired: not confirmed within 14 days of being recorded'::text AS reason
   FROM private.invoice_transfers t
  WHERE internal.invoice_transfer_expired(t.*)
UNION ALL
 SELECT 'payment_invoice_resolved:'::text || t.id::text AS id,
    t.resolved_at AS occurred_at,
    t.resolved_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired_resolved'::text AS action,
    (((('Bank transfer '::text || t.bank_reference) || ' expired, resolved: '::text)
      || CASE t.resolution WHEN 'returned'::text THEN 'money returned outside VerifyMzansi'::text ELSE 'money never arrived'::text END)
      || ': '::text) || t.resolution_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.resolved_by IS NOT NULL
UNION ALL
 SELECT 'customer_invoice_issued:'::text || i.id::text AS id,
    i.issued_at AS occurred_at,
    i.issued_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_issued'::text AS action,
    (((((('Invoice '::text || i.invoice_number) || ' ('::text) || i.slots) || ' slots, '::text) || i.total_cents) || ' cents): '::text) || i.issue_reason AS reason
   FROM private.customer_invoices i
UNION ALL
 SELECT 'customer_invoice_voided:'::text || i.id::text AS id,
    i.voided_at AS occurred_at,
    i.voided_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_voided'::text AS action,
    (('Invoice '::text || i.invoice_number) || ' voided: '::text) || i.void_reason AS reason
   FROM private.customer_invoices i
  WHERE i.voided_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public;

-- Who may run the new commands.
do $$
declare f text; expected jsonb;
begin
  for f, expected in select * from (values
      ('api.expire_waiting_bank_transfers(integer)', '{"anon":false,"authenticated":false,"service_role":true}'::jsonb),
      ('api.get_staff_expired_invoice_transfers()', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb),
      ('api.get_my_invoice_transfer_expiry(text)', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb),
      ('api.resolve_expired_invoice_transfer(uuid,text,text)', '{"anon":false,"authenticated":true,"service_role":false}'::jsonb)) v
  loop
    if (select jsonb_object_agg(r, has_function_privilege(r, f, 'execute'))
        from unnest(array['anon','authenticated','service_role']) r) is distinct from expected then
      raise exception 'bank transfer expiry: unexpected grants on %', f;
    end if;
  end loop;
end$$;

notify pgrst,'reload schema';
commit;
