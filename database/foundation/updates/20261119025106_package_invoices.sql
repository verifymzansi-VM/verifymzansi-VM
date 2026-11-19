-- Multi-listing package invoices and "Ask for an invoice" (roadmap P4e; the
-- owner's decisions 5, 6 and 12 of 14 November 2026 on the multi-listing gap
-- review, and of 16 November 2026: an invoice first at any amount, paid with
-- Pay now up to the online payment limit or by bank transfer).
--
-- Apply after 20261118182332_refund_follow_ups.sql (filename order; this update
-- needs 20261114154823_slot_packages.sql, 20261114041000_customer_invoice_pay_now.sql
-- and 20261118044440_bank_transfer_expiry.sql). It refuses with 55000 unless the
-- nine functions it replaces have their reviewed bodies (or this update's) and
-- the ones it adds are absent (or this update's). Only adds: no API command,
-- argument or grant is removed or changed, and no field is added to an existing
-- command's answer. **Nothing can be bought after it is applied**: Multi-listing
-- packages stay off sale (private.slot_package_sales.on_sale is false) and every
-- new command refuses with PT403 packages_not_on_sale until the owner switches
-- them on. In one transaction it:
--
-- 1. Lets an invoice and a bank transfer hold a package order: up to 250 slots
--    and R150,000 (250 slots for 180 days at R600). The Individual commands
--    keep their own limits (1 to 25 slots, at most R50,000). A payment line
--    holding more than one slot (a package line) may be up to R150,000; a
--    one-slot line stays at most R10,000.
-- 2. Adds private.package_invoice_requests: a member's request for a package
--    invoice (term, slots, the price and total computed here from the
--    catalogue, the cooling-off confirmation in the invoice's own words
--    'invoice-cooling-off-v1', and what staff did with it). What the member
--    asked never changes; staff details are written once; it moves on once
--    (trigger package_invoice_requests_guard). One open request per account,
--    at most 10 new requests per account in 24 hours (PT429
--    package_invoice_requests_limit).
-- 3. "Ask for an invoice": api.request_package_invoice(p_plan_id, p_slots,
--    p_expected_total_cents, p_cooling_off_consent, p_request_id) (member) for
--    5 to 250 slots at any amount, with an accepted ID review (PT412), the total
--    the member was shown (PT428), the confirmation (22023
--    invoice_consent_required), no package that has not ended (PT409
--    package_active) and no unpaid package invoice (PT409
--    package_invoice_unpaid). The same request id returns the first answer;
--    the same order again keeps the waiting request; another order replaces it
--    while no staff member has prepared it (PT409 package_invoice_request_open
--    once one has). api.get_my_package_invoice_request() reads the latest.
-- 4. Staff: api.get_staff_package_invoice_requests() (payments:view, open
--    requests oldest first); api.issue_staff_package_invoice(p_request_id,
--    p_due_days, p_reason) (payments:refund) issues the invoice at the price
--    asked for, with the next VM-YYYY-NNNNNN number, after checking the
--    account, its ID review, the switch, the price (PT409
--    invoice_plan_unavailable), no package (PT409 package_active), no other
--    unpaid package invoice and the VAT setting again; above R50,000 it only
--    prepares it (awaiting_approval, no number) and
--    api.approve_staff_package_invoice(p_request_id)
--    (payments:confirm_transfer) issues it: never the preparer or another
--    account of their identity (42501 invoice_approver_same), and only while
--    the preparer still holds payments:refund and a current accepted ID
--    review of their own (PT409 invoice_preparer_inactive). api.decline_staff_package_invoice_request
--    (p_request_id, p_reason) (payments:refund) closes an open request. Every
--    staff command checks the staff member's own ID review, never their own
--    identity's account and never a customer they referred, again after every
--    lock wait; repeats by the same staff member return the first answer.
-- 5. Pays a package invoice like an Individual one, as a package:
--    internal.start_invoice_payment ("Pay now", up to the online payment
--    limit) starts one payment with one line holding every slot (the package
--    checkout's snapshot), so the existing Ozow notice delivers it as a
--    package (internal.customer_invoice_payment_guard accepts that one line
--    as the attempt of a package invoice); internal.record_staff_invoice_transfer and
--    internal.confirm_staff_invoice_payment (a bank transfer, two staff
--    members) record and deliver it the same way (one line, one grant opening
--    the package, its invoice record, receipt event and partner commission).
--    Each needs packages on sale and no package of the account that has not
--    ended; none counts the Individual slot limit or E3. Individual invoices
--    are unchanged, except that confirming any bank transfer now also needs the
--    recorder's own current ID review (PT409 transfer_recorder_inactive). The
--    online package checkout (internal.start_package_checkout) refuses while a
--    package invoice of the account is unpaid (PT409 package_invoice_unpaid).
-- 6. The privacy export lists the member's package invoice requests (dataset
--    package_invoice_requests). Closing an account withdraws its open request
--    (internal.close_account_evidence); erasure withdraws it too and unlinks
--    every request from the account (internal.erase_closed_account; the
--    guard allows only that); the retention job removes declined and withdrawn
--    requests five tax years after they closed (internal.retention_commerce),
--    and an issued one goes with its invoice.
--
-- Order: apply first, then merge (the website release calls the new commands
-- and the deploy preflight probes them). Earlier releases keep working: they
-- never call the new commands, and no package invoice can exist while
-- packages are off sale.
-- Read-only preflight: ../preflight/20261119025106_package_invoices.check.sql.
-- Rollback: ../rollback/20261119025106_package_invoices.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces have the reviewed bodies
-- (or this update's), and the ones it adds are absent (or this update's).
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.start_invoice_payment(text,bigint,boolean)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.confirm_staff_invoice_payment(uuid)'),
      ('internal.frontend_privacy_export_data(uuid)'),
      ('internal.customer_invoice_payment_guard()'),
      ('internal.start_package_checkout(uuid,integer,bigint,boolean)'),
      ('internal.close_account_evidence(uuid)'),
      ('internal.erase_closed_account(uuid,text)'),
      ('internal.retention_commerce(integer)')) v(sig)
    union all
    select n.nspname||'.'||v.name||' '||coalesce((select string_agg(md5(replace(p.prosrc,E'\r\n',E'\n')), ',')
        from pg_proc p where p.pronamespace=n.oid and p.proname=v.name),'absent')
    from (values ('internal', 'package_invoice_request_guard'), ('internal', 'package_invoice_approval_above_cents'),
      ('internal', 'package_invoice_request_dto'), ('internal', 'package_invoice_issue_check'),
      ('internal', 'issue_package_customer_invoice'), ('internal', 'request_package_invoice'),
      ('api', 'request_package_invoice'), ('internal', 'get_my_package_invoice_request'),
      ('api', 'get_my_package_invoice_request'), ('internal', 'get_staff_package_invoice_requests'),
      ('api', 'get_staff_package_invoice_requests'), ('internal', 'lock_package_invoice_request'),
      ('internal', 'issue_staff_package_invoice'), ('api', 'issue_staff_package_invoice'),
      ('internal', 'approve_staff_package_invoice'), ('api', 'approve_staff_package_invoice'),
      ('internal', 'decline_staff_package_invoice_request'), ('api', 'decline_staff_package_invoice_request')) v(schema_name, name)
    join pg_namespace n on n.nspname=v.schema_name
  loop
    if shape not in (
        'internal.start_invoice_payment(text,bigint,boolean) ea362defef15f7d6116a0f96cc53fef5',
        'internal.start_invoice_payment(text,bigint,boolean) a43e58e5ebc85179c901428e4f0f805e',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 9e52c2ebd9dae698e4b7ee59904d4c46',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 6f508a66a82ad2a24e4c43c324fd90a3',
        'internal.confirm_staff_invoice_payment(uuid) 0ccc38ab7e5dff36bf27b4047c58b218',
        'internal.confirm_staff_invoice_payment(uuid) 3daa82e3347ee5e2880279251c9521c2',
        'internal.frontend_privacy_export_data(uuid) 86a879279ebd9dcadf6f3f4fa11e7f44',
        'internal.frontend_privacy_export_data(uuid) 0b4cd3f792ffecf94c329277db4da28e',
        'internal.customer_invoice_payment_guard() 7ad52ae1b3e37ad792d8dca2a275ca96',
        'internal.customer_invoice_payment_guard() 397c6a0239c508923a8215b2953d23d5',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) 947486cd48be84b7a45714ec51d1bae4',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) d5d9713994c8789030bd30c90c4c00b5',
        'internal.close_account_evidence(uuid) 0300a2d267a77b797d7316a4cdf43e75',
        'internal.close_account_evidence(uuid) ae0f20403df41b820bad1c96d93a0be1',
        'internal.erase_closed_account(uuid,text) 1dc0781f7497f50fd305dd0903b37ec5',
        'internal.erase_closed_account(uuid,text) 0110024c386259da47b96caf79555bac',
        'internal.retention_commerce(integer) 55051470a07c224838cb58dc45d66406',
        'internal.retention_commerce(integer) 755823787c716f14012a64aad254134d',
        'internal.package_invoice_request_guard absent',
        'internal.package_invoice_request_guard e41853f9d3e75297df7a4bf00e736792',
        'internal.package_invoice_approval_above_cents absent',
        'internal.package_invoice_approval_above_cents b775e7ca727cdf3583b884cf83106404',
        'internal.package_invoice_request_dto absent',
        'internal.package_invoice_request_dto 16fb4eae547a00d51cf95b55adc16dda',
        'internal.package_invoice_issue_check absent',
        'internal.package_invoice_issue_check e0ae2e35373cba98b3cb385d07871377',
        'internal.issue_package_customer_invoice absent',
        'internal.issue_package_customer_invoice 117d33c9a93c2d965e138a7fdc7930b8',
        'internal.request_package_invoice absent',
        'internal.request_package_invoice beb95771af677d39b775e83197dfd8d1',
        'api.request_package_invoice absent',
        'api.request_package_invoice 096d60996af28df5e8aaa0d5fe51918d',
        'internal.get_my_package_invoice_request absent',
        'internal.get_my_package_invoice_request f46514db5c5524de116f099e0794a89b',
        'api.get_my_package_invoice_request absent',
        'api.get_my_package_invoice_request 5208556a35b7224da595e8cbc7e65b4d',
        'internal.get_staff_package_invoice_requests absent',
        'internal.get_staff_package_invoice_requests 30e148de7bfe9c6730218c712a622710',
        'api.get_staff_package_invoice_requests absent',
        'api.get_staff_package_invoice_requests 7662153696a6e67c6b58431e88285f16',
        'internal.lock_package_invoice_request absent',
        'internal.lock_package_invoice_request c61bd2426d996277afa7d62b4e34c047',
        'internal.issue_staff_package_invoice absent',
        'internal.issue_staff_package_invoice a69a568ea6d0173b70b2cc924da1c548',
        'api.issue_staff_package_invoice absent',
        'api.issue_staff_package_invoice 9df49639f4e8861953faf6a8972e237a',
        'internal.approve_staff_package_invoice absent',
        'internal.approve_staff_package_invoice f8666f0fef8839ad924daaff4d99d2bf',
        'api.approve_staff_package_invoice absent',
        'api.approve_staff_package_invoice fe1e424c2d010af354ee0bff1eb6b43b',
        'internal.decline_staff_package_invoice_request absent',
        'internal.decline_staff_package_invoice_request 74afb491d3b43b9ba6d0f77af7c75e14',
        'api.decline_staff_package_invoice_request absent',
        'api.decline_staff_package_invoice_request 2f6a2b27f80e7e808bd14c2ace784e53') then
      raise exception 'package invoices precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. Invoices and bank transfers hold a package order: up to 250 slots and
