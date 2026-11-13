-- Staff record a cleared bank transfer (EFT) and a second staff member confirms
-- it as a payment (roadmap P2b, first slice). The confirmed payment is an
-- ordinary payment with the new method 'invoice', so its slots, receipt email,
-- partner commission and refunds follow exactly the rules of an Ozow payment.
--
-- Apply after 20261113021223_staff_payment_fixes.sql (it refuses with 55000
-- unless that update's staff payment rule, delivery commission, receipt read
-- and staff audit view are present with their reviewed bodies). Only adds: no
-- API command, argument or grant is removed or changed. In one transaction it:
--
-- 1. Lets private.payments hold a payment with provider 'invoice': a complete
--    invoice payment has no Ozow transaction id (payments_check1), and the new
--    payments_invoice_without_ozow refuses Ozow request, transaction and
--    checkout fields on it. Existing Ozow payments meet every rule unchanged.
-- 2. New table private.invoice_transfers: one row per recorded bank transfer,
--    'awaiting_confirmation' until a second staff member confirms it (it then
--    names the payment) or declines it. The bank reference is used once
--    across every record, waiting, confirmed or declined (compared on its
--    letters and digits, whatever the case, spaces or punctuation): a declined
--    reference is never recorded again. Rows are never removed and change only
--    from waiting to confirmed or declined, once (trigger); the recorder is
--    never the customer and the confirmer is never the recorder or the
--    customer (constraints).
-- 3. New staff capability payments:confirm_transfer (admin, recent second
--    factor).
-- 4. New staff command api.record_staff_invoice_payment(p_account_email,
--    p_term_days, p_slots, p_amount_cents, p_bank_reference, p_cleared_on,
--    p_cooling_off_waiver, p_reason) (capability payments:refund, recent second
--    factor): for a confirmed account with current access and an accepted ID
--    review, the Individual slot on sale for 30, 90 or 180 days, 1 to 25 slots
--    within the person's slot limit, the amount received equal to the order
--    total and at most R50,000, money that cleared today or in the last 90
--    days and the written waiver confirmed, it stores the record as waiting.
--    Nothing starts and nothing is sent. The same request again by the same
--    staff member returns the first record; the same reference otherwise is
--    refused (PT409 bank_reference_used).
-- 5. New staff commands api.confirm_staff_invoice_payment(p_transfer_id) and
--    api.decline_staff_invoice_payment(p_transfer_id, p_reason) (capability
--    payments:confirm_transfer). Confirmation is by another person than the
--    recorder (42501 transfer_confirmer_same, also for another account of the
--    recorder's identity, checked again after the lock waits); it refuses
--    when the recorder no longer holds payments:refund (PT409
--    transfer_recorder_inactive) or has since come to refer the customer as a
--    partner; it rechecks the customer's access, ID review and slot limit
--    (counting checkouts still open at Ozow) and then records a complete,
--    fulfilled payment with one line and one slot per slot starting now, its
--    invoice, the payment_completed outbox event (the receipt email) and the
--    partner commission, exactly as an Ozow payment. A declined record cannot
--    be confirmed and a confirmed one cannot be declined (PT409
--    transfer_not_waiting); a repeat by the same staff member returns the
--    result.
-- 6. Staff never act for an account of their own identity, nor for a customer
--    that a partner account of their identity referred (42501
--    staff_referred_customer).
-- 7. New staff reads: api.get_staff_invoice_customer(p_account_email)
--    (payments:refund) shows whose account an email names before recording;
--    api.get_staff_invoice_transfers() (payments:view) lists the waiting
--    records; api.get_staff_invoice_payments(p_payment_ids) (payments:view)
--    gives the bank transfer details of up to 50 listed payments.
-- 8. The receipt read api.get_payment_receipt also returns payment_method and,
--    for an invoice payment, the bank reference, which the receipt email shows
--    instead of the Ozow reference.
-- 9. The staff audit trail (private.frontend_staff_audit_events) lists each
--    record, confirmation and decline.
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Read-only preflight: ../preflight/20261113133605_staff_invoice_payments.check.sql.
-- Rollback: ../rollback/20261113133605_staff_invoice_payments.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the staff payment fixes and individual slot rules this update
-- builds on are present with their reviewed bodies; the receipt read is the
-- earlier one or this update's; the payment rules are the earlier ones or this
-- update's; the new table is absent or exactly this update's; the new
-- capability is absent or exactly this update's.
do $$
declare shape text;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_payment_actor(uuid,uuid)')) is distinct from 'fe81cc39557206e06346fcf5e9f33bfd'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_delivery_commission(uuid)')) is distinct from '173b97b47147f69d097daba72def56d9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_partner_commission()')) is distinct from 'e99f071fae090328566a61186843c6e2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment(uuid,text,text)')) is distinct from '66005adb9e06b17e689dbac47ce93d5a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_invoice_vat(private.payments)')) is distinct from '8ba4ca6c4ea0207abece5a9fdc57336e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_invoice_snapshot()')) is distinct from '4b51e17e7650f49c4486ffe86631ff2c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_quote_guard()')) is distinct from '1042ebb47721d807667a17be53ae2559'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slots_counted(text,uuid,uuid)')) is distinct from '1444a238736eac1d4de7dc8a53526e9b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_limit(text)')) is distinct from '90ecd5c02572cc9831468458f3ae0e2d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_plan(text)')) is distinct from 'c0c1d06dc52122641d02db6b1364be75'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.same_identity(uuid,uuid)')) is distinct from '535e5c87d944edd45bd2b3dce28f98b6'
    or not coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_payment_receipt(uuid)')) in
      ('1c8ef468ae622086d57af8b8c16fb886', '82b6d1f1a4f8f1b7e1325c71146b453d'), false)
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_payment_receipt(uuid)')) is distinct from '245869d4f4c606db44bc43c0cea8c4e3'
    or to_regclass('private.payment_activations') is null
    or to_regclass('private.payment_refund_requests') is null
    or coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) not like '%payment_refund_requests%', true) then
    raise exception 'staff invoice payments precondition: apply 20261113021223_staff_payment_fixes.sql first (reviewed bodies required)'
      using errcode='55000';
  end if;
  if not coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='private.payments'::regclass
        and c.conname='payments_provider_check') in ('CHECK ((provider = ''ozow''::text))',
        'CHECK ((provider = ANY (ARRAY[''ozow''::text, ''invoice''::text])))'), false)
    or not coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='private.payments'::regclass
        and c.conname='payments_check1') in (
        'CHECK ((((status = ''complete''::text) = ((completed_at IS NOT NULL) AND (provider_transaction_id IS NOT NULL))) OR (status = ANY (ARRAY[''refunded''::text, ''chargeback''::text]))))',
        'CHECK ((((status = ''complete''::text) = ((completed_at IS NOT NULL) AND ((provider_transaction_id IS NOT NULL) OR (provider = ''invoice''::text)))) OR (status = ANY (ARRAY[''refunded''::text, ''chargeback''::text]))))'), false)
    or not coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='private.payments'::regclass
        and c.conname='payments_invoice_without_ozow') = 'CHECK (((provider <> ''invoice''::text) OR ((provider_request_id IS NULL) AND (provider_transaction_id IS NULL) AND (checkout_url IS NULL) AND (checkout_expires_at IS NULL) AND (checkout_claim_token IS NULL) AND (checkout_claim_until IS NULL))))',
        not exists(select 1 from pg_constraint c where c.conrelid='private.payments'::regclass
          and c.conname='payments_invoice_without_ozow')) then
    raise exception 'staff invoice payments precondition: private.payments constraints differ from the reviewed ones'
      using errcode='55000';
  end if;
  if exists(select 1 from private.staff_capabilities c where c.capability='payments:confirm_transfer'
      and (c.role <> 'admin' or not c.requires_recent_mfa)) then
    raise exception 'staff invoice payments precondition: payments:confirm_transfer is granted differently'
      using errcode='55000';
  end if;
  select 'private.invoice_transfers '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
    from pg_catalog.pg_attribute a where a.attrelid=to_regclass('private.invoice_transfers') and a.attnum>0 and not a.attisdropped),'absent')
  into shape;
  if shape not in ('private.invoice_transfers absent', 'private.invoice_transfers id:uuid!,account_id:uuid!,plan_version_id:uuid!,slots:integer!,'
        ||'amount_received_cents:bigint!,bank_reference:text!,cleared_on:date!,'
        ||'cooling_off_waiver_confirmed:boolean!,reason:text!,recorded_by:uuid!,'
        ||'recorded_at:timestamp with time zone!,status:text!,confirmed_by:uuid,'
        ||'confirmed_at:timestamp with time zone,payment_id:uuid,declined_by:uuid,'
        ||'declined_at:timestamp with time zone,decline_reason:text') then
    raise exception 'staff invoice payments table drift: %', shape using errcode='55000';
  end if;
  select 'private.invoice_transfers '||case when to_regclass('private.invoice_transfers') is null then 'absent'
    else coalesce((select string_agg(s.n, ',' order by s.n collate "C") from (
      select c.conname::text as n from pg_catalog.pg_constraint c where c.conrelid=to_regclass('private.invoice_transfers') and c.contype <> 'n'
      union select i.relname::text from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid=x.indexrelid
        where x.indrelid=to_regclass('private.invoice_transfers')) s),'none') end
  into shape;
  if shape not in ('private.invoice_transfers absent', 'private.invoice_transfers invoice_transfers_account_id_fkey,invoice_transfers_account_idx,'
        ||'invoice_transfers_amount_received_cents_check,invoice_transfers_bank_reference_check,'
        ||'invoice_transfers_confirmed,invoice_transfers_confirmed_by_fkey,invoice_transfers_confirmed_by_idx,'
        ||'invoice_transfers_confirmer,invoice_transfers_cooling_off_waiver_confirmed_check,'
        ||'invoice_transfers_decline_reason_check,invoice_transfers_declined,'
        ||'invoice_transfers_declined_by_fkey,invoice_transfers_declined_by_idx,invoice_transfers_not_own,'
        ||'invoice_transfers_payment_id_fkey,invoice_transfers_payment_idx,invoice_transfers_pkey,'
        ||'invoice_transfers_plan_version_id_fkey,invoice_transfers_plan_version_idx,'
        ||'invoice_transfers_reason_check,invoice_transfers_recorded_by_fkey,invoice_transfers_recorded_by_idx,'
        ||'invoice_transfers_reference_idx,invoice_transfers_slots_check,invoice_transfers_status_check,'
        ||'invoice_transfers_waiting_idx') then
    raise exception 'staff invoice payments constraint or index drift: %', shape using errcode='55000';
  end if;
