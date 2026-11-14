-- Customer invoices with an Ozow "Pay now" link (roadmap P2b, second slice).
-- Staff issue an invoice for a customer's Individual slots; the customer adds
-- their billing details, ticks the cooling-off box and pays it with Ozow. The
-- payment is an ordinary Ozow payment (provider 'ozow') whose reference is the
-- invoice number, settled by the existing notice and status check
-- (internal.apply_provider_event, unchanged), so its slots, receipt email,
-- partner commission and refunds are exactly those of an Ozow checkout. A
-- bank transfer stays possible through the staff bank transfer record
-- (20261113162457), matched to the invoice number by staff.
--
-- Apply after 20261113223806_bank_transfer_and_consent_fixes.sql (it refuses
-- with 55000 unless the bodies it builds on or replaces are the reviewed
-- ones). Only adds: no API command, argument or grant is removed or changed.
-- In one transaction it:
--
-- 1. New table private.customer_invoice_numbers: one counter per South African
--    calendar year. Invoice numbers are VM-YYYY-NNNNNN, allocated under the
--    counter's row lock in the transaction that issues the invoice, so a
--    failed issue takes no number. Numbers never skip: the counter starts at
--    1 and only ever moves up by one (trigger), every invoice takes the
--    counter's current value (trigger), and at commit a year's invoices are
--    exactly 1 to its counter (deferred constraint trigger). Invoices are
--    never removed (only the retention job removes them, five tax years
--    later); a cancelled invoice stays as 'void'.
-- 2. New table private.customer_invoices: number, customer account, the
--    Individual slot plan version, number of slots, price per slot, total
--    (at most R50,000), description, issue date, due date, the staff member
--    who issued it and why, the seller (Verifymzansi (Pty) Ltd, 2026/155305/07,
--    not registered for VAT; issuing refuses while the merchant VAT setting
--    says otherwise), the buyer's billing details (business or buyer name,
--    address, optional registration number, saved by the customer while the
--    invoice is unpaid), the customer's cooling-off consent (time and wording
--    version), and its status: issued, then paid (naming its complete Ozow
--    payment) or void (who, when, why), once.
-- 3. New table private.customer_invoice_payments: each "Pay now" attempt, an
--    ordinary pending Ozow payment of the invoice total with one line per
--    slot. The first attempt's reference is the invoice number; a later
--    attempt (after an earlier one expired, failed or was cancelled) is
--    "<number>-<attempt>", which Ozow shows on the bank statement as the
--    invoice number (14 characters). At most 20 attempts.
-- 4. Trigger payments_customer_invoice_paid on private.payments: when an
--    invoice attempt is completed (by Ozow's notice or the status check), the
--    invoice becomes paid with that payment and its completion time. Money
--    for an invoice that is already paid or void (an earlier attempt settling
--    late) is never refused: the payment completes as any Ozow payment does,
--    and is recorded as a payment problem (conflicting_transaction) so staff
--    see "paid twice" and refund it.
-- 5. Staff commands (capability payments:refund, recent second factor, the
--    staff member's own current accepted ID review, never for an account of
--    their own identity or one a partner account of their identity referred):
--    api.issue_staff_invoice(p_account_email, p_term_days, p_slots,
--    p_due_days, p_reason, p_request_id) for a confirmed account with current
--    access and an accepted ID review, the Individual slot on sale for 30, 90
--    or 180 days, 1 to 25 slots within the person's slot limit, 1 to 30 days
--    to pay; the same request id again returns the first invoice.
--    api.void_staff_invoice(p_invoice_id, p_reason): only an unpaid invoice
--    with no payment attempt that could still be paid.
-- 6. Staff reads (payments:view): api.get_staff_invoices() (the latest 50)
--    and api.get_staff_invoice(p_invoice_number).
-- 7. Customer commands (a signed-in account with current access and a live
--    session, only for its own invoices; anyone else's number reads as not
--    found): api.get_my_invoices(), api.get_my_invoice(p_invoice_number),
--    api.save_my_invoice_billing(p_invoice_number, p_revision, p_buyer_name,
--    p_buyer_address, p_buyer_registration_number) and
--    api.start_invoice_payment(p_invoice_number, p_expected_total_cents,
--    p_cooling_off_consent): an issued invoice with billing details, the box
--    ticked (recorded with time and wording version on the first payment),
--    the total shown equal to the invoice total, the plan still on sale at
--    the invoice price, an accepted ID review and room within the slot limit
--    (counting checkouts still open). It returns the open attempt while its
--    Ozow page is open, reuses an attempt never sent to Ozow, refuses while
--    an attempt is still being checked, and otherwise starts a new attempt.
--    The website then opens the Ozow request with the existing service
--    commands (claim_checkout_request, complete_checkout_request).
-- 8. The privacy export holds the member's invoices (customer_invoices; never
--    the staff member or staff notes). The retention job removes invoices and
--    their attempt links five tax years after they were paid, voided or (if
--    neither) issued, and skips payments an invoice or a recorded bank
--    transfer still names (before, such a payment would have stopped the
--    job). internal.retention_commerce and internal.frontend_privacy_export_data
--    are replaced (full bodies).
-- 9. The staff audit trail (private.frontend_staff_audit_events) lists each
--    invoice issued and voided.
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Read-only preflight: ../preflight/20261114041000_customer_invoice_pay_now.check.sql.
-- Rollback: ../rollback/20261114041000_customer_invoice_pay_now.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces are the earlier reviewed
-- bodies or this update's; the functions it calls are the reviewed ones; the
-- new tables are absent or exactly this update's.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.retention_commerce(integer)'),('internal.frontend_privacy_export_data(uuid)')) v(sig)
  loop
    if shape not in (
        'internal.retention_commerce(integer) 53418aba6b15cf8fa73dc49f25a2f8c3',
        'internal.retention_commerce(integer) f860135f948386cdecfae78110e9ccf3',
        'internal.frontend_privacy_export_data(uuid) d30c545386536a718e824d1ec56f03ce',
        'internal.frontend_privacy_export_data(uuid) cea6d5d00f5def4143bde4daa5b84373') then
      raise exception 'customer invoice precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.apply_provider_event(jsonb)'),('internal.claim_checkout_request(uuid,uuid)'),
      ('internal.complete_checkout_request(uuid,uuid,uuid,text,text)'),('internal.price_draft_actor()'),
      ('internal.staff_actor(text)'),('internal.assert_staff_payment_actor(uuid,uuid)'),
      ('internal.assert_staff_not_referrer(uuid,uuid)'),('internal.invoice_customer_by_email(text)'),
      ('internal.individual_slots_counted(text,uuid,uuid)'),('internal.individual_slot_limit(text)'),
      ('internal.individual_slot_plan(text)'),('internal.same_identity(uuid,uuid)'),
      ('internal.lock_evidence_subject(uuid)'),('internal.plain_text_valid(text,integer,integer,boolean)'),
      ('internal.profile_public_name(text)'),('internal.record_payment_problem(uuid,text,text,boolean,text)'),
      ('internal.payment_quote_guard()'),('internal.payment_invoice_snapshot()'),
      ('internal.payment_partner_commission()'),('internal.retention_tax_year_due(timestamp with time zone)')) v(sig)
  loop
    if shape not in (
        'internal.apply_provider_event(jsonb) 8a226003da741381225c11dfd1e44308',
        'internal.claim_checkout_request(uuid,uuid) d29afcd49f72e712602914d6ecb4d8f5',
        'internal.complete_checkout_request(uuid,uuid,uuid,text,text) d392cd27ab1a56d820b917a27118f150',
        'internal.price_draft_actor() 1d70271a4447ba5d1377f3f64a6cf029',
        'internal.staff_actor(text) 269f0871f156f57c029cedcab72f6c3f',
        'internal.assert_staff_payment_actor(uuid,uuid) fe81cc39557206e06346fcf5e9f33bfd',
        'internal.assert_staff_not_referrer(uuid,uuid) 1e9fa59ac5ab01018789e91e882e4363',
        'internal.invoice_customer_by_email(text) d972c0ebbd47f3bd5fbe7cd355ddf446',
        'internal.individual_slots_counted(text,uuid,uuid) 1444a238736eac1d4de7dc8a53526e9b',
        'internal.individual_slot_limit(text) 90ecd5c02572cc9831468458f3ae0e2d',
        'internal.individual_slot_plan(text) c0c1d06dc52122641d02db6b1364be75',
        'internal.same_identity(uuid,uuid) 535e5c87d944edd45bd2b3dce28f98b6',
        'internal.lock_evidence_subject(uuid) 3ef77cf81542607c0ba91f6687255f01',
        'internal.plain_text_valid(text,integer,integer,boolean) b3654008b4427d60db398555fef16971',
        'internal.profile_public_name(text) 4e5bc26d138b3abc6b7f33811e380c25',
        'internal.record_payment_problem(uuid,text,text,boolean,text) 73a0ff98c9e3f2003e76349481435cba',
        'internal.payment_quote_guard() 1042ebb47721d807667a17be53ae2559',
        'internal.payment_invoice_snapshot() 4b51e17e7650f49c4486ffe86631ff2c',
        'internal.payment_partner_commission() e99f071fae090328566a61186843c6e2',
        'internal.retention_tax_year_due(timestamp with time zone) 330c487132c054e1995261d5e92871b2') then
      raise exception 'customer invoice precondition: % is not the reviewed body this update builds on', shape
        using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.invoice_transfers') is null or to_regclass('private.payment_lines') is null
    or to_regclass('private.invoice_merchant_config') is null
    or coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) not like '%invoice_transfers%', true) then
    raise exception 'customer invoice precondition: apply 20261113162457 and 20261113223806 first' using errcode='55000';
  end if;
  select 'private.customer_invoice_numbers '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
    from pg_catalog.pg_attribute a where a.attrelid=to_regclass('private.customer_invoice_numbers') and a.attnum>0 and not a.attisdropped),'absent')
  into shape;
  if shape not in ('private.customer_invoice_numbers absent',
      'private.customer_invoice_numbers invoice_year:integer!,last_number:integer!') then
    raise exception 'customer invoice table drift: %', shape using errcode='55000';
  end if;
  select 'private.customer_invoices '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
    from pg_catalog.pg_attribute a where a.attrelid=to_regclass('private.customer_invoices') and a.attnum>0 and not a.attisdropped),'absent')
  into shape;
  if shape not in ('private.customer_invoices absent', 'private.customer_invoices id:uuid!,invoice_number:text!,'
        ||'invoice_year:integer!,sequence_number:integer!,account_id:uuid!,plan_version_id:uuid!,slots:integer!,'
        ||'unit_price_cents:bigint!,total_cents:bigint!,description:text!,issued_at:timestamp with time zone!,'
        ||'due_on:date!,issued_by:uuid!,issue_reason:text!,request_id:uuid!,seller:jsonb!,buyer_name:text,'
        ||'buyer_address:text,buyer_registration_number:text,buyer_saved_at:timestamp with time zone,revision:integer!,'
        ||'cooling_off_consent_at:timestamp with time zone,cooling_off_consent_version:text,status:text!,'
        ||'payment_id:uuid,paid_at:timestamp with time zone,voided_by:uuid,voided_at:timestamp with time zone,'
        ||'void_reason:text') then
    raise exception 'customer invoice table drift: %', shape using errcode='55000';
  end if;
  select 'private.customer_invoice_payments '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
    from pg_catalog.pg_attribute a where a.attrelid=to_regclass('private.customer_invoice_payments') and a.attnum>0 and not a.attisdropped),'absent')
  into shape;
  if shape not in ('private.customer_invoice_payments absent',
      'private.customer_invoice_payments payment_id:uuid!,invoice_id:uuid!,attempt:integer!,created_at:timestamp with time zone!') then
    raise exception 'customer invoice table drift: %', shape using errcode='55000';
  end if;