-- R150,000 (250 slots x 180 days at R600). The commands keep their own
-- limits: an Individual invoice or transfer is still 1 to 25 slots and at most
-- R50,000; a package 5 to 250 slots.
alter table private.customer_invoices drop constraint if exists customer_invoices_slots_check,
  add constraint customer_invoices_slots_check check (slots >= 1 and slots <= 250);
alter table private.customer_invoices drop constraint if exists customer_invoices_total_cents_check,
  add constraint customer_invoices_total_cents_check check (total_cents > 0 and total_cents <= 15000000);
alter table private.invoice_transfers drop constraint if exists invoice_transfers_slots_check,
  add constraint invoice_transfers_slots_check check (slots >= 1 and slots <= 250);
alter table private.invoice_transfers drop constraint if exists invoice_transfers_amount_received_cents_check,
  add constraint invoice_transfers_amount_received_cents_check check (amount_received_cents > 0 and amount_received_cents <= 15000000);
-- A payment line is one slot (at most R10,000) or one package line holding
-- every slot of a package: at most R10,000 per slot it holds and R150,000.
alter table private.payment_lines drop constraint if exists payment_lines_amount_cents_check,
  add constraint payment_lines_amount_cents_check check (amount_cents >= 100
    and amount_cents <= 1000000 * slot_count and amount_cents <= 15000000);