end$$;

-- 1. A payment may be a bank transfer confirmed by staff (provider 'invoice'):
-- complete without an Ozow transaction id, and never with Ozow's fields. One
-- statement, so the existing payments are checked in one pass while the table
-- is locked (a few rows today; the update waits at most 5 seconds for the
-- lock and the commit releases it).
alter table private.payments drop constraint if exists payments_provider_check,
  drop constraint if exists payments_check1,
  drop constraint if exists payments_invoice_without_ozow,
  add constraint payments_provider_check check (provider in ('ozow', 'invoice')),
  add constraint payments_check1 check ((status = 'complete')
    = (completed_at is not null and (provider_transaction_id is not null or provider = 'invoice'))
    or status in ('refunded', 'chargeback')),
  add constraint payments_invoice_without_ozow check (provider <> 'invoice'
    or (provider_request_id is null and provider_transaction_id is null and checkout_url is null
      and checkout_expires_at is null and checkout_claim_token is null and checkout_claim_until is null));

-- 2. Recorded bank transfers, waiting for a second staff member.
create table if not exists private.invoice_transfers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete restrict,
  plan_version_id uuid not null references private.plan_versions (id) on delete restrict,
  slots integer not null check (slots between 1 and 25),
  amount_received_cents bigint not null check (amount_received_cents > 0 and amount_received_cents <= 5000000),
  -- As typed on the bank statement: 4 to 60 letters, digits, single spaces or
  -- . _ : / -, starting with a letter or digit, with at least four letters or
  -- digits.
  bank_reference text not null check (bank_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'
    and bank_reference = btrim(bank_reference) and bank_reference !~ '  '
    and length(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')) >= 4),
  cleared_on date not null,
  cooling_off_waiver_confirmed boolean not null check (cooling_off_waiver_confirmed),
  reason text not null check (internal.plain_text_valid(reason, 5, 500, true)),
  recorded_by uuid not null references auth.users (id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp(),
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation', 'confirmed', 'declined')),
  confirmed_by uuid references auth.users (id) on delete restrict,
  confirmed_at timestamptz,
  payment_id uuid references private.payments (id) on delete restrict,
  declined_by uuid references auth.users (id) on delete restrict,
  declined_at timestamptz,
  decline_reason text check (decline_reason is null or internal.plain_text_valid(decline_reason, 5, 500, true)),
  constraint invoice_transfers_not_own check (recorded_by <> account_id),
  constraint invoice_transfers_confirmed check ((status = 'confirmed')
    = (confirmed_by is not null and confirmed_at is not null and payment_id is not null)),
  constraint invoice_transfers_declined check ((status = 'declined')
    = (declined_by is not null and declined_at is not null and decline_reason is not null)),
  constraint invoice_transfers_confirmer check (confirmed_by is null
    or (confirmed_by <> recorded_by and confirmed_by <> account_id))
);
alter table private.invoice_transfers enable row level security;
revoke all on table private.invoice_transfers from public, anon, authenticated, service_role;
-- A bank reference is used once across every record, waiting, confirmed or
-- declined: compared on its letters and digits only, whatever the case
-- ("FNB 123-45" and "fnb12345" are the same reference).
create unique index if not exists invoice_transfers_reference_idx on private.invoice_transfers
  (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')));
create unique index if not exists invoice_transfers_payment_idx on private.invoice_transfers (payment_id)
  where payment_id is not null;
create index if not exists invoice_transfers_waiting_idx on private.invoice_transfers (recorded_at)
  where status = 'awaiting_confirmation';
create index if not exists invoice_transfers_account_idx on private.invoice_transfers (account_id);
create index if not exists invoice_transfers_plan_version_idx on private.invoice_transfers (plan_version_id);
create index if not exists invoice_transfers_recorded_by_idx on private.invoice_transfers (recorded_by);
create index if not exists invoice_transfers_confirmed_by_idx on private.invoice_transfers (confirmed_by)
  where confirmed_by is not null;
create index if not exists invoice_transfers_declined_by_idx on private.invoice_transfers (declined_by)
  where declined_by is not null;

CREATE OR REPLACE FUNCTION internal.invoice_transfer_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  -- A recorded bank transfer is an audit record: never removed; recorded as
  -- waiting; changed only once, from waiting to confirmed (naming its invoice
  -- payment: that account, amount and plan) or to declined.
  if tg_op = 'DELETE' then
    raise exception 'recorded bank transfers are never removed' using errcode='23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'awaiting_confirmation' or new.confirmed_by is not null or new.confirmed_at is not null
        or new.payment_id is not null or new.declined_by is not null or new.declined_at is not null
        or new.decline_reason is not null then
      raise exception 'a bank transfer is recorded as waiting for confirmation' using errcode='23514';
    end if;
    return new;
  end if;
  if old.status <> 'awaiting_confirmation' or new.status not in ('confirmed', 'declined')
      or (to_jsonb(new) - array['status','confirmed_by','confirmed_at','payment_id','declined_by','declined_at','decline_reason'])
        is distinct from (to_jsonb(old) - array['status','confirmed_by','confirmed_at','payment_id','declined_by','declined_at','decline_reason']) then
    raise exception 'a recorded bank transfer is confirmed or declined once and never changed' using errcode='23514';
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
revoke all on function internal.invoice_transfer_guard() from public, anon, authenticated, service_role;
drop trigger if exists invoice_transfers_guard on private.invoice_transfers;
create trigger invoice_transfers_guard before insert or update or delete on private.invoice_transfers
  for each row execute function internal.invoice_transfer_guard();

-- 3. Who may confirm or decline a recorded bank transfer: admins, with a
-- recent second factor.
insert into private.staff_capabilities (role, capability, requires_recent_mfa)
  values ('admin', 'payments:confirm_transfer', true)
  on conflict (role, capability) do nothing;

-- 4. Shared rules.
-- A staff member never handles a payment of a customer that a partner account
-- of their own identity referred (it would earn them commission).
CREATE OR REPLACE FUNCTION internal.assert_staff_not_referrer(p_actor uuid, p_customer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if exists(select 1 from private.account_acquisitions a join private.partners p on p.id = a.partner_id
      where a.account_id = p_customer and internal.same_identity(p_actor, p.account_id)) then
    raise exception 'a different staff member must handle a payment of a customer you referred'
      using errcode='42501', detail='staff_referred_customer';
  end if;
end;
$function$;
alter function internal.assert_staff_not_referrer(uuid,uuid) owner to postgres;
revoke all on function internal.assert_staff_not_referrer(uuid,uuid) from public, anon, authenticated, service_role;

-- The one confirmed account an email names (PT404 otherwise).
CREATE OR REPLACE FUNCTION internal.invoice_customer_by_email(p_account_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare matches integer; customer uuid;
begin
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 then
    raise exception 'customer email required' using errcode='22023', detail='invoice_payment_invalid';
  end if;
  select count(*), min(u.id::text)::uuid into matches, customer from auth.users u
    where lower(u.email) = lower(btrim(p_account_email)) and u.email_confirmed_at is not null
      and u.is_anonymous is false;
  if matches <> 1 then
    raise exception 'no confirmed account has that email' using errcode='PT404', detail='invoice_account_unavailable';
  end if;
  return customer;
end;
$function$;
alter function internal.invoice_customer_by_email(text) owner to postgres;
revoke all on function internal.invoice_customer_by_email(text) from public, anon, authenticated, service_role;

-- What a staff member needs to see of a record: also the customer's account
-- email (to match the bank statement) and how many other records, waiting or
-- confirmed, name the same customer, amount and date (a possible duplicate
-- under another reference).
CREATE OR REPLACE FUNCTION internal.invoice_transfer_dto(t private.invoice_transfers, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('transfer_id', t.id, 'status', t.status, 'account_id', t.account_id,
    'customer_email', (select u.email from auth.users u where u.id = t.account_id),
    'similar_records', (select count(*) from private.invoice_transfers x where x.id <> t.id
      and x.account_id = t.account_id and x.amount_received_cents = t.amount_received_cents
      and x.cleared_on = t.cleared_on and x.status <> 'declined'),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.account_id)),
    'term_days', (select v.duration_days from private.plan_versions v where v.id = t.plan_version_id),
    'slots', t.slots, 'amount_received_cents', t.amount_received_cents, 'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'), 'reason', t.reason,
    'recorded_at', t.recorded_at, 'recorded_by_me', internal.same_identity(t.recorded_by, p_actor),
    'recorded_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = t.recorded_by)),
    'payment_id', t.payment_id);
$function$;
alter function internal.invoice_transfer_dto(private.invoice_transfers,uuid) owner to postgres;
revoke all on function internal.invoice_transfer_dto(private.invoice_transfers,uuid) from public, anon, authenticated, service_role;

-- 5. Before recording, staff see whose account an email names: the public
-- name, whether their ID review is accepted and the Individual slots they hold.
CREATE OR REPLACE FUNCTION internal.get_staff_invoice_customer(p_account_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; fingerprint text; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  fingerprint := internal.current_verified_identity(buyer);
  result := jsonb_build_object('customer_name', internal.profile_public_name(
      (select f.display_name from private.profiles f where f.account_id = buyer)),
    'id_reviewed', fingerprint is not null,
    'can_use_slots', exists(select 1 from private.current_account_access a where a.id = buyer),
    'slots_held', case when fingerprint is null then null
      else (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer end,
    'slot_limit', case when fingerprint is null then null else internal.individual_slot_limit(fingerprint) end);
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_customer(text) owner to postgres;
revoke all on function internal.get_staff_invoice_customer(text) from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_invoice_customer(text) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_invoice_customer(p_account_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_invoice_customer(p_account_email);
$function$;
alter function api.get_staff_invoice_customer(text) owner to postgres;
revoke all on function api.get_staff_invoice_customer(text) from public, anon, authenticated, service_role;
grant execute on function api.get_staff_invoice_customer(text) to authenticated;

-- 6. Record a cleared bank transfer: stored as waiting; nothing starts.
CREATE OR REPLACE FUNCTION internal.record_staff_invoice_payment(p_account_email text, p_term_days integer,
  p_slots integer, p_amount_cents bigint, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean,
  p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; reference text; reference_key text; cleared date; today date;
  plan private.plan_versions; prior private.invoice_transfers; made private.invoice_transfers; fingerprint text;
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
  if cleared > today or cleared < today - 90 then
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
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key;
  if found then
    if prior.recorded_by = actor and prior.account_id = buyer and prior.reason = btrim(p_reason)
        and prior.amount_received_cents = p_amount_cents and prior.cleared_on = cleared and prior.slots = p_slots
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.invoice_transfer_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that bank reference was already recorded (%)', replace(prior.status, '_', ' ')
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
  if plan.price_cents * p_slots <> p_amount_cents then
    raise exception 'the amount received is not the order total of % cents', plan.price_cents * p_slots
      using errcode='PT428', detail='invoice_amount_mismatch';
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
revoke all on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_invoice_payment(p_account_email text, p_term_days integer,
  p_slots integer, p_amount_cents bigint, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean,
  p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_invoice_payment(p_account_email, p_term_days, p_slots, p_amount_cents,
    p_bank_reference, p_cleared_on, p_cooling_off_waiver, p_reason);
$function$;
alter function api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) owner to postgres;
revoke all on function api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) to authenticated;

-- Locks a record for a second staff member: the reference, then the person,
-- then the row; every authority check again after the waits. Never the
-- recorder (or another account of the recorder's identity), never the
-- customer, never a partner who referred the customer.
CREATE OR REPLACE FUNCTION internal.lock_invoice_transfer_for_review(p_transfer_id uuid, p_actor uuid)
 RETURNS private.invoice_transfers
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare t private.invoice_transfers;
begin
  if p_transfer_id is null then raise exception 'recorded bank transfer required' using errcode='22023'; end if;
  select * into t from private.invoice_transfers x where x.id = p_transfer_id;
  if not found then raise exception 'recorded bank transfer not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(p_actor, t.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-bank-reference:'
    ||upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')), 707));
  perform internal.lock_evidence_subject(t.account_id);
  select * into t from private.invoice_transfers x where x.id = p_transfer_id for update;
  if internal.staff_actor('payments:confirm_transfer') is distinct from p_actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, t.account_id);
  perform internal.assert_staff_not_referrer(p_actor, t.account_id);
  return t;
end;
$function$;
alter function internal.lock_invoice_transfer_for_review(uuid,uuid) owner to postgres;
revoke all on function internal.lock_invoice_transfer_for_review(uuid,uuid) from public, anon, authenticated, service_role;

-- 7. A second staff member confirms: only now the payment, slots, invoice,
-- receipt and commission are made.
CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint;
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
  select * into plan from private.plan_versions v where v.id = t.plan_version_id;
  if plan.price_cents * t.slots <> t.amount_received_cents or not internal.individual_slot_plan(plan.plan_code) then
    raise exception 'the recorded amount is not the order total' using errcode='PT428', detail='invoice_amount_mismatch';
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
          'wording', 'My slot starts now; the 7-day cooling-off does not apply because the service starts immediately')),
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
revoke all on function internal.confirm_staff_invoice_payment(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.confirm_staff_invoice_payment(uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.confirm_staff_invoice_payment(p_transfer_id);
$function$;
alter function api.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function api.confirm_staff_invoice_payment(uuid) from public, anon, authenticated, service_role;
grant execute on function api.confirm_staff_invoice_payment(uuid) to authenticated;

-- 8. Decline a waiting record with a reason (its recorder may withdraw it).
-- The bank reference stays used.
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
revoke all on function internal.decline_staff_invoice_payment(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.decline_staff_invoice_payment(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.decline_staff_invoice_payment(p_transfer_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.decline_staff_invoice_payment(p_transfer_id, p_reason);
$function$;
alter function api.decline_staff_invoice_payment(uuid,text) owner to postgres;
revoke all on function api.decline_staff_invoice_payment(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.decline_staff_invoice_payment(uuid,text) to authenticated;

-- 9. Staff reads: the records waiting for confirmation (oldest first), and the
-- bank transfer details of listed payments.
CREATE OR REPLACE FUNCTION internal.get_staff_invoice_transfers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  select jsonb_build_object('waiting', (select count(*) from private.invoice_transfers t where t.status = 'awaiting_confirmation'),
      'items', coalesce(jsonb_agg(internal.invoice_transfer_dto(t, actor) order by t.recorded_at, t.id), '[]'::jsonb))
    into result
  from (select * from private.invoice_transfers x where x.status = 'awaiting_confirmation'
    order by x.recorded_at, x.id limit 50) t;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_invoice_transfers() from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_invoice_transfers() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_invoice_transfers()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_invoice_transfers();
$function$;
alter function api.get_staff_invoice_transfers() owner to postgres;
revoke all on function api.get_staff_invoice_transfers() from public, anon, authenticated, service_role;
grant execute on function api.get_staff_invoice_transfers() to authenticated;

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_payments(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payment ids required' using errcode='22023';
  end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object('payment_id', t.payment_id,
      'bank_reference', t.bank_reference, 'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'),
      'amount_received_cents', t.amount_received_cents, 'recorded_at', t.recorded_at,
      'recorded_by_me', internal.same_identity(t.recorded_by, actor),
      'confirmed_by_me', internal.same_identity(t.confirmed_by, actor), 'reason', t.reason)
      order by t.recorded_at desc, t.payment_id), '[]'::jsonb))
    into result
  from private.invoice_transfers t where t.payment_id = any (p_payment_ids);
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_payments(uuid[]) owner to postgres;
revoke all on function internal.get_staff_invoice_payments(uuid[]) from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_invoice_payments(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_invoice_payments(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_invoice_payments(p_payment_ids);
$function$;
alter function api.get_staff_invoice_payments(uuid[]) owner to postgres;
revoke all on function api.get_staff_invoice_payments(uuid[]) from public, anon, authenticated, service_role;
grant execute on function api.get_staff_invoice_payments(uuid[]) to authenticated;

-- 10. The receipt email's read also says how the payment was made and, for a
-- bank transfer, the reference the customer's bank statement shows.
CREATE OR REPLACE FUNCTION internal.get_payment_receipt(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('payment_id', p.id, 'owner_id', p.owner_id, 'amount_cents', p.amount_cents,
    'currency', p.currency, 'completed_at', p.completed_at, 'product_kind', p.product_kind,
    'label', coalesce(p.snapshot->>'label', initcap(p.snapshot->>'addon')||' add-on', 'Payment'),
    'slots', case when p.product_kind = 'plan' and jsonb_typeof(p.snapshot->'slots') = 'number'
      then p.snapshot->'slots' else 'null'::jsonb end,
    'invoice_description', i.description, 'invoice_number', i.invoice_number, 'issued_at', i.issued_at,
    'merchant_reference', p.merchant_reference, 'provider_transaction_id', p.provider_transaction_id,
    'status', p.status, 'fulfillment_status', p.fulfillment_status,
    'payment_method', p.provider,
    'bank_reference', (select t.bank_reference from private.invoice_transfers t where t.payment_id = p.id))
  from private.payments p left join private.invoices i on i.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

-- 11. The staff audit trail also lists each record, confirmation and decline.
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
  WHERE t.declined_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public, anon, authenticated, service_role;

commit;