end$$;

-- 1. One invoice number counter per South African calendar year.
create table if not exists private.customer_invoice_numbers (
  invoice_year integer primary key check (invoice_year between 2026 and 9999),
  last_number integer not null check (last_number between 1 and 999999)
);
alter table private.customer_invoice_numbers enable row level security;
revoke all on table private.customer_invoice_numbers from public, anon, authenticated, service_role;

-- 2. Invoices.
create table if not exists private.customer_invoices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  invoice_number text not null,
  invoice_year integer not null check (invoice_year between 2026 and 9999),
  sequence_number integer not null check (sequence_number between 1 and 999999),
  account_id uuid not null references auth.users (id) on delete restrict,
  plan_version_id uuid not null references private.plan_versions (id) on delete restrict,
  slots integer not null check (slots between 1 and 25),
  unit_price_cents bigint not null check (unit_price_cents between 100 and 1000000),
  total_cents bigint not null check (total_cents > 0 and total_cents <= 5000000),
  description text not null check (internal.plain_text_valid(description, 3, 200, false)),
  issued_at timestamptz not null default statement_timestamp(),
  due_on date not null,
  issued_by uuid not null references auth.users (id) on delete restrict,
  issue_reason text not null check (internal.plain_text_valid(issue_reason, 5, 500, true)),
  request_id uuid not null,
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer_name text check (buyer_name is null or internal.plain_text_valid(buyer_name, 2, 160, false)),
  buyer_address text check (buyer_address is null or internal.plain_text_valid(buyer_address, 5, 300, true)),
  buyer_registration_number text check (buyer_registration_number is null
    or buyer_registration_number ~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{1,39}$'),
  buyer_saved_at timestamptz,
  revision integer not null default 1 check (revision >= 1),
  cooling_off_consent_at timestamptz,
  cooling_off_consent_version text check (cooling_off_consent_version is null
    or cooling_off_consent_version = 'invoice-cooling-off-v1'),
  status text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  payment_id uuid references private.payments (id) on delete restrict,
  paid_at timestamptz,
  voided_by uuid references auth.users (id) on delete restrict,
  voided_at timestamptz,
  void_reason text check (void_reason is null or internal.plain_text_valid(void_reason, 5, 500, true)),
  constraint customer_invoices_number_key unique (invoice_number),
  constraint customer_invoices_sequence_key unique (invoice_year, sequence_number),
  constraint customer_invoices_request_key unique (issued_by, request_id),
  constraint customer_invoices_payment_key unique (payment_id),
  constraint customer_invoices_number_format check (invoice_number
    = 'VM-' || invoice_year::text || '-' || lpad(sequence_number::text, 6, '0')),
  constraint customer_invoices_total check (total_cents = unit_price_cents * slots),
  constraint customer_invoices_not_own check (issued_by <> account_id),
  constraint customer_invoices_buyer check ((buyer_name is null) = (buyer_address is null)
    and (buyer_name is null) = (buyer_saved_at is null)
    and (buyer_registration_number is null or buyer_name is not null)),
  constraint customer_invoices_consent check ((cooling_off_consent_at is null) = (cooling_off_consent_version is null)),
  constraint customer_invoices_paid check ((status = 'paid') = (payment_id is not null and paid_at is not null)),
  constraint customer_invoices_void check ((status = 'void')
    = (voided_by is not null and voided_at is not null and void_reason is not null))
);
alter table private.customer_invoices enable row level security;
revoke all on table private.customer_invoices from public, anon, authenticated, service_role;
create index if not exists customer_invoices_account_idx on private.customer_invoices (account_id, issued_at desc);
create index if not exists customer_invoices_recent_idx on private.customer_invoices (issued_at desc, id desc);
create index if not exists customer_invoices_plan_version_idx on private.customer_invoices (plan_version_id);
create index if not exists customer_invoices_issued_by_idx on private.customer_invoices (issued_by);
create index if not exists customer_invoices_voided_by_idx on private.customer_invoices (voided_by)
  where voided_by is not null;