-- 2. A member's request for a package invoice ("Ask for an invoice").
create table if not exists private.package_invoice_requests (
  id uuid default gen_random_uuid() not null,
  -- Null once the account was erased (the record is kept, unlinked).
  account_id uuid,
  member_request_id uuid not null,
  plan_version_id uuid not null,
  term_days integer not null,
  slots integer not null,
  unit_price_cents bigint not null,
  total_cents bigint not null,
  requested_at timestamp with time zone default statement_timestamp() not null,
  consent_at timestamp with time zone not null,
  consent_version text not null,
  consent_terms_version text,
  status text default 'requested'::text not null,
  due_days integer,
  staff_reason text,
  prepared_by uuid,
  prepared_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  invoice_id uuid,
  closed_by uuid,
  closed_at timestamp with time zone,
  close_reason text,
  constraint package_invoice_requests_pkey primary key (id),
  -- Erasure unlinks the account (internal.erase_closed_account); an issued
  -- request goes with its invoice and a declined or withdrawn one is removed
  -- five tax years after it closed (internal.retention_commerce).
  constraint package_invoice_requests_account_id_fkey foreign key (account_id) references auth.users(id) on delete cascade,
  constraint package_invoice_requests_plan_version_id_fkey foreign key (plan_version_id) references private.plan_versions(id) on delete restrict,
  constraint package_invoice_requests_invoice_id_fkey foreign key (invoice_id) references private.customer_invoices(id) on delete cascade,
  constraint package_invoice_requests_prepared_by_fkey foreign key (prepared_by) references auth.users(id) on delete restrict,
  constraint package_invoice_requests_approved_by_fkey foreign key (approved_by) references auth.users(id) on delete restrict,
  constraint package_invoice_requests_closed_by_fkey foreign key (closed_by) references auth.users(id) on delete restrict,
  constraint package_invoice_requests_member_request_key unique (account_id, member_request_id),
  constraint package_invoice_requests_invoice_key unique (invoice_id),
  constraint package_invoice_requests_term_days_check check (term_days = any (array[30, 90, 180])),
  constraint package_invoice_requests_slots_check check (slots >= 5 and slots <= 250),
  constraint package_invoice_requests_unit_price_cents_check check (unit_price_cents >= 100 and unit_price_cents <= 1000000),
  constraint package_invoice_requests_total check (total_cents = unit_price_cents * slots and total_cents <= 15000000),
  constraint package_invoice_requests_consent_version_check check (consent_version = 'invoice-cooling-off-v1'::text),
  constraint package_invoice_requests_status_check check (status = any (array['requested'::text, 'awaiting_approval'::text,
    'issued'::text, 'declined'::text, 'withdrawn'::text])),
  constraint package_invoice_requests_due_days_check check (due_days is null or (due_days >= 1 and due_days <= 30)),
  constraint package_invoice_requests_staff_reason_check check (staff_reason is null or internal.plain_text_valid(staff_reason, 5, 500, true)),
  constraint package_invoice_requests_close_reason_check check (close_reason is null or internal.plain_text_valid(close_reason, 5, 500, true)),
  constraint package_invoice_requests_prepared check ((prepared_by is null) = (prepared_at is null)
    and (prepared_by is null) = (due_days is null) and (prepared_by is null) = (staff_reason is null)),
  constraint package_invoice_requests_approved check ((approved_by is null) = (approved_at is null)
    and (approved_by is null or (status = 'issued' and approved_by <> prepared_by))),
  constraint package_invoice_requests_states check (case status
    when 'requested' then prepared_by is null and invoice_id is null and closed_at is null and closed_by is null
    when 'awaiting_approval' then prepared_by is not null and invoice_id is null and closed_at is null and closed_by is null
    when 'issued' then prepared_by is not null and invoice_id is not null and closed_at is null and closed_by is null
      and close_reason is null
    when 'declined' then invoice_id is null and approved_by is null and closed_at is not null and closed_by is not null
      and close_reason is not null
    -- withdrawn: replaced by the member's next order, or the account closed.
    else invoice_id is null and approved_by is null and closed_at is not null
      and closed_by is null and close_reason is null end),
  constraint package_invoice_requests_not_own check (prepared_by <> account_id and approved_by <> account_id
    and closed_by <> account_id)
);
alter table private.package_invoice_requests owner to postgres;
alter table private.package_invoice_requests enable row level security;
revoke all on private.package_invoice_requests from public, anon, authenticated, service_role;
-- One open request per account; the staff queue, oldest first; the account's
-- latest request; foreign keys used by deletion.
create unique index if not exists package_invoice_requests_open_idx on private.package_invoice_requests (account_id)
  where status = any (array['requested'::text, 'awaiting_approval'::text]);
create index if not exists package_invoice_requests_queue_idx on private.package_invoice_requests (requested_at, id)
  where status = any (array['requested'::text, 'awaiting_approval'::text]);
create index if not exists package_invoice_requests_account_idx on private.package_invoice_requests (account_id, requested_at desc);
create index if not exists package_invoice_requests_plan_version_idx on private.package_invoice_requests (plan_version_id);
create index if not exists package_invoice_requests_prepared_by_idx on private.package_invoice_requests (prepared_by)
  where prepared_by is not null;
create index if not exists package_invoice_requests_approved_by_idx on private.package_invoice_requests (approved_by)
  where approved_by is not null;
create index if not exists package_invoice_requests_closed_by_idx on private.package_invoice_requests (closed_by)
  where closed_by is not null;

CREATE OR REPLACE FUNCTION internal.package_invoice_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' or new.prepared_by is not null or new.approved_by is not null
        or new.invoice_id is not null or new.closed_at is not null then
      raise exception 'a package invoice request starts as requested' using errcode='23514';
    end if;
    return new;
  end if;
  -- An erasure unlinks the erased account from this kept record
  -- (internal.erase_closed_account); nothing else may change with it.
  if coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> ''
      and internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
    return new;
  end if;
  -- What the member asked for never changes; staff details are written once.
  if (new.id, new.account_id, new.member_request_id, new.plan_version_id, new.term_days, new.slots,
      new.unit_price_cents, new.total_cents, new.requested_at, new.consent_at, new.consent_version,
      new.consent_terms_version)
    is distinct from (old.id, old.account_id, old.member_request_id, old.plan_version_id, old.term_days, old.slots,
      old.unit_price_cents, old.total_cents, old.requested_at, old.consent_at, old.consent_version,
      old.consent_terms_version)
    or (old.prepared_by is not null and (new.prepared_by, new.prepared_at, new.due_days, new.staff_reason)
      is distinct from (old.prepared_by, old.prepared_at, old.due_days, old.staff_reason)) then
    raise exception 'a package invoice request keeps what was asked and prepared' using errcode='23514';
  end if;
  -- requested -> awaiting_approval, issued, declined or withdrawn;
  -- awaiting_approval -> issued, declined or withdrawn (the account closed);
  -- nothing after that.
  if not ((old.status = 'requested' and new.status in ('awaiting_approval', 'issued', 'declined', 'withdrawn'))
      or (old.status = 'awaiting_approval' and new.status in ('issued', 'declined', 'withdrawn'))) then
    raise exception 'a package invoice request moves on once, from requested or awaiting approval'
      using errcode='23514';
  end if;
  if new.status = 'issued' then
    select * into inv from private.customer_invoices i where i.id = new.invoice_id;
    if not found or inv.account_id <> new.account_id or inv.plan_version_id <> new.plan_version_id
        or inv.slots <> new.slots or inv.unit_price_cents <> new.unit_price_cents
        or inv.total_cents <> new.total_cents or inv.request_id <> new.id or inv.issued_by <> new.prepared_by
        or inv.status <> 'issued' then
      raise exception 'an issued request names its own invoice of that order' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
alter function internal.package_invoice_request_guard() owner to postgres;
revoke all on function internal.package_invoice_request_guard() from public, anon, authenticated, service_role;
drop trigger if exists package_invoice_requests_guard on private.package_invoice_requests;
create trigger package_invoice_requests_guard before insert or update on private.package_invoice_requests
  for each row execute function internal.package_invoice_request_guard();

-- 3. The rules.
CREATE OR REPLACE FUNCTION internal.package_invoice_approval_above_cents()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A package invoice above R50,000 is issued only after a second staff
  -- member approves it (owner's decision 6 of 14 November 2026).
  select 5000000::bigint;
$function$;
alter function internal.package_invoice_approval_above_cents() owner to postgres;
revoke all on function internal.package_invoice_approval_above_cents() from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.package_invoice_request_dto(r private.package_invoice_requests, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', r.id, 'status', r.status, 'term_days', r.term_days, 'slots', r.slots,
    'unit_price_cents', r.unit_price_cents, 'total_cents', r.total_cents, 'requested_at', r.requested_at,
    'invoice_number', (select i.invoice_number from private.customer_invoices i where i.id = r.invoice_id),
    'closed_at', r.closed_at)
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', r.account_id,
    'customer_email', (select u.email from auth.users u where u.id = r.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.account_id)),
    'identity_accepted', internal.current_verified_identity(r.account_id) is not null,
    'package_open', internal.slot_package_open(r.account_id),
    'needs_approval', r.total_cents > internal.package_invoice_approval_above_cents(),
    'due_days', r.due_days, 'staff_reason', r.staff_reason, 'prepared_at', r.prepared_at,
    'prepared_by_me', coalesce(internal.same_identity(r.prepared_by, p_staff), false),
    'prepared_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.prepared_by)),
    'close_reason', r.close_reason) end;
$function$;
alter function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) owner to postgres;
revoke all on function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) from public, anon, authenticated, service_role;

-- The checks before a package invoice is issued (and again before it is
-- approved): the account, its ID review, the switch, the price asked for, no
-- package that has not ended, no other unpaid package invoice, and the VAT
-- setting the invoice states. Returns the plan version.
CREATE OR REPLACE FUNCTION internal.package_invoice_issue_check(r private.package_invoice_requests)
 RETURNS private.plan_versions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare plan private.plan_versions; unpaid text;
begin
  if not exists(select 1 from private.current_account_access a where a.id = r.account_id) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  if internal.current_verified_identity(r.account_id) is null then
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v where v.id = r.plan_version_id and v.retired_at is null
    and internal.slot_package_plan(v.plan_code) and v.price_cents = r.unit_price_cents;
  if not found then
    raise exception 'this package term is no longer sold at the price asked for; decline the request'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  if internal.slot_package_open(r.account_id) then
    raise exception 'the customer already has a Multi-listing package; decline the request'
      using errcode='PT409', detail='package_active';
  end if;
  -- A package payment of the account open at Ozow could still be paid and
  -- open a package: it is finished or cancelled first.
  if exists(select 1 from private.payments p join private.plan_versions v on v.id = p.plan_version_id
      where p.owner_id = r.account_id and p.status = 'pending' and p.target_post_id is null
        and internal.slot_package_plan(v.plan_code)
        and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp())) then
    raise exception 'the customer has a package payment open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_checkout_open';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = r.account_id and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'the customer''s package invoice % is not paid yet; void it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  return plan;
end;
$function$;
alter function internal.package_invoice_issue_check(private.package_invoice_requests) owner to postgres;
revoke all on function internal.package_invoice_issue_check(private.package_invoice_requests) from public, anon, authenticated, service_role;

-- Takes the next number of the South African year and issues the invoice of
-- the request (as internal.issue_staff_invoice does for Individual slots).
CREATE OR REPLACE FUNCTION internal.issue_package_customer_invoice(r private.package_invoice_requests, p_plan private.plan_versions,
  p_issuer uuid, p_due_days integer, p_reason text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare issued_on date; year_number integer; next_number integer; made private.customer_invoices;
begin
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, r.account_id,
      p_plan.id, r.slots, p_plan.price_cents, p_plan.price_cents * r.slots,
      'Multi-listing package: ' || r.slots::text || ' slots × ' || p_plan.duration_days::text || ' days',
      issued_on + p_due_days, p_issuer, p_reason, r.id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  return made;
end;
$function$;
alter function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) owner to postgres;
revoke all on function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) from public, anon, authenticated, service_role;

-- 4. "Ask for an invoice" (the member).
CREATE OR REPLACE FUNCTION internal.request_package_invoice(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint,
  p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); plan private.plan_versions; total bigint; unpaid text;
  prior private.package_invoice_requests; waiting private.package_invoice_requests; made private.package_invoice_requests;
  consent jsonb := internal.customer_invoice_consent();
begin
  if p_plan_id is null or p_slots is null or p_expected_total_cents is null or p_request_id is null then
    raise exception 'package term, number of slots, total and request id required' using errcode='22023';
  end if;
  -- Paid by bank transfer, the slots start without the 7-day cooling-off: the
  -- member confirms it when asking (posting-v5), in the invoice's own words.
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before asking for an invoice'
      using errcode='22023', detail='invoice_consent_required';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v
    where v.id = p_plan_id and v.retired_at is null and internal.slot_package_plan(v.plan_code);
  if not found then raise exception 'this package term is not on sale' using errcode='22023'; end if;
  -- The package checkout's numbers: 5 to 250 slots; an invoice at any amount.
  if p_slots < 5 or p_slots > 250 then
    raise exception 'a package has 5 to 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you ask for a package invoice' using errcode='PT412';
  end if;
  total := plan.price_cents * p_slots;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  -- The same request again (a retried submission) returns the first answer.
  select * into prior from private.package_invoice_requests r
    where r.account_id = actor and r.member_request_id = p_request_id;
  if found then
    if prior.plan_version_id = plan.id and prior.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(prior, null) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already asked for another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  if internal.slot_package_open(actor) then
    raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'your package invoice % is not paid yet; pay it, or ask us to cancel it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  -- One request open at a time. The same order again: the waiting request
  -- stands. Another order replaces it while no staff member has prepared it.
  select * into waiting from private.package_invoice_requests r
    where r.account_id = actor and r.status in ('requested', 'awaiting_approval')
    for update;
  if found then
    if waiting.status = 'awaiting_approval' then
      raise exception 'your invoice is being prepared; ask us to cancel it before asking for another'
        using errcode='PT409', detail='package_invoice_request_open';
    end if;
    if waiting.plan_version_id = plan.id and waiting.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(waiting, null) || jsonb_build_object('repeated', true);
    end if;
  end if;
  -- At most 10 new requests per account in 24 hours (each other order is a
  -- new request), so the staff queue cannot be flooded.
  if (select count(*) from private.package_invoice_requests r
      where r.account_id = actor and r.requested_at > statement_timestamp() - interval '24 hours') >= 10 then
    raise exception 'too many invoice requests today; try again tomorrow or contact us'
      using errcode='PT429', detail='package_invoice_requests_limit';
  end if;
  if waiting.id is not null then
    update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
      where id = waiting.id;
  end if;
  insert into private.package_invoice_requests (account_id, member_request_id, plan_version_id, term_days, slots,
      unit_price_cents, total_cents, consent_at, consent_version, consent_terms_version)
    values (actor, p_request_id, plan.id, plan.duration_days, p_slots, plan.price_cents, total, statement_timestamp(),
      consent->>'version', (select c.version from private.posting_terms_current c where c.singleton))
    returning * into made;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.package_invoice_request_dto(made, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.request_package_invoice(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint,
  p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.request_package_invoice(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent, p_request_id);
$function$;
alter function api.request_package_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function api.request_package_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function api.request_package_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_my_package_invoice_request()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); latest private.package_invoice_requests;
begin
  select * into latest from private.package_invoice_requests r where r.account_id = actor
    order by r.requested_at desc, r.id desc limit 1;
  perform internal.price_draft_actor();
  return jsonb_build_object('request', case when latest.id is null then null
    else internal.package_invoice_request_dto(latest, null) end);
end;
$function$;
alter function internal.get_my_package_invoice_request() owner to postgres;
revoke all on function internal.get_my_package_invoice_request() from public;
grant execute on function internal.get_my_package_invoice_request() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_package_invoice_request()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_package_invoice_request();
$function$;
alter function api.get_my_package_invoice_request() owner to postgres;
revoke all on function api.get_my_package_invoice_request() from public;
grant execute on function api.get_my_package_invoice_request() to authenticated;

-- 5. Staff: the queue, issue (or prepare above R50,000), approve, decline.
CREATE OR REPLACE FUNCTION internal.get_staff_package_invoice_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('payments:view'); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(internal.package_invoice_request_dto(r, actor)
      order by r.requested_at, r.id), '[]'::jsonb),
    'open', (select count(*) from private.package_invoice_requests x where x.status in ('requested', 'awaiting_approval')),
    'approval_above_cents', internal.package_invoice_approval_above_cents())
    into result
  from (select * from private.package_invoice_requests x where x.status in ('requested', 'awaiting_approval')
      and x.account_id is not null
    order by x.requested_at, x.id limit 100) r;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_package_invoice_requests() owner to postgres;