-- 3. "Pay now" attempts: each an ordinary Ozow payment of the invoice.
create table if not exists private.customer_invoice_payments (
  payment_id uuid primary key references private.payments (id) on delete restrict,
  invoice_id uuid not null references private.customer_invoices (id) on delete restrict,
  attempt integer not null check (attempt between 1 and 20),
  created_at timestamptz not null default statement_timestamp(),
  constraint customer_invoice_payments_attempt_key unique (invoice_id, attempt)
);
alter table private.customer_invoice_payments enable row level security;
revoke all on table private.customer_invoice_payments from public, anon, authenticated, service_role;

-- The counter starts at 1, moves up by exactly one and is never removed.
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
revoke all on function internal.customer_invoice_number_guard() from public, anon, authenticated, service_role;
drop trigger if exists customer_invoice_numbers_guard on private.customer_invoice_numbers;
create trigger customer_invoice_numbers_guard before insert or update or delete on private.customer_invoice_numbers
  for each row execute function internal.customer_invoice_number_guard();

-- At commit, a year's invoices are exactly the numbers 1 to its counter. It
-- runs at commit, after the issuing command has returned, so it reads the
-- private table with its owner's rights.
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
revoke all on function internal.customer_invoice_numbers_gapless() from public, anon, authenticated, service_role;
drop trigger if exists customer_invoice_numbers_gapless on private.customer_invoice_numbers;
create constraint trigger customer_invoice_numbers_gapless after insert or update on private.customer_invoice_numbers
  deferrable initially deferred for each row execute function internal.customer_invoice_numbers_gapless();

-- An invoice is issued with the counter's current number, unpaid and without
-- billing details or consent; its issued facts never change; the customer's
-- billing details change only while it is issued (each change a new
-- revision) and the consent is recorded once; it becomes paid (naming its
-- complete Ozow attempt of that account and amount) or void, once. Only the
-- retention job removes it.
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
revoke all on function internal.customer_invoice_guard() from public, anon, authenticated, service_role;
drop trigger if exists customer_invoices_guard on private.customer_invoices;
create trigger customer_invoices_guard before insert or update or delete on private.customer_invoices
  for each row execute function internal.customer_invoice_guard();

-- An attempt names a new pending Ozow payment of the invoice's account,
-- total and slots, with the invoice number as its reference; never changed;
-- only the retention job removes it.
CREATE OR REPLACE FUNCTION internal.customer_invoice_payment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; inv private.customer_invoices; reference text;
begin
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
    raise exception 'invoice payment attempts are never removed' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'invoice payment attempts never change' using errcode='23514';
  end if;
  select * into pay from private.payments p where p.id = new.payment_id;
  select * into inv from private.customer_invoices i where i.id = new.invoice_id;
  reference := inv.invoice_number;
  if new.attempt > 1 then reference := reference || '-' || new.attempt::text; end if;
  if pay.status <> 'pending' or pay.provider <> 'ozow' or pay.product_kind <> 'plan'
      or pay.owner_id <> inv.account_id or pay.amount_cents <> inv.total_cents
      or pay.plan_version_id <> inv.plan_version_id or inv.status <> 'issued'
      or pay.merchant_reference is distinct from reference
      or pay.snapshot->>'customer_invoice_id' is distinct from inv.id::text
      or (select count(*) from private.payment_lines l where l.payment_id = pay.id
        and l.amount_cents = inv.unit_price_cents) <> inv.slots
      or new.attempt <> 1 + (select count(*) from private.customer_invoice_payments x where x.invoice_id = inv.id) then
    raise exception 'an invoice payment attempt is a new Ozow payment of that invoice' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_payment_guard() owner to postgres;