revoke all on function internal.get_staff_package_invoice_requests() from public;
grant execute on function internal.get_staff_package_invoice_requests() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_package_invoice_requests()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_package_invoice_requests();
$function$;
alter function api.get_staff_package_invoice_requests() owner to postgres;
revoke all on function api.get_staff_package_invoice_requests() from public;
grant execute on function api.get_staff_package_invoice_requests() to authenticated;

-- Locks a request for a staff command: the customer, then their package, then
-- the row; the staff checks run again after every wait.
CREATE OR REPLACE FUNCTION internal.lock_package_invoice_request(p_request_id uuid, p_actor uuid, p_capability text)
 RETURNS private.package_invoice_requests
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare r private.package_invoice_requests;
begin
  if p_request_id is null then
    raise exception 'invoice request not found' using errcode='PT404', detail='package_invoice_request_unavailable';
  end if;
  select * into r from private.package_invoice_requests x where x.id = p_request_id;
  if not found then
    raise exception 'invoice request not found' using errcode='PT404', detail='package_invoice_request_unavailable';
  end if;
  if r.account_id is null then
    raise exception 'this invoice request belongs to an erased account' using errcode='PT409',
      detail='package_invoice_request_closed';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, r.account_id);
  perform internal.lock_evidence_subject(r.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.account_id::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||r.account_id::text, 707));
  select * into r from private.package_invoice_requests x where x.id = p_request_id for update;
  if internal.staff_actor(p_capability) is distinct from p_actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, r.account_id);
  perform internal.assert_staff_not_referrer(p_actor, r.account_id);
  return r;
end;
$function$;
alter function internal.lock_package_invoice_request(uuid,uuid,text) owner to postgres;
revoke all on function internal.lock_package_invoice_request(uuid,uuid,text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.issue_staff_package_invoice(p_request_id uuid, p_due_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests; plan private.plan_versions; made private.customer_invoices;
begin
  actor := internal.staff_actor('payments:refund');
  if p_due_days is null or p_due_days not between 1 and 30 then
    raise exception 'days to pay required (1 to 30)' using errcode='22023', detail='invoice_issue_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:refund');
  -- The same staff member repeating the same step gets the first answer.
  if r.status in ('awaiting_approval', 'issued') and r.prepared_by = actor and r.due_days = p_due_days
      and r.staff_reason = btrim(p_reason) then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
      (select internal.customer_invoice_dto(i, actor) from private.customer_invoices i where i.id = r.invoice_id),
      'repeated', true);
  end if;
  if r.status <> 'requested' then
    raise exception 'this invoice request is already %', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  plan := internal.package_invoice_issue_check(r);
  if r.total_cents > internal.package_invoice_approval_above_cents() then
    -- Above R50,000 a second staff member approves it first; no number yet.
    update private.package_invoice_requests set status = 'awaiting_approval', prepared_by = actor,
        prepared_at = statement_timestamp(), due_days = p_due_days, staff_reason = btrim(p_reason)
      where id = r.id returning * into r;
  else
    made := internal.issue_package_customer_invoice(r, plan, actor, p_due_days, btrim(p_reason));
    update private.package_invoice_requests set status = 'issued', prepared_by = actor,
        prepared_at = statement_timestamp(), due_days = p_due_days, staff_reason = btrim(p_reason), invoice_id = made.id
      where id = r.id returning * into r;
  end if;
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(actor, r.account_id);
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
    case when made.id is null then null else internal.customer_invoice_dto(made, actor) end, 'repeated', false);