revoke all on function internal.customer_invoice_payment_guard() from public, anon, authenticated, service_role;
drop trigger if exists customer_invoice_payments_guard on private.customer_invoice_payments;
create trigger customer_invoice_payments_guard before insert or update or delete on private.customer_invoice_payments
  for each row execute function internal.customer_invoice_payment_guard();

-- 4. A completed attempt pays its invoice. Money for an invoice already paid
-- or void is kept (the payment completes as any Ozow payment) and shown to
-- staff as a payment problem, to refund.
CREATE OR REPLACE FUNCTION internal.customer_invoice_payment_settled()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  select i.* into inv from private.customer_invoice_payments l
    join private.customer_invoices i on i.id = l.invoice_id
    where l.payment_id = new.id for update of i;
  if not found then return null; end if;
  if inv.status = 'issued' then
    update private.customer_invoices set status = 'paid', payment_id = new.id, paid_at = new.completed_at
      where id = inv.id;
  elsif inv.payment_id is distinct from new.id then
    perform internal.record_payment_problem(new.id, 'conflicting_transaction', 'notice', true,
      coalesce(new.provider_transaction_id, new.id::text));
  end if;
  return null;
end;
$function$;
alter function internal.customer_invoice_payment_settled() owner to postgres;
revoke all on function internal.customer_invoice_payment_settled() from public, anon, authenticated, service_role;
drop trigger if exists payments_customer_invoice_paid on private.payments;
create trigger payments_customer_invoice_paid after update of status on private.payments
  for each row when (new.status = 'complete' and old.status is distinct from 'complete')
  execute function internal.customer_invoice_payment_settled();

-- 5. Shared parts.
-- The cooling-off box the customer ticks before paying (wording and version
-- stored with the consent).
CREATE OR REPLACE FUNCTION internal.customer_invoice_consent()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('version', 'invoice-cooling-off-v1',
    'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately.');
$function$;
alter function internal.customer_invoice_consent() owner to postgres;
revoke all on function internal.customer_invoice_consent() from public, anon, authenticated, service_role;

-- What the customer (p_staff null) or staff see of an invoice. Staff also see
-- the customer's account email and name, who issued it and why, and the
-- void reason.
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
    'attempts', (select count(*) from private.customer_invoice_payments l where l.invoice_id = i.id)) end;
$function$;
alter function internal.customer_invoice_dto(private.customer_invoices,uuid) owner to postgres;
revoke all on function internal.customer_invoice_dto(private.customer_invoices,uuid) from public, anon, authenticated, service_role;

-- An invoice number as typed (PT404 for anything else, so a malformed number
-- and someone else's number read alike).
CREATE OR REPLACE FUNCTION internal.customer_invoice_number(p_invoice_number text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_invoice_number is null or upper(btrim(p_invoice_number)) !~ '^VM-[0-9]{4}-[0-9]{6}$' then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  return upper(btrim(p_invoice_number));
end;
$function$;
alter function internal.customer_invoice_number(text) owner to postgres;
revoke all on function internal.customer_invoice_number(text) from public, anon, authenticated, service_role;

-- 6. Staff issue an invoice. The number is taken under the counter's row lock
-- in this transaction: a refusal later in it takes no number.
CREATE OR REPLACE FUNCTION internal.issue_staff_invoice(p_account_email text, p_term_days integer, p_slots integer,
  p_due_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; plan private.plan_versions; fingerprint text; prior private.customer_invoices;
  made private.customer_invoices; issued_on date; year_number integer; next_number integer;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 or p_term_days is null
      or p_term_days not in (30, 90, 180) or p_slots is null or p_slots not between 1 and 25
      or p_due_days is null or p_due_days not between 1 and 30 or p_request_id is null then
    raise exception 'customer email, slot term, number of slots and days to pay required'
      using errcode='22023', detail='invoice_issue_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  -- The same request again (a retried submission) returns the first invoice.
  select * into prior from private.customer_invoices i where i.issued_by = actor and i.request_id = p_request_id;
  if found then
    if prior.account_id = buyer and prior.slots = p_slots and prior.issue_reason = btrim(p_reason)
        and prior.due_on - (prior.issued_at at time zone 'Africa/Johannesburg')::date = p_due_days
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.customer_invoice_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already issued another invoice' using errcode='PT409', detail='invoice_request_conflict';
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
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if plan.price_cents * p_slots > 5000000 then
    raise exception 'invoices above R50,000 cannot be issued yet' using errcode='PT413', detail='invoice_amount_above_limit';
  end if;
  -- An early check of the slot limit; the payment checks it again.
  if (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer + p_slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  -- The invoice says "not registered for VAT": only while the merchant setting says so.
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  issued_on := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, buyer, plan.id,
      p_slots, plan.price_cents, plan.price_cents * p_slots,
      case when p_slots = 1 then plan.label else p_slots::text || ' × ' || plan.label end,
      issued_on + p_due_days, actor, btrim(p_reason), p_request_id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  return internal.customer_invoice_dto(made, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) owner to postgres;
revoke all on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.issue_staff_invoice(p_account_email text, p_term_days integer, p_slots integer,
  p_due_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.issue_staff_invoice(p_account_email, p_term_days, p_slots, p_due_days, p_reason, p_request_id);
$function$;
alter function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) owner to postgres;
revoke all on function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) from public, anon, authenticated, service_role;
grant execute on function api.issue_staff_invoice(text,integer,integer,integer,text,uuid) to authenticated;

-- An attempt that can still be paid: open at Ozow (or being sent there), or
-- failed while its Ozow page may still take another try.
CREATE OR REPLACE FUNCTION internal.customer_invoice_attempt_live(p private.payments)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (p.status = 'pending' and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp()))
    or (p.status = 'failed' and p.checkout_expires_at > pg_catalog.clock_timestamp());
$function$;
alter function internal.customer_invoice_attempt_live(private.payments) owner to postgres;
revoke all on function internal.customer_invoice_attempt_live(private.payments) from public, anon, authenticated, service_role;

-- Staff void an unpaid invoice that no attempt can still pay. An attempt never
-- sent to Ozow is closed with it.
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
  perform internal.lock_evidence_subject(inv.account_id);
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
revoke all on function internal.void_staff_invoice(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.void_staff_invoice(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.void_staff_invoice(p_invoice_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.void_staff_invoice(p_invoice_id, p_reason);
$function$;
alter function api.void_staff_invoice(uuid,text) owner to postgres;
revoke all on function api.void_staff_invoice(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.void_staff_invoice(uuid,text) to authenticated;

-- 7. Staff reads: the latest 50 invoices, and one invoice by number.
CREATE OR REPLACE FUNCTION internal.get_staff_invoices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  select jsonb_build_object('unpaid', (select count(*) from private.customer_invoices x where x.status = 'issued'),
      'items', coalesce(jsonb_agg(internal.customer_invoice_dto(i, actor) order by i.issued_at desc, i.id desc), '[]'::jsonb))
    into result
  from (select * from private.customer_invoices x order by x.issued_at desc, x.id desc limit 50) i;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoices() owner to postgres;
revoke all on function internal.get_staff_invoices() from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_invoices() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_invoices()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_invoices();
$function$;
alter function api.get_staff_invoices() owner to postgres;
revoke all on function api.get_staff_invoices() from public, anon, authenticated, service_role;
grant execute on function api.get_staff_invoices() to authenticated;

CREATE OR REPLACE FUNCTION internal.get_staff_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices;
begin
  actor := internal.staff_actor('payments:view');
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number);
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.customer_invoice_dto(inv, actor);
end;
$function$;
alter function internal.get_staff_invoice(text) owner to postgres;
revoke all on function internal.get_staff_invoice(text) from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_invoice(text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_invoice(p_invoice_number);
$function$;
alter function api.get_staff_invoice(text) owner to postgres;
revoke all on function api.get_staff_invoice(text) from public, anon, authenticated, service_role;
grant execute on function api.get_staff_invoice(text) to authenticated;

-- 8. The customer's own invoices. Someone else's number reads as not found.
CREATE OR REPLACE FUNCTION internal.get_my_invoices()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('invoice_number', i.invoice_number,
      'status', i.status, 'issued_at', i.issued_at, 'due_on', to_char(i.due_on::timestamp, 'YYYY-MM-DD'),
      'description', i.description, 'total_cents', i.total_cents, 'paid_at', i.paid_at,
      'payment_status', (select p.status from private.payments p where p.id = i.payment_id))
      order by i.issued_at desc, i.id desc), '[]'::jsonb))
    into result
  from (select * from private.customer_invoices x where x.account_id = actor
    order by x.issued_at desc, x.id desc limit 100) i;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_invoices() owner to postgres;
revoke all on function internal.get_my_invoices() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_invoices() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_invoices()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_invoices();
$function$;
alter function api.get_my_invoices() owner to postgres;
revoke all on function api.get_my_invoices() from public, anon, authenticated, service_role;
grant execute on function api.get_my_invoices() to authenticated;

CREATE OR REPLACE FUNCTION internal.get_my_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices;
begin
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = actor;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  perform internal.price_draft_actor();
  return internal.customer_invoice_dto(inv, null);
end;
$function$;
alter function internal.get_my_invoice(text) owner to postgres;
revoke all on function internal.get_my_invoice(text) from public, anon, authenticated, service_role;
grant execute on function internal.get_my_invoice(text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_invoice(p_invoice_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_invoice(p_invoice_number);
$function$;
alter function api.get_my_invoice(text) owner to postgres;
revoke all on function api.get_my_invoice(text) from public, anon, authenticated, service_role;
grant execute on function api.get_my_invoice(text) to authenticated;

-- Locks the caller's own issued invoice for a change (the person, then the row).
CREATE OR REPLACE FUNCTION internal.lock_my_issued_invoice(p_actor uuid, p_invoice_number text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  perform internal.lock_evidence_subject(p_actor);
  select * into inv from private.customer_invoices i
    where i.invoice_number = internal.customer_invoice_number(p_invoice_number) and i.account_id = p_actor
    for update;
  if not found then
    raise exception 'invoice not found' using errcode='PT404', detail='invoice_unavailable';
  end if;
  if inv.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
  elsif inv.status = 'void' then
    raise exception 'this invoice was cancelled' using errcode='PT409', detail='invoice_void';
  end if;
  return inv;
end;
$function$;
alter function internal.lock_my_issued_invoice(uuid,text) owner to postgres;
revoke all on function internal.lock_my_issued_invoice(uuid,text) from public, anon, authenticated, service_role;

-- The customer's billing details on an unpaid invoice: business or buyer
-- name, address (up to 300 characters, lines allowed) and an optional
-- registration number. Revision-fenced; the same details again change nothing.
CREATE OR REPLACE FUNCTION internal.save_my_invoice_billing(p_invoice_number text, p_revision integer,
  p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; name text; address text; registration text;
begin
  name := regexp_replace(btrim(coalesce(p_buyer_name, '')), '\s+', ' ', 'g');
  address := regexp_replace(regexp_replace(btrim(coalesce(p_buyer_address, ''), E' \n\r\t'), E'\r\n?', E'\n', 'g'),
    E'[ \t]+', ' ', 'g');
  registration := nullif(regexp_replace(btrim(coalesce(p_buyer_registration_number, '')), '\s+', ' ', 'g'), '');
  if p_revision is null or not coalesce(internal.plain_text_valid(name, 2, 160, false), false)
      or not coalesce(internal.plain_text_valid(address, 5, 300, true), false)
      or (registration is not null and registration !~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{1,39}$') then
    raise exception 'business or buyer name (2 to 160 characters), address (5 to 300) and a registration number of letters and digits required'
      using errcode='22023', detail='invoice_billing_invalid';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if (inv.buyer_name, inv.buyer_address, inv.buyer_registration_number) is not distinct from (name, address, registration) then
    perform internal.price_draft_actor();
    return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', true);
  end if;
  if inv.revision <> p_revision then
    raise exception 'the invoice changed; reload it' using errcode='PT409', detail='invoice_revision_changed';
  end if;
  update private.customer_invoices set buyer_name = name, buyer_address = address,
      buyer_registration_number = registration, buyer_saved_at = statement_timestamp(), revision = revision + 1
    where id = inv.id returning * into inv;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.customer_invoice_dto(inv, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function internal.save_my_invoice_billing(text,integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.save_my_invoice_billing(text,integer,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.save_my_invoice_billing(p_invoice_number text, p_revision integer,
  p_buyer_name text, p_buyer_address text, p_buyer_registration_number text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.save_my_invoice_billing(p_invoice_number, p_revision, p_buyer_name, p_buyer_address,
    p_buyer_registration_number);
$function$;
alter function api.save_my_invoice_billing(text,integer,text,text,text) owner to postgres;
revoke all on function api.save_my_invoice_billing(text,integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function api.save_my_invoice_billing(text,integer,text,text,text) to authenticated;

-- "Pay now": an ordinary Ozow payment of the invoice total, one line per slot,
-- with the invoice number as its reference. The website then opens the Ozow
-- request for it with the existing service commands.
CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint,
  p_cooling_off_consent boolean)
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
revoke all on function internal.start_invoice_payment(text,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.start_invoice_payment(text,bigint,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint,
  p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_invoice_payment(p_invoice_number, p_expected_total_cents, p_cooling_off_consent);
$function$;
alter function api.start_invoice_payment(text,bigint,boolean) owner to postgres;
revoke all on function api.start_invoice_payment(text,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function api.start_invoice_payment(text,bigint,boolean) to authenticated;

-- 9. The retention job: invoices and their attempt links go five tax years
-- after they were paid, voided or (if neither) issued; a payment an invoice or
-- a recorded bank transfer still names is skipped instead of stopping the job.
CREATE OR REPLACE FUNCTION internal.retention_commerce(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer; customer_invoices integer;
begin
  delete from private.provider_events where id in(select e.id from private.provider_events e
    where internal.retention_tax_year_due(e.received_at) order by e.received_at limit p_limit);
  get diagnostics provider_events=row_count;
  delete from private.invoices where id in(select i.id from private.invoices i
    where internal.retention_tax_year_due(i.issued_at) order by i.issued_at limit p_limit);
  get diagnostics invoices=row_count;
  delete from private.customer_invoice_payments where invoice_id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at)) order by i.issued_at limit p_limit);
  delete from private.customer_invoices where id in(select i.id from private.customer_invoices i
    where internal.retention_tax_year_due(coalesce(i.paid_at,i.voided_at,i.issued_at))
      and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id=i.id)
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
  delete from private.entitlements where id in(select e.id from private.entitlements e
    where (e.status='revoked' or e.ends_at<=statement_timestamp())
      and internal.retention_tax_year_due(coalesce(e.ends_at,e.created_at))
      and not exists(select 1 from private.organisation_sponsorships s where s.entitlement_id=e.id)
      and not exists(select 1 from private.post_activations a where a.entitlement_id=e.id)
      and not exists(select 1 from private.post_trial_claims c where c.trial_entitlement_id=e.id)
      and not exists(select 1 from private.trial_identities t where t.entitlement_id=e.id)
    order by e.created_at limit p_limit for update skip locked);
  get diagnostics entitlements=row_count;
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
    'entitlements',entitlements,'payments',payments,'customer_invoices',customer_invoices);
end;
$function$;
alter function internal.retention_commerce(integer) owner to postgres;
revoke all on function internal.retention_commerce(integer) from public, anon, authenticated, service_role;

-- 10. The privacy export also holds the member's invoices (never the staff
-- member or staff notes).
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
    ('payments',$q$select id,product_kind,target_post_id,amount_cents,currency,status,fulfillment_status,merchant_reference,provider,created_at,completed_at
      from private.payments where owner_id=$1 order by created_at,id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason
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
revoke all on function internal.frontend_privacy_export_data(uuid) from public, anon, authenticated, service_role;

-- 11. The staff audit trail also lists each invoice issued and voided.
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
    'payment:'::text || q.kind || '_recorded'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_approved'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_declined'::text AS action,
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
    coalesce(t.payment_id, t.id) AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_recorded'::text AS action,
    'Bank transfer '::text || t.bank_reference || ' cleared '::text || to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'::text)
      || ' (' || t.slots || ' slots, ' || t.amount_received_cents || ' cents): '::text || t.reason AS reason
   FROM private.invoice_transfers t
UNION ALL
 SELECT 'payment_invoice_confirmed:'::text || t.id::text AS id,
    t.confirmed_at AS occurred_at,
    t.confirmed_by AS actor_id,
    t.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_confirmed'::text AS action,
    'Bank transfer '::text || t.bank_reference || ' confirmed'::text AS reason
   FROM private.invoice_transfers t
  WHERE t.confirmed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_declined:'::text || t.id::text AS id,
    t.declined_at AS occurred_at,
    t.declined_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_declined'::text AS action,
    'Bank transfer '::text || t.bank_reference || ' declined: '::text || t.decline_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.declined_by IS NOT NULL
UNION ALL
 SELECT 'customer_invoice_issued:'::text || i.id::text AS id,
    i.issued_at AS occurred_at,
    i.issued_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_issued'::text AS action,
    'Invoice '::text || i.invoice_number || ' (' || i.slots || ' slots, ' || i.total_cents || ' cents): '::text
      || i.issue_reason AS reason
   FROM private.customer_invoices i
UNION ALL
 SELECT 'customer_invoice_voided:'::text || i.id::text AS id,
    i.voided_at AS occurred_at,
    i.voided_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_voided'::text AS action,
    'Invoice '::text || i.invoice_number || ' voided: '::text || i.void_reason AS reason
   FROM private.customer_invoices i
  WHERE i.voided_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public, anon, authenticated, service_role;

commit;