end;
$function$;
alter function internal.issue_staff_package_invoice(uuid,integer,text) owner to postgres;
revoke all on function internal.issue_staff_package_invoice(uuid,integer,text) from public;
grant execute on function internal.issue_staff_package_invoice(uuid,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION api.issue_staff_package_invoice(p_request_id uuid, p_due_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.issue_staff_package_invoice(p_request_id, p_due_days, p_reason);
$function$;
alter function api.issue_staff_package_invoice(uuid,integer,text) owner to postgres;
revoke all on function api.issue_staff_package_invoice(uuid,integer,text) from public;
grant execute on function api.issue_staff_package_invoice(uuid,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.approve_staff_package_invoice(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests; plan private.plan_versions; made private.customer_invoices;
begin
  actor := internal.staff_actor('payments:confirm_transfer');
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:confirm_transfer');
  if r.status = 'issued' and r.approved_by = actor then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
      (select internal.customer_invoice_dto(i, actor) from private.customer_invoices i where i.id = r.invoice_id),
      'repeated', true);
  end if;
  if r.status <> 'awaiting_approval' then
    raise exception 'this invoice request is %; only a prepared invoice above R50,000 is approved', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  -- Two people: never the staff member who prepared it (or another account of
  -- their identity), who must still hold the authority to issue invoices and
  -- must not have come to refer the customer.
  if internal.same_identity(actor, r.prepared_by) then
    raise exception 'a different staff member must approve this invoice' using errcode='42501', detail='invoice_approver_same';
  end if;
  if not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role = s.role
      where s.user_id = r.prepared_by and s.revoked_at is null and c.capability = 'payments:refund')
    or not exists(select 1 from private.current_account_access a where a.id = r.prepared_by) then
    raise exception 'the staff member who prepared this invoice can no longer issue invoices; decline it'
      using errcode='PT409', detail='invoice_preparer_inactive';
  end if;
  -- ...and must still have a current accepted ID review of their own and
  -- never be the customer's identity.
  if internal.current_verified_identity(r.prepared_by) is null
      or internal.same_identity(r.prepared_by, r.account_id) then
    raise exception 'the staff member who prepared this invoice can no longer issue invoices; decline it'
      using errcode='PT409', detail='invoice_preparer_inactive';
  end if;
  perform internal.assert_staff_not_referrer(r.prepared_by, r.account_id);
  plan := internal.package_invoice_issue_check(r);
  made := internal.issue_package_customer_invoice(r, plan, r.prepared_by, r.due_days, r.staff_reason);
  update private.package_invoice_requests set status = 'issued', approved_by = actor, approved_at = statement_timestamp(),
      invoice_id = made.id
    where id = r.id returning * into r;
  if internal.staff_actor('payments:confirm_transfer') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(actor, r.account_id);
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('invoice',
    internal.customer_invoice_dto(made, actor), 'repeated', false);
end;
$function$;
alter function internal.approve_staff_package_invoice(uuid) owner to postgres;
revoke all on function internal.approve_staff_package_invoice(uuid) from public;
grant execute on function internal.approve_staff_package_invoice(uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.approve_staff_package_invoice(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_staff_package_invoice(p_request_id);
$function$;
alter function api.approve_staff_package_invoice(uuid) owner to postgres;
revoke all on function api.approve_staff_package_invoice(uuid) from public;
grant execute on function api.approve_staff_package_invoice(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.decline_staff_package_invoice_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; r private.package_invoice_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  r := internal.lock_package_invoice_request(p_request_id, actor, 'payments:refund');
  if r.status = 'declined' and r.closed_by = actor and r.close_reason = btrim(p_reason) then
    return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('repeated', true);
  end if;
  if r.status not in ('requested', 'awaiting_approval') then
    raise exception 'this invoice request is already %', replace(r.status, '_', ' ')
      using errcode='PT409', detail='package_invoice_request_closed';
  end if;
  update private.package_invoice_requests set status = 'declined', closed_by = actor, closed_at = statement_timestamp(),
      close_reason = btrim(p_reason)
    where id = r.id returning * into r;
  if internal.staff_actor('payments:refund') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return internal.package_invoice_request_dto(r, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.decline_staff_package_invoice_request(uuid,text) owner to postgres;
revoke all on function internal.decline_staff_package_invoice_request(uuid,text) from public;
grant execute on function internal.decline_staff_package_invoice_request(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.decline_staff_package_invoice_request(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.decline_staff_package_invoice_request(p_request_id, p_reason);
$function$;
alter function api.decline_staff_package_invoice_request(uuid,text) owner to postgres;
revoke all on function api.decline_staff_package_invoice_request(uuid,text) from public;
grant execute on function api.decline_staff_package_invoice_request(uuid,text) to authenticated;

-- 5. Package invoices are paid like Individual ones, as a package (full bodies).
CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent(); is_package boolean;
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
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice: the
  -- term must still be sold at the invoice's price.
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id and v.retired_at is null
    and ((v.is_public and internal.individual_slot_plan(v.plan_code)) or internal.slot_package_plan(v.plan_code))
    and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice can no longer be paid online; ask for a new one'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  is_package := internal.slot_package_plan(plan.plan_code);
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you pay' using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if is_package then
    -- A package is sold only while packages are on sale, and to an account
    -- with no package that has not ended (as the package checkout); this
    -- account, then its package, as the package checkout locks them.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
    if internal.slot_package_open(actor) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
  else
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
  end if;
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
    if is_package then
      -- Another package payment open (any term: one package order at a time,
      -- as the package checkout keeps it).
      for other in select p.* from private.payments p join private.plan_versions v on v.id = p.plan_version_id
          where p.owner_id = actor and p.status = 'pending' and p.target_post_id is null
            and internal.slot_package_plan(v.plan_code)
          order by p.created_at, p.id
          for update of p loop
        if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
          raise exception 'finish or cancel your other open package payment first'
            using errcode='PT409', detail='invoice_checkout_open';
        end if;
        -- Never sent to Ozow, so it can never be paid: closed.
        update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
          where id = other.id;
      end loop;
    else
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
  end if;
  -- A package is not counted in the Individual slot limit.
  if not is_package then
    counted := internal.individual_slots_counted(fingerprint, actor, latest.id);
    if (counted->>'held')::integer + (counted->>'pending')::integer + inv.slots > internal.individual_slot_limit(fingerprint) then
      raise exception 'you can hold at most % Individual slots at a time', internal.individual_slot_limit(fingerprint)
        using errcode='PT429', detail='slot_limit_reached';
    end if;
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
  if is_package then
    -- One payment line holding every slot of the package (as the package
    -- checkout), so the Ozow notice delivers it as a package.
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
      values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
          'category', 'slot_package', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
          'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
          'duration_days', plan.duration_days, 'slot_capacity', inv.slots,
          'activations_per_period', plan.activations_per_period * inv.slots,
          'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities', to_jsonb(plan.addon_capabilities),
          'invoice_description', inv.description,
          'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
          'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
            'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton))),
        case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
      returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, slot_count)
      values (pay.id, 1, plan.id, inv.total_cents, inv.slots);
  else
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
  end if;
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
      -- One line per Individual slot at its price, or (a Multi-listing
      -- package, 20261119025106) one line holding every slot at the total.
      or (case when exists(select 1 from private.plan_versions v where v.id = inv.plan_version_id
            and internal.slot_package_plan(v.plan_code))
          then (select count(*) from private.payment_lines l where l.payment_id = pay.id) <> 1
            or not exists(select 1 from private.payment_lines l where l.payment_id = pay.id
              and l.amount_cents = inv.total_cents and l.slot_count = inv.slots)
          else (select count(*) from private.payment_lines l where l.payment_id = pay.id
            and l.amount_cents = inv.unit_price_cents) <> inv.slots end)
      or new.attempt <> 1 + (select count(*) from private.customer_invoice_payments x where x.invoice_id = inv.id) then
    raise exception 'an invoice payment attempt is a new Ozow payment of that invoice' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.customer_invoice_payment_guard() owner to postgres;
revoke all on function internal.customer_invoice_payment_guard() from public;

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
  -- 20261118044440_bank_transfer_expiry.sql: a waiting record of this bank
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
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice.
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and (internal.individual_slot_plan(v.plan_code) or internal.slot_package_plan(v.plan_code))
    and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice''s slot is no longer sold at its price' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(inv.account_id);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before slots are recorded'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if internal.slot_package_plan(plan.plan_code) then
    -- An early check of the package rules; confirmation checks them again.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.slot_package_open(inv.account_id) then
      raise exception 'the customer already has a Multi-listing package; void this invoice'
        using errcode='PT409', detail='package_active';
    end if;
  else
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

CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint; inv private.customer_invoices;
  is_package boolean;
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
  -- One rule (20261118044440_bank_transfer_expiry.sql): a transfer that has
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
  -- ...and must still have a current accepted ID review of their own and
  -- never be the customer's identity (20261119025106).
  if internal.current_verified_identity(t.recorded_by) is null
      or internal.same_identity(t.recorded_by, t.account_id) then
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
  -- A Multi-listing package (P4e) is paid by bank transfer only against its
  -- invoice (record_staff_invoice_payment records Individual slots only).
  is_package := internal.slot_package_plan(plan.plan_code) and t.customer_invoice_id is not null;
  if is_package then
    -- One package per account at a time, only while packages are on sale (as
    -- an Ozow payment of a package is delivered).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||t.account_id::text, 707));
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale; decline this transfer and return the money'
        using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.slot_package_open(t.account_id) then
      raise exception 'the customer already has a Multi-listing package; decline this transfer and return the money'
        using errcode='PT409', detail='package_active';
    end if;
    -- Another package payment of the account open at Ozow (not one of this
    -- invoice's attempts, checked below) could still be paid and would then
    -- go to reconciliation: it is finished or cancelled first.
    if exists(select 1 from private.payments p join private.plan_versions v on v.id = p.plan_version_id
        where p.owner_id = t.account_id and p.status = 'pending' and p.target_post_id is null
          and internal.slot_package_plan(v.plan_code)
          and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp())
          and not exists(select 1 from private.customer_invoice_payments l
            where l.payment_id = p.id and l.invoice_id = t.customer_invoice_id)) then
      raise exception 'the customer has another package payment open at Ozow; try again when it has closed'
        using errcode='PT409', detail='invoice_checkout_open';
    end if;
    if plan.price_cents * t.slots <> t.amount_received_cents then
      raise exception 'the recorded amount is not the order total' using errcode='PT428', detail='invoice_amount_mismatch';
    end if;
  else
    -- E3 (20261114154823): while the person's Multi-listing package runs (until
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
    if internal.slot_package_blocks_individual(fingerprint, t.account_id) then
      raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
        using errcode='PT409', detail='package_active';
    end if;
    if plan.price_cents * t.slots <> t.amount_received_cents or not internal.individual_slot_plan(plan.plan_code) then
      raise exception 'the recorded amount is not the order total' using errcode='PT428', detail='invoice_amount_mismatch';
    end if;
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
  if is_package then
    -- One payment line holding every slot; its grant opens the package
    -- (internal.issue_slot_line_entitlements), exactly as a package paid
    -- through Ozow.
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, provider,
        status, fulfillment_status, completed_at, status_changed_at)
      values (t.account_id, 'plan', plan.id, t.amount_received_cents, plan.currency, jsonb_build_object('kind', 'plan',
          'category', 'slot_package', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label,
          'area', plan.area, 'price_cents', plan.price_cents, 'slots', t.slots, 'total_cents', t.amount_received_cents,
          'duration_days', plan.duration_days, 'slot_capacity', t.slots,
          'activations_per_period', plan.activations_per_period * t.slots,
          'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities', to_jsonb(plan.addon_capabilities),
          'invoice_description', inv.description,
          'payment_method', 'invoice', 'invoice_transfer_id', t.id,
          'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'),
          'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number,
          'cooling_off_consent', jsonb_build_object('method', 'written', 'recorded_by_staff_at', t.recorded_at,
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
            'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately')),
        'invoice', 'complete', 'fulfilled', statement_timestamp(), statement_timestamp())
      returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, slot_count)
      values (pay.id, 1, plan.id, t.amount_received_cents, t.slots);
    perform internal.issue_slot_line_entitlements(pay.id);
    made := t.slots;
  else
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
  end if;
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

CREATE OR REPLACE FUNCTION internal.start_package_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  pay private.payments;
  fingerprint text;
  total bigint;
  open_slots integer;
begin
  if p_plan_id is null or p_slots is null or p_expected_total_cents is null then
    raise exception 'package term, number of slots and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v
    where v.id=p_plan_id and v.retired_at is null and internal.slot_package_plan(v.plan_code);
  if not found then raise exception 'this package term is not on sale' using errcode='22023'; end if;
  -- Typed: a whole number of slots, at least 5 (1 to 4 are Individual slots),
  -- at most 250 per business; more than 100 is bought by invoice.
  if p_slots < 5 or p_slots > 250 then
    raise exception 'a package has 5 to 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
  end if;
  total := plan.price_cents * p_slots;
  -- More than 100 slots, or above the most Ozow accepts in one payment
  -- (internal.online_payment_max_cents, the one setting): by invoice.
  if p_slots > 100 or total > internal.online_payment_max_cents() then
    raise exception 'packages above 100 slots or the online payment limit of % cents are paid by invoice',
      internal.online_payment_max_cents() using errcode='PT413',
      detail='package_invoice_required';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  if internal.slot_package_open(actor) then
    raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
  end if;
  -- 20261119025106: while a package invoice of the account is unpaid, it is
  -- paid (or cancelled) first, so no second package is bought beside it.
  if exists(select 1 from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
      where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)) then
    raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  select p.* into pay from private.payments p join private.plan_versions v on v.id=p.plan_version_id
    where p.owner_id=actor and p.status='pending' and p.target_post_id is null and internal.slot_package_plan(v.plan_code)
    order by p.created_at desc, p.id limit 1
    for update of p;
  if found then
    select l.slot_count into open_slots from private.payment_lines l where l.payment_id=pay.id and l.line_number=1;
    if pay.plan_version_id <> plan.id or open_slots is distinct from p_slots then
      if pay.checkout_url is not null then
        -- Open at Ozow for another package order: the member continues,
        -- checks or cancels it first.
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
          'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
          'slots', open_slots, 'package', true, 'reused', true);
      elsif pay.checkout_claim_until > clock_timestamp() then
        raise exception 'checkout is being created' using errcode='PT409';
      end if;
      -- Never sent to Ozow, so it can never be paid: replaced.
      update private.payments set status='cancelled', status_changed_at=clock_timestamp() where id=pay.id;
      pay := null;
    end if;
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan', 'category', 'slot_package',
        'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', p_slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', p_slots,
        'activations_per_period', plan.activations_per_period * p_slots,
        'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', 'Multi-listing package: ' || p_slots::text || ' slots × ' || plan.duration_days::text || ' days',
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording_version', 'package-starts-now-v1',
          'wording', 'My slots start now; the 7-day cooling-off does not apply because the service starts immediately')))
    returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, slot_count)
      values (pay.id, 1, plan.id, total, p_slots);
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', p_slots, 'package', true, 'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_package_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_package_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function internal.start_package_checkout(uuid,integer,bigint,boolean) to authenticated;

-- 6. The privacy export lists package invoice requests; closure withdraws an
-- open request, erasure unlinks them and retention removes them (full bodies).
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
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
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

CREATE OR REPLACE FUNCTION internal.close_account_evidence(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a
    set retain_until = least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after)
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after);
  get diagnostics scheduled = row_count;
  -- DEC-27: detach the trial fingerprint and keep it 3 years after closure.
  update private.trial_identities set owner_id = null, entitlement_id = null,
    detached_at = closure.closed_at, retain_until = closure.closed_at + interval '3 years'
  where owner_id = p_user_id;
  get diagnostics trial_fingerprints = row_count;
  -- 20261119025106: an open package invoice request is withdrawn, so it leaves
  -- the staff queue and no invoice is issued to a closed account.
  update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
    where account_id = p_user_id and status in ('requested', 'awaiting_approval');
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end;
$function$;
alter function internal.close_account_evidence(uuid) owner to postgres;
revoke all on function internal.close_account_evidence(uuid) from public;
grant execute on function internal.close_account_evidence(uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.erase_closed_account(p_user uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; reason text; earlier_retention text; counts jsonb := '{}'::jsonb; n integer;
begin
  if p_user is null or p_by is null or p_by not in ('staff', 'sweep') then
    raise exception 'account and erasing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if not found then raise exception 'account is not closed' using errcode = 'PT404', detail = 'account_not_closed'; end if;
  if er.erased_at is not null or er.erase_after > statement_timestamp() then
    return internal.account_erasure_state(p_user);
  end if;
  reason := internal.account_erasure_hold(p_user);
  if reason is not null then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = reason
      where user_id = p_user;
    return internal.account_erasure_state(p_user);
  end if;
  earlier_retention := coalesce(pg_catalog.current_setting('vm.retention', true), '');
  perform pg_catalog.set_config('vm.retention', 'on', true);
  perform pg_catalog.set_config('vm.erasure', p_user::text, true);

  select count(*) into n from private.enquiries q where q.owner_id = p_user or q.sender_account_id = p_user;
  counts := counts || jsonb_build_object('enquiries', n);
  -- Enquiries the account sent, with the other owner's notice and email.
  with gone as (
    delete from private.enquiries q where q.sender_account_id = p_user returning q.id
  ), notices as (
    delete from private.notifications x using gone where x.kind = 'enquiry_received' and x.subject_id = gone.id
  )
  delete from private.outbox_events o using gone where o.kind = 'enquiry_received' and o.subject_id = gone.id;
  -- Sponsored places first: deleting a place returns its grant.
  delete from private.organisation_sponsorships s where s.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sponsored_places', n);
  -- Posts, with their edit copies, contacts, media links, search documents,
  -- received enquiries and everything else that belongs to a post.
  delete from private.posts p where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('posts', n);
  delete from private.event_submissions e where e.owner_id = p_user;
  delete from private.enquiries q where q.owner_id = p_user;
  delete from private.notifications x where x.account_id = p_user;
  delete from private.outbox_events o where o.owner_id = p_user;
  delete from private.profiles x where x.account_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profile', n);
  delete from private.frontend_form_drafts d where d.owner_id = p_user;
  delete from private.listing_price_drafts d where d.owner_id = p_user;
  delete from private.intro_trial_requests t where t.owner_id = p_user;
  delete from private.frontend_business_checks b where b.owner_id = p_user;
  delete from private.organisation_admins a where a.account_id = p_user;
  delete from private.organisation_applications a where a.applicant_id = p_user;
  delete from private.entitlement_members m where m.member_id = p_user or m.added_by = p_user
    or m.entitlement_id in (select e.id from private.entitlements e where e.owner_id = p_user);
  delete from private.frontend_post_commands c where c.owner_id = p_user;
  delete from private.frontend_post_action_receipts r where r.owner_id = p_user;
  delete from private.account_acquisitions a where a.account_id = p_user;
  delete from private.communication_choice_events c where c.account_id = p_user;
  delete from private.signup_terms_acceptances a where a.account_id = p_user;
  delete from private.posting_terms_acceptances a where a.owner_id = p_user;
  delete from private.verification_localities l where l.owner_id = p_user;
  -- Photos and videos nothing kept still uses: queued for deletion from
  -- storage now (the media cleanup job deletes the objects).
  update private.media_objects m set state = 'cleanup_required', cleanup_lease_until = null
    where m.owner_id = p_user and m.state in ('intent', 'ready', 'rejected') and not internal.media_object_in_use(m.id);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_queued', n);

  -- Paid time ends; payment records stay for their tax years, no longer
  -- linked to the account.
  update private.entitlements e set status = 'revoked', revoked_reason = 'account_erased'
    where e.owner_id = p_user and e.status <> 'revoked';
  update private.trial_identities t set owner_id = null, entitlement_id = null,
      detached_at = er.closed_at, retain_until = er.closed_at + interval '3 years'
    where t.owner_id = p_user;
  update private.post_activations a set owner_id = null where a.owner_id = p_user;
  update private.entitlements e set owner_id = null where e.owner_id = p_user;
  update private.payments p set owner_id = null where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payments_unlinked', n);
  update private.customer_invoices i set account_id = null where i.account_id = p_user;
  update private.invoice_transfers t set account_id = null where t.account_id = p_user;
  update private.payment_refund_requests r set account_id = null where r.account_id = p_user;
  update private.partner_commissions c set referred_account_id = null where c.referred_account_id = p_user;
  update private.individual_slot_limits l set account_id = null where l.account_id = p_user;
  update private.slot_packages k set owner_id = null where k.owner_id = p_user;
  -- Package invoice requests (20261119025106): an open one is withdrawn (it
  -- leaves the staff queue), then every one is kept unlinked like its invoice.
  update private.package_invoice_requests r set status = 'withdrawn', closed_at = statement_timestamp()
    where r.account_id = p_user and r.status in ('requested', 'awaiting_approval');
  update private.package_invoice_requests r set account_id = null where r.account_id = p_user;

  perform internal.remove_account_sign_in(p_user);
  perform pg_catalog.set_config('vm.erasure', '', true);
  perform pg_catalog.set_config('vm.retention', earlier_retention, true);
  update private.account_erasures set erased_at = statement_timestamp(), erased_by = p_by, erased_counts = counts,
      blocked_at = null, blocked_reason = null, auth_checked_at = statement_timestamp()
    where user_id = p_user;
  -- Deleting the Auth user never undoes the finished erasure: a failure is
  -- recorded and the daily check tries again.
  begin
    if internal.remove_erased_auth_user(p_user) then
      update private.account_erasures set auth_removed_at = statement_timestamp() where user_id = p_user;
    end if;
  exception when others then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
        blocked_detail = sqlstate
      where user_id = p_user;
  end;
  return internal.account_erasure_state(p_user);
end;
$function$;
alter function internal.erase_closed_account(uuid,text) owner to postgres;
revoke all on function internal.erase_closed_account(uuid,text) from public;

CREATE OR REPLACE FUNCTION internal.retention_commerce(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer; customer_invoices integer; bank_transfers integer; slot_packages integer;
  package_invoice_requests integer;
begin
  -- Package invoice requests (20261119025106) declined or withdrawn: five tax
  -- years after they closed, as declined bank transfers. An issued one goes
  -- with its invoice (below).
  delete from private.package_invoice_requests where id in(select r.id from private.package_invoice_requests r
    where r.status in('declined','withdrawn') and internal.retention_tax_year_due(r.closed_at)
    order by r.closed_at limit p_limit);
  get diagnostics package_invoice_requests=row_count;
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
    'bank_transfers',bank_transfers,'slot_packages',slot_packages,
    'package_invoice_requests',package_invoice_requests);
end;
$function$;
alter function internal.retention_commerce(integer) owner to postgres;
revoke all on function internal.retention_commerce(integer) from public;

-- The replaced functions keep their grants; the helpers have none; the new
-- commands are for signed-in members and staff only.
do $$
declare f text;
begin
  foreach f in array array['internal.package_invoice_request_guard()', 'internal.package_invoice_approval_above_cents()',
      'internal.package_invoice_request_dto(private.package_invoice_requests,uuid)',
      'internal.package_invoice_issue_check(private.package_invoice_requests)',
      'internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)',
      'internal.lock_package_invoice_request(uuid,uuid,text)', 'internal.frontend_privacy_export_data(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
        or has_function_privilege('service_role', f, 'execute') then
      raise exception 'package invoices: unexpected grants on %', f;
    end if;
  end loop;
  foreach f in array array['api.request_package_invoice(uuid,integer,bigint,boolean,uuid)',
      'api.get_my_package_invoice_request()', 'api.get_staff_package_invoice_requests()',
      'api.issue_staff_package_invoice(uuid,integer,text)', 'api.approve_staff_package_invoice(uuid)',
      'api.decline_staff_package_invoice_request(uuid,text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
        or not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'package invoices: unexpected grants on %', f;
    end if;
  end loop;
end$$;

notify pgrst,'reload schema';
commit;
