-- Close and erase an account (roadmap M1.6b; owner decision OD-10 of the
-- engineering review: close at once; delete the profile, posts, enquiries and
-- media after 30 days; keep payment records for 5 years, no longer linked to
-- the person; keep the identity-ban fingerprint as the privacy notice says).
-- Nothing calls the new commands yet: the "Delete account" button and the
-- staff privacy screen move to them in M1.6c.
--
-- Apply after 20261114154823_slot_packages.sql (it refuses with 55000
-- unless the bodies it builds on or replaces are the reviewed ones). Only
-- adds: no API command, argument or grant is removed or changed. In one
-- transaction it:
--
-- 1. Lets kept payment records lose their person. The person's column becomes
--    nullable in private.payments (owner_id), private.customer_invoices,
--    private.invoice_transfers and private.payment_refund_requests
--    (account_id), private.entitlements and private.post_activations
--    (owner_id), private.partner_commissions (referred_account_id),
--    private.individual_slot_limits (account_id) and private.slot_packages
--    (owner_id, a Multi-listing package). The record guards of these
--    tables (internal.payment_quote_guard, internal.customer_invoice_guard,
--    internal.invoice_transfer_guard, internal.payment_refund_request_guard,
--    internal.partner_commission_guard, internal.individual_slot_limit_guard,
--    internal.slot_package_guard, full bodies) allow exactly one more change: that column going from the
--    erased account to null while the erasure runs (transaction setting
--    vm.erasure = that account, internal.erasure_unlinks); every other column
--    still never changes.
-- 2. New table private.account_erasures: one row per closed account (no
--    foreign key, so it outlives the Auth user) with when it was closed and by
--    whom (member or staff), when it may be erased (30 days later, a check),
--    the end of the paid time it still had (for a cancellation credit under
--    the refund policy), when it was erased and what was erased (counts
--    only), when the Auth user was removed, and why an erasure is waiting.
--    private.account_erasure_requests links deletion privacy requests to it.
-- 3. New member command api.close_my_account(): the caller's own account,
--    with a live session and a sign-in in the last 15 minutes (42501
--    recent_sign_in_required), never a staff account (42501 staff_account).
--    It closes at once: the existing closure record (internal.
--    close_account_evidence: posts leave every public read through
--    private.current_account_access, identity facts and phone proofs are
--    revoked, open identity and business cases close, evidence files are
--    scheduled, the trial fingerprint is detached), sign-in blocked (Auth ban)
--    and every session and refresh token ended (refused if either fails), a
--    partner record suspended (with a partner event),
--    the erasure scheduled 30 days on, and a deletion privacy request recorded
--    for staff (identity checked by the session, due 7 days after the grace
--    period ends) with its "received" notice.
-- 4. New staff command api.fulfil_account_deletion(p_request, p_revision):
--    privacy capability with a recent authenticator code. It calls
--    internal.order_account_erasure (also run by the runbook's owner SQL
--    session until the staff screen exists; no API role may call it): a
--    deletion request in progress, a staff member with the privacy role who is
--    not the requester and did not verify the identity (42501
--    second_person_required), never a staff account (PT409 staff_account);
--    closes the account the same way when it is still open, links the
--    request, records the order on it (event erasure_ordered; a rejection is
--    superseded), sets its
--    deadline to 7 days after the grace period, and erases at once when the 30
--    days have passed. New staff read api.get_account_erasure(p_request).
-- 5. Erasure (internal.erase_closed_account), 30 days after closure, by the
--    staff command or the retention sweep. It waits, and records why, while a
--    legal hold, open fraud hold, unreleased staff content hold, open report
--    about the person or their posts, staff role, rejected deletion request,
--    pending payment, paid order still to be delivered, open refund, bank
--    transfer waiting for confirmation, unpaid invoice or unpaid commission
--    owed to the person as a partner applies. It deletes the account's posts
--    (with their edit copies, contacts, media links, search documents and
--    received enquiries), sponsored places, event submissions, enquiries it
--    sent (and their notices), notifications, profile, drafts, organisation
--    roles and applications, team memberships, post commands and receipts, the
--    acquisition record, consent and terms records, home area and queued
--    emails; queues every photo and video it uploaded that nothing kept still
--    uses for deletion from storage (the existing media cleanup); ends its
--    paid time (grants revoked) and unlinks every kept payment record;
--    removes the sign-in (sessions, refresh tokens, authenticator factors,
--    linked sign-in providers, one-time tokens, sign-in flows, Auth audit
--    entries in one bounded batch; the Auth row keeps only its id and dates).
--    The Auth user itself is deleted as soon as nothing kept names it any more
--    (internal.remove_erased_auth_user; a record the policy keeps, such as the
--    verification history, an identity ban, a report, a released legal hold or
--    a partner record, keeps the empty row until its own retention ends); a
--    failure there is recorded and never undoes the erasure. The identity-ban
--    fingerprint and the trial fingerprint stay under their own periods.
--    Replays return the recorded state.
-- 6. Kept records stay usable without their person. Staff refunds,
--    chargebacks, approvals, Ozow refund sends and status notices, slot
--    reversals and invoice voids (internal.record_staff_payment_refund,
--    record_staff_slot_refund, record_staff_slot_reversal,
--    record_staff_ozow_refund, approve_staff_payment_refund,
--    close_staff_ozow_refund, record_ozow_refund_send,
--    apply_ozow_refund_status, void_staff_invoice, full bodies) tell "not
--    found" apart from "no account" and lock a record with no account by its
--    own id (internal.lock_kept_record_subject); a partner commission is still
--    reversed with its payment; a refund or chargeback of a payment with no
--    account always waits for a second staff member. A payment email for
--    nobody (outbox owner_id null and a payment_* kind, for example a late
--    Ozow payment of an erased account) is not queued (trigger
--    outbox_events_unlinked), so that notice still succeeds on every retry.
-- 7. internal.process_frontend_privacy_request (full body): rejecting a
--    deletion request linked to an account not yet erased (under the account
--    lock; PT409 account_erased once it was erased) records the
--    rejection on the erasure and places a legal hold for review in 12 months
--    (internal.reject_account_erasure). A deletion
--    request linked to an account is completed only after that account was
--    erased (PT409 erasure_pending), and one naming an account only after the
--    erasure was ordered (PT409 erasure_required).
--    internal.claim_frontend_privacy_notice (full body) sends the notices of a
--    request linked to an erasure to the address stored with the request,
--    and never those of a minimised request.
-- 8. internal.run_retention (full body) also runs
--    internal.run_account_erasures (due erasures and the daily Auth user
--    check, each account on its own with its error code recorded, so one
--    account never stops the job; erasure records deleted 5 years after the
--    erasure once the Auth user is gone; the number of failed erasures, which
--    the retention job reports as an alert) and
--    internal.retention_privacy_requests (closed privacy requests minimised
--    once their last notice was sent or 30 days after they closed: the
--    address replaced by the marker 'removed', phone and description
--    cleared; deleted 5 years after they closed, never while linked to an
--    erasure that has not run; provisional periods, the lawyer confirms).
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed). Earlier releases do not call the new commands
-- and keep working with it applied.
-- Read-only preflight: ../preflight/20261116175757_close_and_erase_account.check.sql.
-- Rollback: ../rollback/20261116175757_close_and_erase_account.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces have the earlier reviewed
-- bodies or this update's, and the functions it builds on are the reviewed ones.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.payment_quote_guard()'),
      ('internal.customer_invoice_guard()'),
      ('internal.invoice_transfer_guard()'),
      ('internal.payment_refund_request_guard()'),
      ('internal.partner_commission_guard()'),
      ('internal.individual_slot_limit_guard()'),
      ('internal.slot_package_guard()'),
      ('internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text)'),
      ('internal.run_retention(integer)'),
      ('internal.claim_frontend_privacy_notice()'),
      ('internal.record_staff_payment_refund(uuid,text,text,text,text)'),
      ('internal.record_staff_slot_refund(uuid,text,text,text,text)'),
      ('internal.record_staff_slot_reversal(uuid,text,text)'),
      ('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)'),
      ('internal.approve_staff_payment_refund(uuid)'),
      ('internal.close_staff_ozow_refund(uuid,text)'),
      ('internal.record_ozow_refund_send(uuid,jsonb)'),
      ('internal.apply_ozow_refund_status(jsonb)'),
      ('internal.void_staff_invoice(uuid,text)')) v(sig)
  loop
    if shape not in (
        'internal.payment_quote_guard() 1042ebb47721d807667a17be53ae2559',
        'internal.payment_quote_guard() b5242871b1e3571ce604466a8e514f5f',
        'internal.customer_invoice_guard() 9ddce773843024268a0e6f8421036995',
        'internal.customer_invoice_guard() 26e0cb1b12908994f379d2d7d10e91ec',
        'internal.invoice_transfer_guard() 1a73d1dd9054c76a3f52fa415fe7a318',
        'internal.invoice_transfer_guard() 494dcdb720573571dd36edf97b055332',
        'internal.payment_refund_request_guard() c220af13b94b20251d36a33fe643e427',
        'internal.payment_refund_request_guard() 08e1cff16910b59c8d305a1eae7f7b56',
        'internal.partner_commission_guard() ddab4845789fef80739183deeaf75e4d',
        'internal.partner_commission_guard() a856ad39d36572068cf94647e3611eb1',
        'internal.individual_slot_limit_guard() 1af83fc4a5bd4555a8b99412f8acc5f1',
        'internal.individual_slot_limit_guard() 556e2de64a5eb7ca998744fa0abb5c84',
        'internal.slot_package_guard() be264c746997a4b200c3db5ab0a04fca',
        'internal.slot_package_guard() d249a568a592474a5b94085b0b55457d',
        'internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) e74105108b0992a251828ce6a4fcce54',
        'internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) 989e334ff4fecc3ce76132277e2ea13c',
        'internal.run_retention(integer) e3f911342d4f9482b9e91d8f53bdfa1c',
        'internal.run_retention(integer) 3fc3981961fda5c149c6540e03a5b4c3',
        'internal.claim_frontend_privacy_notice() 4ad5b24618c62302e3e7a8b6fca975d6',
        'internal.claim_frontend_privacy_notice() ab583eeac94d2d46cee6344b5e0d6ef6',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) 49d728545decec524a1a7dd6e09639e1',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) 2ba50b5b15c6259c1b2c6369d3473e90',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) cbea96f3d2df4f3255c565790df97fed',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) 193a2b3abdbc83b0b16d81d759dc168e',
        'internal.record_staff_slot_reversal(uuid,text,text) 1364f8c78e36281bae5f16a4ba5a466c',
        'internal.record_staff_slot_reversal(uuid,text,text) bea17a08481589403105719076fcdb6d',
        'internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) 90fd7db662d18b89fdce0e395f92ea0c',
        'internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) b47de2156d93ce9ee6a48bcb6d206adc',
        'internal.approve_staff_payment_refund(uuid) df4585dd0d0c12f4fbf2e76d9e70a553',
        'internal.approve_staff_payment_refund(uuid) 6c7090e7cb1fee5fffd3c3495e76e2ab',
        'internal.close_staff_ozow_refund(uuid,text) 5b7a8a8d3f7bd430e0024fb2088338c3',
        'internal.close_staff_ozow_refund(uuid,text) 9e181ea364774709d7b26cdd5ea7418c',
        'internal.record_ozow_refund_send(uuid,jsonb) 9e3bafab54e36843cc570cf196e9babf',
        'internal.record_ozow_refund_send(uuid,jsonb) f59b72e6c3b8c30bcdf4bec429dd4988',
        'internal.apply_ozow_refund_status(jsonb) 22b002f9363cae60fd6b40635590a3a9',
        'internal.apply_ozow_refund_status(jsonb) 91430e1a9e30562a65a827e0ecab3a7c',
        'internal.void_staff_invoice(uuid,text) 83525ee269432148a58b2921bc138d06',
        'internal.void_staff_invoice(uuid,text) 21763bcb62e398b6d1b8e8d64ef38ea5') then
      raise exception 'account erasure precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.close_account_evidence(uuid)'),
      ('internal.lock_evidence_subject(uuid)'),
      ('internal.staff_actor(text)'),
      ('internal.media_object_in_use(uuid)'),
      ('internal.release_sponsorship_entitlement(uuid)')) v(sig)
  loop
    if shape not in (
        'internal.close_account_evidence(uuid) 0300a2d267a77b797d7316a4cdf43e75',
        'internal.lock_evidence_subject(uuid) 3ef77cf81542607c0ba91f6687255f01',
        'internal.staff_actor(text) 269f0871f156f57c029cedcab72f6c3f',
        'internal.media_object_in_use(uuid) c27f5d31c8a98d7b71d51fff22e04766',
        'internal.release_sponsorship_entitlement(uuid) 22d1448929ddae6b57c5bc6f859a5ce2') then
      raise exception 'account erasure precondition: % is not the reviewed body this update builds on', shape
        using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.account_closures') is null or to_regclass('private.privacy_requests') is null
      or to_regclass('private.individual_slot_limits') is null or to_regclass('private.invoice_transfers') is null
      or to_regclass('private.slot_packages') is null then
    raise exception 'account erasure precondition: apply the earlier updates first (20261114154823_slot_packages.sql included)' using errcode='55000';
  end if;
end$$;

-- 1. Kept payment records can lose their person.
alter table private.payments alter column owner_id drop not null;
alter table private.customer_invoices alter column account_id drop not null;
alter table private.invoice_transfers alter column account_id drop not null;
alter table private.payment_refund_requests alter column account_id drop not null;
alter table private.entitlements alter column owner_id drop not null;
alter table private.post_activations alter column owner_id drop not null;
alter table private.partner_commissions alter column referred_account_id drop not null;
alter table private.individual_slot_limits alter column account_id drop not null;
alter table private.slot_packages alter column owner_id drop not null;
-- A refund or chargeback of a payment with no account (erased) always waits
-- for a second staff member, whatever the amount.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_approval_rule;
alter table private.payment_refund_requests add constraint payment_refund_requests_approval_rule check (
  case when kind = 'refunded'
    then needs_approval = (recorded_before_cents + amount_cents > 100000) or (account_id is null and needs_approval)
    else not needs_approval or recorded_before_cents + amount_cents > 100000 or account_id is null end);

-- 2. Erasure records. user_id has no foreign key: the row outlives the Auth
-- user it describes, and holds no personal data besides that id.
create table if not exists private.account_erasures (
  user_id uuid primary key,
  closed_at timestamptz not null,
  erase_after timestamptz not null,
  closed_by text not null check (closed_by in ('member', 'staff')),
  paid_until timestamptz,
  erased_at timestamptz,
  erased_by text check (erased_by in ('staff', 'sweep')),
  erased_counts jsonb,
  auth_removed_at timestamptz,
  auth_checked_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text check (blocked_reason in ('legal_hold', 'fraud_hold', 'content_hold', 'report_open',
    'staff_role', 'request_rejected', 'payment_pending', 'payment_unresolved', 'refund_open', 'transfer_waiting',
    'invoice_unpaid', 'commission_unpaid', 'error')),
  blocked_detail text,
  -- Staff rejected the deletion request: the erasure never runs on its own
  -- (with a legal hold for review), even after the request record is purged.
  rejected_at timestamptz,
  constraint account_erasures_error check (blocked_detail is null
    or (blocked_reason = 'error' and blocked_detail ~ '^[0-9A-Z]{5}$')),
  constraint account_erasures_grace check (erase_after = closed_at + interval '30 days'),
  constraint account_erasures_after_grace check (erased_at is null or erased_at >= erase_after),
  constraint account_erasures_erased check ((erased_at is null) = (erased_by is null)
    and (erased_at is null) = (erased_counts is null)),
  constraint account_erasures_counts check (erased_counts is null or jsonb_typeof(erased_counts) = 'object'),
  constraint account_erasures_auth check (auth_removed_at is null or erased_at is not null),
  constraint account_erasures_blocked check ((blocked_at is null) = (blocked_reason is null))
);
alter table private.account_erasures enable row level security;
revoke all on private.account_erasures from public, anon, authenticated, service_role;
create index if not exists account_erasures_due_idx on private.account_erasures (erase_after) where erased_at is null;
create index if not exists account_erasures_auth_idx on private.account_erasures (erased_at)
  where erased_at is not null and auth_removed_at is null;

create table if not exists private.account_erasure_requests (
  request_id uuid primary key references private.privacy_requests (id) on delete cascade,
  user_id uuid not null references private.account_erasures (user_id) on delete cascade,
  linked_how text not null check (linked_how in ('member_closed', 'staff_ordered')),
  linked_by uuid references auth.users (id) on delete set null,
  linked_at timestamptz not null default statement_timestamp(),
  constraint account_erasure_requests_staff check (linked_how = 'staff_ordered' or linked_by is null)
);
alter table private.account_erasure_requests enable row level security;
revoke all on private.account_erasure_requests from public, anon, authenticated, service_role;
create index if not exists account_erasure_requests_user_idx on private.account_erasure_requests (user_id);
create index if not exists account_erasure_requests_linked_by_idx on private.account_erasure_requests (linked_by)
  where linked_by is not null;

-- A closed privacy request keeps a minimised proof: when its last notice was
-- sent (or 30 days after it closed) the address is replaced by 'removed'.
alter table private.privacy_requests add column if not exists minimised_at timestamptz;
-- Ordering an erasure is recorded on the request.
alter table private.privacy_request_events drop constraint if exists privacy_request_events_action_check;
alter table private.privacy_request_events add constraint privacy_request_events_action_check
  check (action = any (array['submitted', 'recorded', 'assigned', 'unassigned', 'extended', 'identity_verified',
    'started', 'rejected', 'completed', 'exported', 'erasure_ordered']));

-- An email for an erased account (a late payment notice, a reversal of a kept
-- payment) has nobody to go to: it is not queued, so the command that raised
-- it (a late provider notice, a staff refund) still succeeds.
create or replace function internal.outbox_skip_unlinked()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
begin
  -- Only payment notices can lose their person (a kept payment of an erased
  -- account); any other email without one is still an error.
  if new.owner_id is null and new.kind like 'payment\_%' then return null; end if;
  return new;
end;
$function$;
alter function internal.outbox_skip_unlinked() owner to postgres;
revoke all on function internal.outbox_skip_unlinked() from public, anon, authenticated, service_role;
drop trigger if exists outbox_events_unlinked on private.outbox_events;
create trigger outbox_events_unlinked before insert on private.outbox_events
  for each row execute function internal.outbox_skip_unlinked();

-- Locks the account of a kept record, or the record itself once its account
-- was erased (the record no longer names anyone).
create or replace function internal.lock_kept_record_subject(p_owner uuid, p_record uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  if p_owner is not null then
    perform internal.lock_evidence_subject(p_owner);
  elsif p_record is null then
    raise exception 'record required' using errcode = '22023';
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('erased-record:' || p_record::text, 2408));
  end if;
end;
$function$;
alter function internal.lock_kept_record_subject(uuid,uuid) owner to postgres;
revoke all on function internal.lock_kept_record_subject(uuid,uuid) from public, anon, authenticated, service_role;

-- 3. Helpers.

-- True only while an erasure runs for the account named by vm.erasure and the
-- row's only change is that account's id leaving the listed columns.
create or replace function internal.erasure_unlinks(p_old jsonb, p_new jsonb, p_columns text[])
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $function$
  select coalesce(pg_catalog.current_setting('vm.erasure', true), '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_columns is not null and cardinality(p_columns) > 0
    and (p_old - p_columns) = (p_new - p_columns)
    and not exists (select 1 from pg_catalog.unnest(p_columns) c
      where (p_new -> c) is distinct from (p_old -> c)
        and ((p_new ->> c) is not null
          or (p_old ->> c) is distinct from pg_catalog.current_setting('vm.erasure', true)))
    and exists (select 1 from pg_catalog.unnest(p_columns) c
      where (p_old ->> c) = pg_catalog.current_setting('vm.erasure', true) and (p_new ->> c) is null);
$function$;
alter function internal.erasure_unlinks(jsonb,jsonb,text[]) owner to postgres;
revoke all on function internal.erasure_unlinks(jsonb,jsonb,text[]) from public, anon, authenticated, service_role;

-- The member closing their own account: a live confirmed session that signed
-- in (any method but anonymous) in the last 15 minutes; never a staff account.
create or replace function internal.account_closing_actor()
 returns uuid
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare actor uuid := auth.uid(); claims jsonb := auth.jwt(); signed_in_at bigint;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false)
    or not exists (select 1 from auth.users u join auth.sessions s on s.user_id = u.id
      where u.id = actor and u.is_anonymous is false and u.deleted_at is null and u.email_confirmed_at is not null
        and s.id::text = claims->>'session_id' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live confirmed member session required' using errcode = '42501';
  end if;
  select max((a->>'timestamp')::bigint) into signed_in_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]'::jsonb end) a
  where jsonb_typeof(a) = 'object' and a->>'method' is not null and a->>'method' <> 'anonymous'
    and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if signed_in_at is null or signed_in_at < extract(epoch from clock_timestamp() - interval '15 minutes') then
    raise exception 'sign in again to close the account' using errcode = '42501', detail = 'recent_sign_in_required';
  end if;
  if exists (select 1 from private.staff_roles r where r.user_id = actor and r.revoked_at is null) then
    raise exception 'a staff account is closed only after its roles end' using errcode = '42501',
      detail = 'staff_account';
  end if;
  return actor;
end;
$function$;
alter function internal.account_closing_actor() owner to postgres;
revoke all on function internal.account_closing_actor() from public, anon, authenticated, service_role;

-- Why an erasure must wait, or null.
create or replace function internal.account_erasure_hold(p_user uuid)
 returns text
 language sql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
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
    when exists (select 1 from private.invoice_transfers t where t.account_id = p_user
        and t.status = 'awaiting_confirmation')
      then 'transfer_waiting'
    when exists (select 1 from private.customer_invoices i where i.account_id = p_user and i.status = 'issued')
      then 'invoice_unpaid'
    when exists (select 1 from private.partner_commissions c join private.partners x on x.id = c.partner_id
        where x.account_id = p_user and c.status in ('pending', 'approved'))
      then 'commission_unpaid'
  end;
$function$;
alter function internal.account_erasure_hold(uuid) owner to postgres;
revoke all on function internal.account_erasure_hold(uuid) from public, anon, authenticated, service_role;

-- What staff and the member see of an erasure: dates, state and counts only.
create or replace function internal.account_erasure_state(p_user uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'pg_catalog'
as $function$
  select jsonb_build_object(
    'status', case when e.auth_removed_at is not null then 'removed'
      when e.erased_at is not null then 'erased'
      when e.blocked_reason is not null then 'held'
      else 'scheduled' end,
    'closed_at', e.closed_at, 'closed_by', e.closed_by, 'erase_after', e.erase_after, 'paid_until', e.paid_until,
    'erased_at', e.erased_at, 'erased', e.erased_counts, 'auth_removed_at', e.auth_removed_at,
    'held_by', case when e.erased_at is null then e.blocked_reason end,
    'held_at', case when e.erased_at is null then e.blocked_at end,
    'error_code', e.blocked_detail)
  from private.account_erasures e where e.user_id = p_user;
$function$;
alter function internal.account_erasure_state(uuid) owner to postgres;
revoke all on function internal.account_erasure_state(uuid) from public, anon, authenticated, service_role;

-- Every session of the account ends (refresh tokens with them).
create or replace function internal.end_account_sessions(p_user uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  delete from auth.sessions s where s.user_id = p_user;
  -- Hosted Auth only: refresh tokens name the account as text.
  if pg_catalog.to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text;
  end if;
end;
$function$;
alter function internal.end_account_sessions(uuid) owner to postgres;
revoke all on function internal.end_account_sessions(uuid) from public, anon, authenticated, service_role;

-- Closes an account at once (idempotent): the closure record, sign-in
-- blocked, sessions ended, the erasure scheduled 30 days on. The caller has
-- checked who may close it.
create or replace function internal.close_account_now(p_user uuid, p_by text, p_actor uuid)
 returns private.account_erasures
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare er private.account_erasures; closed timestamptz;
begin
  if p_user is null or p_actor is null or p_by is null or p_by not in ('member', 'staff') then
    raise exception 'account and closing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if found then return er; end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'account not found' using errcode = 'PT404', detail = 'account_unavailable';
  end if;
  closed := (internal.close_account_evidence(p_user)->>'closed_at')::timestamptz;
  insert into private.account_erasures (user_id, closed_at, erase_after, closed_by, paid_until)
  values (p_user, closed, closed + interval '30 days', p_by,
    (select max(e.ends_at) from private.entitlements e where e.owner_id = p_user and e.source = 'retail_paid'
      and e.status = 'active' and e.ends_at > statement_timestamp()))
  returning * into er;
  update auth.users u set banned_until = statement_timestamp() + interval '100 years' where u.id = p_user;
  if not found then raise exception 'sign-in could not be blocked' using errcode = '55000'; end if;
  perform internal.end_account_sessions(p_user);
  if exists (select 1 from auth.sessions s where s.user_id = p_user) then
    raise exception 'sessions could not be ended' using errcode = '55000';
  end if;
  -- A partner account earns nothing more; its commission records stay.
  with suspended as (
    update private.partners x set status = 'suspended', revision = least(x.revision + 1, 2147483647),
        updated_at = statement_timestamp()
      where x.account_id = p_user and x.status <> 'suspended'
    returning x.id
  )
  insert into private.partner_events (partner_id, actor_id, action, reason)
    select suspended.id, p_actor, 'suspended_account_closed', 'The partner account was closed.' from suspended;
  return er;
end;
$function$;
alter function internal.close_account_now(uuid,text,uuid) owner to postgres;
revoke all on function internal.close_account_now(uuid,text,uuid) from public, anon, authenticated, service_role;

-- Removes the sign-in of an erased account. The Auth row keeps only its id,
-- dates and the ban until nothing kept names it.
create or replace function internal.remove_account_sign_in(p_user uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare col name;
begin
  perform internal.end_account_sessions(p_user);
  delete from auth.mfa_factors f where f.user_id = p_user;
  -- Hosted Auth only: linked sign-in providers, one-time tokens, sign-in flows.
  if pg_catalog.to_regclass('auth.identities') is not null then
    execute 'delete from auth.identities where user_id = $1' using p_user;
  end if;
  if pg_catalog.to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1' using p_user;
  end if;
  if pg_catalog.to_regclass('auth.flow_state') is not null then
    execute 'delete from auth.flow_state where user_id = $1' using p_user;
  end if;
  -- The Auth log has no index on the actor: one bounded batch, entries since
  -- the account was created only (the operations retention trims the rest).
  delete from auth.audit_log_entries a where a.id in (select x.id from auth.audit_log_entries x
    where x.created_at >= (select u.created_at - interval '1 day' from auth.users u where u.id = p_user)
      and x.payload->>'actor_id' = p_user::text
    limit 10000);
  update auth.users u set email = null, phone = null, encrypted_password = '', raw_user_meta_data = '{}'::jsonb,
      raw_app_meta_data = '{}'::jsonb, banned_until = statement_timestamp() + interval '100 years',
      deleted_at = coalesce(u.deleted_at, statement_timestamp())
    where u.id = p_user;
  -- Hosted Auth only: a pending address change and one-time codes.
  for col in
    select a.attname from pg_catalog.pg_attribute a
    where a.attrelid = 'auth.users'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
      and a.attname in ('email_change', 'phone_change', 'confirmation_token', 'recovery_token',
        'email_change_token_new', 'email_change_token_current', 'phone_change_token', 'reauthentication_token')
    order by a.attname
  loop
    execute pg_catalog.format('update auth.users set %I = %L where id = %L', col, '', p_user);
  end loop;
end;
$function$;
alter function internal.remove_account_sign_in(uuid) owner to postgres;
revoke all on function internal.remove_account_sign_in(uuid) from public, anon, authenticated, service_role;

-- Deletes the Auth user of an erased account when no kept record names it any
-- more (with its deleted media rows and closure record). A record that still
-- names it (a restricting foreign key) keeps everything as it was.
create or replace function internal.remove_erased_auth_user(p_user uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  if not exists (select 1 from private.account_erasures e where e.user_id = p_user and e.erased_at is not null) then
    raise exception 'account not erased' using errcode = 'PT409', detail = 'erasure_pending';
  end if;
  begin
    delete from private.media_objects m where m.owner_id = p_user and m.state = 'deleted';
    delete from private.account_closures c where c.user_id = p_user;
    delete from auth.users u where u.id = p_user;
    return true;
  exception when foreign_key_violation or restrict_violation or check_violation then
    -- A kept record still names the account (its foreign key, or the record
    -- guard of a table that keeps its rows).
    return false;
  end;
end;
$function$;
alter function internal.remove_erased_auth_user(uuid) owner to postgres;
revoke all on function internal.remove_erased_auth_user(uuid) from public, anon, authenticated, service_role;

-- 5. The erasure. Returns the recorded state; a replay changes nothing.
create or replace function internal.erase_closed_account(p_user uuid, p_by text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
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
revoke all on function internal.erase_closed_account(uuid,text) from public, anon, authenticated, service_role;

-- 3. The member command.
create or replace function internal.close_my_account()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare actor uuid := internal.account_closing_actor(); er private.account_erasures; rule private.privacy_request_rules;
  r private.privacy_requests; address text; now_at timestamptz;
begin
  perform internal.lock_evidence_subject(actor);
  actor := internal.account_closing_actor(); -- the session is still live after the wait
  select u.email into address from auth.users u where u.id = actor;
  if address is null or length(address) not between 3 and 254 then
    raise exception 'live confirmed member session required' using errcode = '42501';
  end if;
  er := internal.close_account_now(actor, 'member', actor);
  select * into rule from private.privacy_request_rules where request_type = 'deletion';
  now_at := clock_timestamp();
  insert into private.privacy_requests (type, subject_user_id, requester_email, description, identity_check,
    received_at, due_by, legal_basis)
  values ('deletion', actor, address,
    'Closed the account from the account page after signing in again. Erase it after the 30-day grace period.',
    'session', now_at, er.erase_after + interval '7 days', rule.source)
  returning * into r;
  insert into private.privacy_request_events (request_id, actor_id, action, represented_revision)
    values (r.id, actor, 'submitted', 1);
  insert into private.privacy_notice_jobs (request_id, kind) values (r.id, 'submitted');
  insert into private.account_erasure_requests (request_id, user_id, linked_how) values (r.id, actor, 'member_closed');
  return jsonb_build_object('status', 'closed', 'closed_at', er.closed_at, 'erase_after', er.erase_after,
    'request_id', r.id);
end;
$function$;
alter function internal.close_my_account() owner to postgres;
revoke all on function internal.close_my_account() from public, anon, authenticated, service_role;
grant execute on function internal.close_my_account() to authenticated;

create or replace function api.close_my_account()
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.close_my_account();
$function$;
alter function api.close_my_account() owner to postgres;
revoke all on function api.close_my_account() from public, anon, authenticated, service_role;
grant execute on function api.close_my_account() to authenticated;

-- 4. The staff commands. internal.order_account_erasure is the one place an
-- erasure is ordered for a deletion request: the staff command calls it for
-- the signed-in staff member, and until the staff screen exists the runbook's
-- owner SQL session calls it naming the staff member (no API role may).
create or replace function internal.order_account_erasure(p_request uuid, p_revision integer, p_staff uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare r private.privacy_requests; er private.account_erasures; subject uuid; linked uuid;
begin
  if p_request is null or p_staff is null or (p_revision is not null and p_revision not between 1 and 2147483646) then
    raise exception 'represented privacy request required' using errcode = '22023';
  end if;
  -- The account before the request, as closure and erasure lock them.
  select x.subject_user_id into subject from private.privacy_requests x where x.id = p_request;
  if subject is not null then perform internal.lock_evidence_subject(subject); end if;
  select * into r from private.privacy_requests x where x.id = p_request for update;
  if not found or (p_revision is not null and r.revision <> p_revision) or r.subject_user_id is distinct from subject then
    raise exception 'privacy request changed' using errcode = 'PT409';
  end if;
  if r.type <> 'deletion' or r.status <> 'in_progress' or not r.identity_verified then
    raise exception 'verified deletion request in progress required' using errcode = 'PT409',
      detail = 'deletion_request_required';
  end if;
  if not exists (select 1 from private.staff_roles s
      join private.staff_capabilities c on c.role = s.role and c.capability = 'dsar:manage'
      join private.current_account_access a on a.id = s.user_id
      where s.user_id = p_staff and s.revoked_at is null) then
    raise exception 'privacy capability required' using errcode = '42501';
  end if;
  if p_staff = r.subject_user_id or exists (select 1 from auth.users u where u.id = p_staff
      and lower(u.email) = lower(r.requester_email)) then
    raise exception 'another staff member must process your request' using errcode = '42501';
  end if;
  select l.user_id into linked from private.account_erasure_requests l where l.request_id = r.id;
  if r.subject_user_id is null then
    if linked is null then
      raise exception 'this request names no account to erase' using errcode = 'PT409', detail = 'no_account';
    end if;
    return jsonb_build_object('request_id', r.id) || internal.account_erasure_state(linked);
  end if;
  if r.verified_by is not distinct from p_staff then
    raise exception 'another staff member checked the identity; a second one orders the erasure'
      using errcode = '42501', detail = 'second_person_required';
  end if;
  if exists (select 1 from private.staff_roles s where s.user_id = r.subject_user_id and s.revoked_at is null) then
    raise exception 'end the staff roles of this account first' using errcode = 'PT409', detail = 'staff_account';
  end if;
  er := internal.close_account_now(r.subject_user_id, 'staff', p_staff);
  if linked is null then
    insert into private.account_erasure_requests (request_id, user_id, linked_how, linked_by)
      values (r.id, r.subject_user_id, 'staff_ordered', p_staff);
    -- The request is answered within 7 days after the grace period ends (or
    -- after it arrived, for an account closed long before).
    update private.privacy_requests set due_by = greatest(er.erase_after, r.received_at) + interval '7 days',
        processed_by = p_staff, revision = revision + 1
      where id = r.id;
    insert into private.privacy_request_events (request_id, actor_id, action, represented_revision)
      values (r.id, p_staff, 'erasure_ordered', r.revision);
    -- A new verified request supersedes an earlier rejection (a legal hold
    -- placed then still applies until staff release it).
    update private.account_erasures set rejected_at = null where user_id = r.subject_user_id;
  end if;
  if er.erased_at is null and er.erase_after <= statement_timestamp() then
    perform internal.erase_closed_account(r.subject_user_id, 'staff');
  end if;
  return jsonb_build_object('request_id', r.id) || internal.account_erasure_state(er.user_id);
end;
$function$;
alter function internal.order_account_erasure(uuid,integer,uuid) owner to postgres;
revoke all on function internal.order_account_erasure(uuid,integer,uuid) from public, anon, authenticated, service_role;

-- Staff rejected a deletion request linked to an account that is closed but
-- not erased (process_frontend_privacy_request, 'reject'): the erasure is
-- recorded as rejected and the account gets a legal hold for review in 12
-- months, so nothing erases it later on its own (not even once the request
-- record is purged). Releasing the hold is the existing legal-hold step.
create or replace function internal.reject_account_erasure(p_request uuid, p_staff uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare subject uuid;
begin
  select l.user_id into subject from private.account_erasure_requests l where l.request_id = p_request;
  if subject is null then return; end if;
  -- Under the account lock the erasure and hold writers take, then re-read.
  perform internal.lock_evidence_subject(subject);
  if exists (select 1 from private.account_erasures e where e.user_id = subject and e.erased_at is not null) then
    raise exception 'the account was already erased' using errcode = 'PT409', detail = 'account_erased';
  end if;
  update private.account_erasures set rejected_at = statement_timestamp() where user_id = subject;
  if not exists (select 1 from private.legal_holds h where h.subject_id = subject and h.released_at is null
      and h.reason like 'Deletion request rejected%') then
    insert into private.legal_holds (subject_id, reason, placed_by)
      values (subject, 'Deletion request rejected; review by '
        || to_char((statement_timestamp() at time zone 'Africa/Johannesburg') + interval '12 months', 'YYYY-MM-DD'),
        p_staff);
  end if;
end;
$function$;
alter function internal.reject_account_erasure(uuid,uuid) owner to postgres;
revoke all on function internal.reject_account_erasure(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function internal.fulfil_account_deletion(p_request uuid, p_revision integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare actor uuid := internal.staff_actor('dsar:manage'); result jsonb;
begin
  if p_revision is null then raise exception 'represented privacy request required' using errcode = '22023'; end if;
  result := internal.order_account_erasure(p_request, p_revision, actor);
  perform internal.staff_actor('dsar:manage'); -- authority after any lock wait
  return result;
end;
$function$;
alter function internal.fulfil_account_deletion(uuid,integer) owner to postgres;
revoke all on function internal.fulfil_account_deletion(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function internal.fulfil_account_deletion(uuid,integer) to authenticated;

create or replace function api.fulfil_account_deletion(p_request uuid, p_revision integer)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.fulfil_account_deletion(p_request, p_revision);
$function$;
alter function api.fulfil_account_deletion(uuid,integer) owner to postgres;
revoke all on function api.fulfil_account_deletion(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function api.fulfil_account_deletion(uuid,integer) to authenticated;

create or replace function internal.get_account_erasure(p_request uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare linked private.account_erasure_requests; subject uuid;
begin
  perform internal.staff_actor('dsar:manage');
  if p_request is null then raise exception 'privacy request required' using errcode = '22023'; end if;
  select * into linked from private.account_erasure_requests l where l.request_id = p_request;
  if found then
    return jsonb_build_object('request_id', p_request, 'linked', linked.linked_how, 'linked_at', linked.linked_at)
      || internal.account_erasure_state(linked.user_id);
  end if;
  select x.subject_user_id into subject from private.privacy_requests x where x.id = p_request and x.type = 'deletion';
  if not found then raise exception 'deletion request not found' using errcode = 'PT404', detail = 'request_unavailable'; end if;
  return jsonb_build_object('request_id', p_request, 'linked', null,
    'status', case when subject is null then 'no_account' else 'not_ordered' end);
end;
$function$;
alter function internal.get_account_erasure(uuid) owner to postgres;
revoke all on function internal.get_account_erasure(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_account_erasure(uuid) to authenticated;

create or replace function api.get_account_erasure(p_request uuid)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.get_account_erasure(p_request);
$function$;
alter function api.get_account_erasure(uuid) owner to postgres;
revoke all on function api.get_account_erasure(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_account_erasure(uuid) to authenticated;

-- 7. The sweep, run by the retention job.
create or replace function internal.run_account_erasures(p_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare candidate record; outcome jsonb; erased integer := 0; held integer := 0; failed integer := 0;
  removed integer := 0; kept integer := 0; purged integer := 0; stuck integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode = '22023'; end if;
  -- Due erasures, each on its own: a failure is recorded and retried after an hour.
  for candidate in
    select e.user_id from private.account_erasures e
    where e.erased_at is null and e.erase_after <= statement_timestamp()
      and (e.blocked_at is null or e.blocked_at < statement_timestamp() - interval '1 hour')
    order by e.erase_after limit p_limit
    for update skip locked
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text, 2408)) then
      continue;
    end if;
    begin
      outcome := internal.erase_closed_account(candidate.user_id, 'sweep');
      if outcome->>'status' in ('erased', 'removed') then erased := erased + 1; else held := held + 1; end if;
    exception when others then
      failed := failed + 1;
      update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
          blocked_detail = sqlstate
        where user_id = candidate.user_id;
    end;
  end loop;
  -- Erased accounts whose Auth user is still named by a kept record: checked once a day.
  for candidate in
    select e.user_id from private.account_erasures e
    where e.erased_at is not null and e.auth_removed_at is null
      and (e.auth_checked_at is null or e.auth_checked_at < statement_timestamp() - interval '1 day')
    order by e.auth_checked_at nulls first, e.erased_at limit p_limit
    for update skip locked
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text, 2408)) then
      continue;
    end if;
    begin
      if internal.remove_erased_auth_user(candidate.user_id) then
        update private.account_erasures set auth_removed_at = statement_timestamp(),
            auth_checked_at = statement_timestamp(), blocked_at = null, blocked_reason = null, blocked_detail = null
          where user_id = candidate.user_id;
        removed := removed + 1;
      else
        update private.account_erasures set auth_checked_at = statement_timestamp() where user_id = candidate.user_id;
        kept := kept + 1;
      end if;
    exception when others then
      failed := failed + 1;
      update private.account_erasures set auth_checked_at = statement_timestamp(), blocked_at = statement_timestamp(),
          blocked_reason = 'error', blocked_detail = sqlstate
        where user_id = candidate.user_id;
    end;
  end loop;
  -- The proof of an erasure: kept 5 years, once the Auth user is gone.
  begin
    delete from private.account_erasures e where e.user_id in (select x.user_id from private.account_erasures x
      where x.auth_removed_at is not null and x.erased_at < statement_timestamp() - interval '5 years'
      order by x.erased_at limit p_limit for update skip locked);
    get diagnostics purged = row_count;
  exception when others then
    failed := failed + 1;
  end;
  -- Erasures that failed: the retention job raises an alert while any remain.
  select count(*) into stuck from private.account_erasures e where e.blocked_reason = 'error';
  return jsonb_build_object('erased', erased, 'held', held, 'failed', failed, 'auth_removed', removed,
    'auth_kept', kept, 'records_purged', purged, 'stuck', stuck);
end;
$function$;
alter function internal.run_account_erasures(integer) owner to postgres;
revoke all on function internal.run_account_erasures(integer) from public, anon, authenticated, service_role;

-- 8. Closed privacy requests keep a minimised proof. Once the last notice of a
-- completed or rejected request was sent (or 30 days after it closed), the
-- address is replaced by the marker 'removed' (nothing needs to match a later
-- request) and the phone and description are cleared; the proof (type, dates, staff, outcome) is deleted 5 years after
-- the request closed (provisional periods; the lawyer confirms).
create or replace function internal.retention_privacy_requests(p_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare minimised integer; purged integer;
begin
  with closed as (
    select r.id, coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at
    from private.privacy_requests r
    where r.status in ('completed', 'rejected') and r.minimised_at is null
  ), due as (
    select c.id from closed c
    where c.closed_at < statement_timestamp() - interval '30 days'
      or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = c.id and j.delivered_at is null)
    order by c.closed_at limit p_limit
  )
  update private.privacy_requests r
    set requester_email = 'removed',
      requester_phone = 'not_provided', description = 'Removed after the request was closed.',
      minimised_at = statement_timestamp()
  from due where r.id = due.id;
  get diagnostics minimised = row_count;
  delete from private.privacy_requests r where r.id in (select x.id from private.privacy_requests x
    where x.minimised_at is not null
      -- Never while it explains an erasure that has not run (a rejection).
      and not exists (select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id = l.user_id
        where l.request_id = x.id and e.erased_at is null)
      and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '5 years'
    order by x.minimised_at limit p_limit for update skip locked);
  get diagnostics purged = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged);
end;
$function$;
alter function internal.retention_privacy_requests(integer) owner to postgres;
revoke all on function internal.retention_privacy_requests(integer) from public, anon, authenticated, service_role;

-- 1, 6 and 7. Full bodies of the functions this update replaces.
CREATE OR REPLACE FUNCTION internal.payment_quote_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['owner_id']) then
      return new;
    end if;
  end if;
  if (new.id,new.owner_id,new.product_kind,new.plan_version_id,new.addon_version_id,
      new.target_post_id,new.amount_cents,new.currency,new.snapshot,new.merchant_reference,new.provider)
    is distinct from (old.id,old.owner_id,old.product_kind,old.plan_version_id,old.addon_version_id,
      old.target_post_id,old.amount_cents,old.currency,old.snapshot,old.merchant_reference,old.provider) then
    raise exception 'payment quote and historical target are immutable' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_quote_guard() owner to postgres;
revoke all on function internal.payment_quote_guard() from public;

CREATE OR REPLACE FUNCTION internal.customer_invoice_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; counter integer; issued_on date;
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
    raise exception 'invoices are never removed; void it instead' using errcode='23514';
  end if;
  if tg_op = 'INSERT' then
    select n.last_number into counter from private.customer_invoice_numbers n
      where n.invoice_year = new.invoice_year for update;
    issued_on := internal.customer_invoice_day(new.issued_at);
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
    if not found or pay.status <> 'complete' or pay.owner_id <> new.account_id
        or pay.amount_cents <> new.total_cents or new.paid_at is distinct from pay.completed_at
        or not ((pay.provider = 'ozow' and exists(select 1 from private.customer_invoice_payments l
            where l.payment_id = new.payment_id and l.invoice_id = new.id))
          or (pay.provider = 'invoice' and exists(select 1 from private.invoice_transfers t
            where t.payment_id = new.payment_id and t.customer_invoice_id = new.id and t.status = 'confirmed')))
        or new.voided_by is not null or new.voided_at is not null or new.void_reason is not null then
      raise exception 'a paid invoice names its complete payment of that account and amount' using errcode='23514';
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
  -- payment: that account, amount and plan) or to declined.
  if tg_op = 'DELETE' then
    -- Only the retention job removes a record, five tax years on.
    if pg_catalog.current_setting('vm.retention', true) = 'on' then return old; end if;
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
revoke all on function internal.invoice_transfer_guard() from public;

CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed text[]; allowed text[];
  ozow_facts constant text[] := array['ozow_refund_id','ozow_status','ozow_status_at','ozow_requested_at',
    'ozow_completed_at','send_outcome','ozow_checked_at','ozow_missing_at'];
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- The request, its reference, amount, account, channel and Ozow transaction
  -- never change. A waiting record is approved, applied or declined once; an
  -- API record is then sent once and settles once (applied, failed or
  -- returned). Only Ozow's facts and the send bookkeeping change in between.
  if tg_op = 'INSERT' then
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id)
      or new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    if new.channel in ('api', 'dashboard')
        and new.ozow_transaction_id is distinct from internal.ozow_refund_transaction(new.payment_id) then
      raise exception 'an Ozow refund names the Ozow transaction of the payment' using errcode='23514';
    end if;
    if new.channel = 'api' and (new.status not in ('awaiting_approval', 'approved') or new.send_attempts <> 0
        or new.ozow_refund_id is not null or new.ozow_status is not null or new.approved_by is not null) then
      raise exception 'an API refund starts waiting or approved, before it is sent' using errcode='23514';
    end if;
    if new.ozow_status is not null or new.ozow_checked_at is not null or new.ozow_missing_at is not null
        or new.closed_by is not null then
      raise exception 'a refund starts without an Ozow status' using errcode='23514';
    end if;
    -- An Ozow refund id is recorded once, whichever way it was recorded: a
    -- reference record may not name a refund already recorded by its id.
    if new.channel = 'manual' and exists(select 1 from private.payment_refund_requests r
        where r.status <> 'declined' and r.ozow_refund_id::text = lower(btrim(new.ozow_reference))) then
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    -- Once the server has sent a refund to Ozow, a refund of an Ozow payment is
    -- made through Ozow (or recorded from the dashboard with Ozow's refund id),
    -- never with a typed reference. Chargebacks and payments made outside Ozow
    -- keep the reference.
    if new.channel = 'manual' and new.kind = 'refunded'
        and internal.ozow_refund_transaction(new.payment_id) is not null
        and exists(select 1 from private.payment_refund_requests r where r.channel = 'api' and r.send_attempts > 0) then
      raise exception 'refunds of Ozow payments go through Ozow now' using errcode='PT409', detail='ozow_reference_retired';
    end if;
    return new;
  end if;
  select coalesce(array_agg(n.key order by n.key), '{}') into changed
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value;
  if old.ozow_refund_id is not null and new.ozow_refund_id is distinct from old.ozow_refund_id then
    raise exception 'an Ozow refund id never changes' using errcode='23514';
  end if;
  if new.send_attempts < old.send_attempts then
    raise exception 'send attempts only rise' using errcode='23514';
  end if;
  if old.status = new.status then
    allowed := case
      when old.status = 'applied' and old.released_activations is null then array['released_activations']
      else '{}'::text[] end
      || case when old.channel = 'manual' then '{}'::text[]
        else ozow_facts || array['send_attempts','last_send_at'] end;
  elsif old.status = 'awaiting_approval' and new.status = 'declined' then
    allowed := array['status','declined_by','declined_at','decline_reason'];
  elsif old.status = 'awaiting_approval' and old.channel <> 'api' and new.status = 'applied' then
    allowed := array['status','approved_by','applied_at'];
  elsif old.status = 'awaiting_approval' and old.channel = 'api' and new.status = 'approved' then
    allowed := array['status','approved_by','approved_at'];
  elsif old.channel = 'api' and old.status = 'approved' and new.status in ('sent', 'failed') then
    allowed := array['status','sent_at','send_attempts','last_send_at','send_outcome','failed_at','failure_reason',
      'closed_by','close_reason'];
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'applied' then
    allowed := array['status','applied_at'] || ozow_facts;
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'failed' then
    allowed := array['status','failed_at','failure_reason','closed_by','close_reason'] || ozow_facts;
  elsif old.channel = 'api' and old.status = 'sent' and new.status = 'returned' then
    allowed := array['status','returned_at'] || ozow_facts;
  else
    raise exception 'refund records are immutable; a waiting refund is approved, applied or declined once and an Ozow refund settles once'
      using errcode='23514';
  end if;
  if not changed <@ allowed then
    raise exception 'refund records are immutable; a waiting refund is approved, applied or declined once and an Ozow refund settles once'
      using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_request_guard() owner to postgres;
revoke all on function internal.payment_refund_request_guard() from public;

CREATE OR REPLACE FUNCTION internal.partner_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['referred_account_id']) then
      return new;
    end if;
  end if;
  if (new.id,new.partner_id,new.payment_id,new.payment_line_id,new.referred_account_id,new.base_cents,new.rate_bps,
      new.amount_cents,new.eligible_at,new.created_at) is distinct from (old.id,old.partner_id,old.payment_id,
      old.payment_line_id,old.referred_account_id,old.base_cents,old.rate_bps,old.amount_cents,old.eligible_at,
      old.created_at)
    or old.status='reversed'
    or (old.status,new.status) not in(('pending','pending'),('pending','approved'),('pending','reversed'),
      ('approved','approved'),('approved','paid'),('approved','reversed'),('paid','paid'),('paid','reversed')) then
    raise exception 'commission history is immutable' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.partner_commission_guard() owner to postgres;
revoke all on function internal.partner_commission_guard() from public;

CREATE OR REPLACE FUNCTION internal.individual_slot_limit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
      return new;
    end if;
  end if;
  -- The audit trail of raised limits: a raise is only ever ended, once.
  if tg_op = 'DELETE' then
    raise exception 'slot limit history is retained' using errcode='23514';
  end if;
  if (to_jsonb(new) - array['revoked_at','revoked_by','revoke_reason'])
      is distinct from (to_jsonb(old) - array['revoked_at','revoked_by','revoke_reason'])
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'slot limit history is immutable; end the raise and grant a new one' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.individual_slot_limit_guard() owner to postgres;
revoke all on function internal.individual_slot_limit_guard() from public;

CREATE OR REPLACE FUNCTION internal.slot_package_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- An erasure unlinks the erased account from this kept record (20261116175757_close_and_erase_account.sql);
  -- nothing else may change with it.
  if tg_op = 'UPDATE' and coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> '' then
    if internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['owner_id']) then
      return new;
    end if;
  end if;
  raise exception 'a package never changes; its slots and dates are its grants' using errcode='23514';
end;
$function$;
alter function internal.slot_package_guard() owner to postgres;
revoke all on function internal.slot_package_guard() from public;

CREATE OR REPLACE FUNCTION internal.process_frontend_privacy_request(p_case uuid, p_revision integer, p_action text, p_note text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_attestation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('dsar:manage');r private.privacy_requests;rule private.privacy_request_rules;now_at timestamptz;
  answer text;delivery text;note text;verified_subject uuid;matches integer;
begin
  if p_action is null or p_action not in('assign','extend','verify_identity','approve','reject','complete')
    or p_revision is null or p_revision not between 1 and 2147483646 then raise exception 'represented privacy request required' using errcode='22023';end if;
  if p_note is not null then note:=internal.privacy_text(p_note,1,2000);end if;
  select * into r from private.privacy_requests where id=p_case for update;
  if not found or r.revision<>p_revision or r.status not in('submitted','identity_pending','in_progress') then raise exception 'privacy request changed' using errcode='PT409';end if;
  actor:=internal.staff_actor('dsar:manage');now_at:=clock_timestamp();
  if actor=r.subject_user_id or exists(select 1 from auth.users u where u.id=actor and lower(u.email)=lower(r.requester_email))
    then raise exception 'another staff member must process your request' using errcode='42501';end if;
  if p_action='assign' then
    if p_assignee is not null and (p_assignee=r.subject_user_id or not exists(
      select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='dsar:manage'
      join private.current_account_access a on a.id=s.user_id join auth.users u on u.id=s.user_id
      where s.user_id=p_assignee and s.revoked_at is null and lower(u.email)<>lower(r.requester_email)))
      then raise exception 'eligible staff assignee required' using errcode='22023';end if;
    update private.privacy_requests set assigned_to=p_assignee,revision=revision+1 where id=r.id;
    answer:=case when p_assignee is null then 'unassigned' else 'assigned' end;
  elsif p_action='extend' then
    select * into rule from private.privacy_request_rules where request_type=r.type;
    if rule.extension_days=0 or r.extended_due_at is not null or r.due_by<=now_at then raise exception 'deadline cannot be extended' using errcode='PT409';end if;
    note:=internal.privacy_text(p_note,10,1000);
    r.extended_due_at:=r.due_by+make_interval(days=>rule.extension_days);
    update private.privacy_requests set extended_due_at=r.extended_due_at,extension_reason=note,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='extended';delivery:=answer;
  elsif p_action='verify_identity' then
    if r.identity_verified then raise exception 'identity was already reviewed' using errcode='PT409';end if;
    if r.identity_check='manual' then
      select count(*),(array_agg(u.id order by u.id))[1] into matches,verified_subject from auth.users u
        where lower(u.email)=lower(r.requester_email) and u.email_confirmed_at is not null and u.deleted_at is null and not u.is_anonymous;
      if matches<>1 then verified_subject:=null;end if;
    else verified_subject:=r.subject_user_id;end if;
    update private.privacy_requests set identity_verified=true,verified_at=now_at,verified_by=actor,
      subject_user_id=verified_subject,processed_by=actor,revision=revision+1 where id=r.id;
    answer:='identity_verified';
  elsif p_action in('approve','reject') then
    if r.status not in('submitted','identity_pending') then raise exception 'privacy request already decided' using errcode='PT409';end if;
    answer:=case p_action when 'approve' then 'in_progress' else 'rejected' end;
    if answer='rejected' then delivery:=answer;end if;
    update private.privacy_requests set status=answer,response_summary=note,processed_by=actor,revision=revision+1 where id=r.id;
    -- A rejected deletion request never lets its account be erased later on
    -- its own: the rejection is recorded and a legal hold placed (20261116175757_close_and_erase_account.sql).
    if answer='rejected' and r.type='deletion' then perform internal.reject_account_erasure(r.id,actor);end if;
  else
    if r.status<>'in_progress' or not r.identity_verified then raise exception 'verified in-progress privacy request required' using errcode='PT409';end if;
    if r.type='deletion' then
      -- An account named by the request is erased first (20261116175757_close_and_erase_account.sql).
      if exists(select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id=l.user_id
          where l.request_id=r.id and e.erased_at is null) then
        raise exception 'the account is not erased yet' using errcode='PT409',detail='erasure_pending';end if;
      if r.subject_user_id is not null and not exists(select 1 from private.account_erasure_requests l where l.request_id=r.id) then
        raise exception 'order the account erasure first' using errcode='PT409',detail='erasure_required';end if;
      note:=concat_ws(E'\n\n',note,'Deletion attestation: '||internal.privacy_text(p_attestation,10,2000));
    elsif p_attestation is not null then raise exception 'attestation applies only to deletion' using errcode='22023';end if;
    update private.privacy_requests set status='completed',response_summary=note,processed_by=actor,completed_at=now_at,revision=revision+1 where id=r.id;
    answer:='completed';delivery:=answer;
  end if;
  insert into private.privacy_request_events(request_id,actor_id,action,represented_revision)
    values(r.id,actor,case answer when 'in_progress' then 'started' else answer end,p_revision);
  if delivery is not null then insert into private.privacy_notice_jobs(request_id,kind) values(r.id,delivery);end if;
  perform internal.staff_actor('dsar:manage');
  return jsonb_build_object('id',r.id,'status',answer,'due',case when answer='extended' then r.extended_due_at end);
end$function$;
alter function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) owner to postgres;
revoke all on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) from public;
grant execute on function internal.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with due as (
    select j.id from private.privacy_notice_jobs j join private.privacy_requests r on r.id=j.request_id
    where j.delivered_at is null and j.attempts<8 and j.next_attempt_at<=now_at
      and (j.locked_until is null or j.locked_until<now_at)
      and r.minimised_at is null -- a minimised request has no address left
      -- An erased account's request goes to the address stored with it.
      and (r.identity_check='manual' or exists(select 1 from private.account_erasure_requests l where l.request_id=r.id)
        or exists(select 1 from auth.users u where u.id=r.subject_user_id and u.email_confirmed_at is not null
        and not u.is_anonymous and u.deleted_at is null and lower(u.email)=lower(r.requester_email)))
    order by j.next_attempt_at,j.id limit 1 for update of j skip locked
  ), claimed as (
    update private.privacy_notice_jobs j set claim_token=gen_random_uuid(),locked_until=now_at+interval '90 seconds',attempts=attempts+1
    from due where j.id=due.id returning j.*
  )
  select jsonb_build_object('id',j.id,'request_id',r.id,'kind',j.kind,'recipient',r.requester_email,'claim_token',j.claim_token,'locked_until',j.locked_until,
    'due',case when j.kind='extended' then r.extended_due_at when j.kind='submitted' then r.due_by end,
    'reason',case when j.kind='extended' then r.extension_reason end)
    into result from claimed j join private.privacy_requests r on r.id=j.request_id;
  return result;
end$function$;
alter function internal.claim_frontend_privacy_notice() owner to postgres;
revoke all on function internal.claim_frontend_privacy_notice() from public;
grant execute on function internal.claim_frontend_privacy_notice() to service_role;

CREATE OR REPLACE FUNCTION internal.record_staff_payment_refund(p_payment_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; repeat jsonb; request private.payment_refund_requests;
  result jsonb; approval boolean; refunded_before bigint; reference text;
begin
  actor := internal.staff_actor('payments:refund');
  reference := internal.staff_refund_reference(p_payment_id, p_ozow_reference);
  perform internal.assert_staff_refund_reason(p_kind, p_reason_code, p_reason);
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if not found then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_payment_id::text, 0));
  perform internal.lock_kept_record_subject(buyer, p_payment_id);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, null, p_kind, p_reason_code, p_reason, reference);
  if repeat is not null then return repeat; end if;
  if exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id) or pay.status <> 'complete' then
    raise exception 'only a completed payment that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval(p_kind, refunded_before, pay.amount_cents) or pay.owner_id is null;
  if not approval then
    result := internal.reverse_payment(pay.id, p_kind, btrim(p_reason));
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, p_kind, btrim(p_reason), (result->>'released_activations')::integer);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, account_id, kind, reason_code, reason, ozow_reference,
      amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference, pay.amount_cents, refunded_before,
      approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind,
    'released_activations', request.released_activations,
    'payment_status', case when approval then pay.status else p_kind end, 'repeated', false);
end;
$function$;
alter function internal.record_staff_payment_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_payment_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_payment_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines; repeat jsonb;
  request private.payment_refund_requests; result jsonb; approval boolean; refunded_before bigint; reference text;
begin
  actor := internal.staff_actor('payments:refund');
  reference := internal.staff_refund_reference((select l.payment_id from private.payment_lines l where l.id = p_line_id),
    p_ozow_reference);
  perform internal.assert_staff_refund_reason(p_kind, p_reason_code, p_reason);
  if p_line_id is null then raise exception 'slot required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payment_lines l join private.payments p on p.id = l.payment_id
    where l.id = p_line_id;
  if payment is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(buyer, payment);
  select * into pay from private.payments p where p.id = payment for update;
  select * into line from private.payment_lines l where l.id = p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  repeat := internal.staff_refund_repeat(actor, pay.id, line.id, p_kind, p_reason_code, p_reason, reference);
  if repeat is not null then return repeat; end if;
  if pay.status <> 'complete' or line.status <> 'open' then
    raise exception 'only an open slot of a completed payment can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents) or pay.owner_id is null;
  if not approval then
    result := internal.record_staff_slot_reversal(line.id, p_kind, btrim(p_reason));
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (payment_id, payment_line_id, account_id, kind, reason_code, reason,
      ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
    values (pay.id, line.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference,
      line.amount_cents, refunded_before, approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
      case when approval then null else statement_timestamp() end,
      case when approval then null else (result->>'released_activations')::integer end)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind, 'line_id', line.id,
    'released_activations', request.released_activations,
    'payment_status', coalesce(result->>'payment_status', pay.status), 'repeated', false);
end;
$function$;
alter function internal.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; line private.payment_lines; pay private.payments; ent private.entitlements;
  released integer := 0; v_post_ids uuid[] := '{}'::uuid[]; open_left integer; c record;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_line_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'valid slot reversal and reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payment_lines l join private.payments p on p.id=l.payment_id where l.id=p_line_id;
  if not found then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  perform internal.lock_kept_record_subject(buyer, (select l.payment_id from private.payment_lines l where l.id=p_line_id));
  select p.* into pay from private.payments p join private.payment_lines l on l.payment_id=p.id where l.id=p_line_id
    for update of p;
  select * into line from private.payment_lines l where l.id=p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  if line.status='reversed' then
    if line.reversed_by=actor and line.reversal_kind=p_kind and line.reversal_reason=btrim(p_reason) then
      return jsonb_build_object('status',line.reversal_kind,'line_id',line.id,'released_activations',0,
        'payment_status',pay.status,'repeated',true);
    end if;
    raise exception 'this slot was already reversed' using errcode='PT409';
  end if;
  if pay.status<>'complete' then
    raise exception 'only slots of a completed payment can be reversed' using errcode='22023';
  end if;
  begin
    select * into ent from private.entitlements e where e.payment_line_id=line.id for update nowait;
    perform p.id from private.posts p where p.id in
      (select a.post_id from private.post_activations a where a.entitlement_id=ent.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payment_lines set status='reversed', reversal_kind=p_kind, reversal_reason=btrim(p_reason),
    reversed_at=statement_timestamp(), reversed_by=actor where id=line.id;
  if ent.id is not null then
    update private.entitlements set status='revoked', revoked_reason='payment_'||p_kind
      where id=ent.id and status<>'revoked';
    with released_rows as (
      update private.post_activations a set released_at=statement_timestamp(), release_reason='payment_reversed'
      where a.entitlement_id=ent.id and a.released_at is null
      returning a.post_id
    )
    select coalesce(array_agg(post_id),'{}') into v_post_ids from released_rows;
    released := cardinality(v_post_ids);
    update private.posts p set status='expired', status_reason='Payment '||p_kind, revision=revision+1
      where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
        or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
          where h.post_id=p.id and h.released_at is null)));
    update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  end if;
  -- Only this slot's commission.
  for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
      where x.payment_line_id=line.id and x.status<>'reversed' for update of x loop
    update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
      reversal_reason='Slot payment '||p_kind where id=c.id;
    perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
  end loop;
  select count(*) into open_left from private.payment_lines l where l.payment_id=pay.id and l.status='open';
  if open_left=0 then
    -- Every slot is reversed: so is the payment (its commission trigger finds nothing left).
    update private.payments set status=p_kind, fulfillment_status='reversed', status_changed_at=statement_timestamp()
      where id=pay.id;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_line_reversed:' || line.id);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  return jsonb_build_object('status',p_kind,'line_id',line.id,'released_activations',released,
    'payment_status',case when open_left=0 then p_kind else pay.status end,'repeated',false);
end;
$function$;
alter function internal.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_reversal(uuid,text,text) from public;

CREATE OR REPLACE FUNCTION internal.record_staff_ozow_refund(p_channel text, p_payment_id uuid, p_line_id uuid, p_reason_code text, p_reason text, p_ozow_refund_id uuid, p_ozow_fact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines;
  prior private.payment_refund_requests; request private.payment_refund_requests; transaction uuid;
  amount bigint; refunded_before bigint; approval boolean; result jsonb; new_id uuid := pg_catalog.gen_random_uuid();
begin
  actor := internal.staff_actor('payments:refund');
  if p_channel is null or p_channel not in ('api', 'dashboard')
    or (p_channel = 'api' and p_ozow_refund_id is not null) then
    raise exception 'refund channel required' using errcode='22023';
  end if;
  if p_channel = 'dashboard' and p_ozow_refund_id is null then
    raise exception 'Ozow refund id required' using errcode='22023', detail='ozow_refund_id_required';
  end if;
  -- The refund as the website read it from Ozow (transaction, amount and
  -- status), when it could: it must be this payment's and this amount. It
  -- only refuses: Ozow's status is stored only when the server's own
  -- follow-up reads the refund back (internal.apply_ozow_refund_status).
  if p_ozow_fact is not null and (p_channel <> 'dashboard' or not internal.valid_ozow_refund_fact(p_ozow_fact)
      or p_ozow_fact->>'refund_id' is distinct from p_ozow_refund_id::text) then
    raise exception 'valid Ozow refund required' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payments p where p.id = p_payment_id;
  if payment is null then raise exception 'payment not found' using errcode='22023'; end if;
  if p_line_id is not null and not exists(select 1 from private.payment_lines l
      where l.id = p_line_id and l.payment_id = payment) then
    raise exception 'slot payment line not found' using errcode='22023';
  end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(buyer, payment);
  select * into pay from private.payments p where p.id = payment for update;
  if p_line_id is not null then
    select * into line from private.payment_lines l where l.id = p_line_id for update;
  end if;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- A repeat of the same request by the same staff member returns its state.
  if p_channel = 'dashboard' then
    -- A declined record took no effect, so its refund id may be recorded again.
    select * into prior from private.payment_refund_requests r
      where r.ozow_refund_id = p_ozow_refund_id and r.status <> 'declined';
    if not found then
      select * into prior from private.payment_refund_requests r
        where r.channel = 'manual' and r.status <> 'declined' and lower(r.ozow_reference) = p_ozow_refund_id::text;
    end if;
    if found then
      if prior.channel = 'dashboard' and prior.payment_id = pay.id and prior.payment_line_id is not distinct from line.id
          and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = actor then
        return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'channel', prior.channel,
          'kind', prior.kind, 'line_id', prior.payment_line_id, 'amount_cents', prior.amount_cents,
          'needs_approval', prior.needs_approval, 'released_activations', prior.released_activations,
          'payment_status', pay.status, 'repeated', true);
      end if;
      raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
    end if;
  else
    select * into prior from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('awaiting_approval', 'approved', 'sent')
        and r.payment_line_id is not distinct from line.id and r.reason_code = p_reason_code
        and r.reason = btrim(p_reason) and r.requested_by = actor;
    if found then
      return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'channel', prior.channel,
        'kind', prior.kind, 'line_id', prior.payment_line_id, 'amount_cents', prior.amount_cents,
        'needs_approval', prior.needs_approval, 'released_activations', prior.released_activations,
        'payment_status', pay.status, 'repeated', true);
    end if;
  end if;
  if pay.status <> 'complete' or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
      or (p_line_id is not null and line.status <> 'open') then
    raise exception 'only a completed payment or open slot that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if p_line_id is null and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  transaction := internal.ozow_refund_transaction(pay.id);
  if transaction is null then
    raise exception 'this payment was not paid through Ozow; record its refund with its reference' using errcode='PT409', detail='payment_not_ozow';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  amount := coalesce(line.amount_cents, pay.amount_cents);
  if p_ozow_fact is not null then
    if (p_ozow_fact->>'transaction_id')::uuid is distinct from transaction
        or (p_ozow_fact->>'amount_cents')::bigint is distinct from amount then
      raise exception 'this Ozow refund is for another payment or amount' using errcode='PT409', detail='ozow_refund_mismatch';
    end if;
    if p_ozow_fact->>'status' in ('Failed', 'Cancelled', 'Returned', 'Invalid', 'Error') then
      raise exception 'Ozow has no paid refund with this id' using errcode='PT409', detail='refund_ozow_failed';
    end if;
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval('refunded', refunded_before, amount) or pay.owner_id is null;
  if p_channel = 'dashboard' and not approval then
    -- The money already went back in the Ozow dashboard: it takes effect now,
    -- as today's recorded refunds do.
    if p_line_id is null then
      result := internal.reverse_payment(pay.id, 'refunded', btrim(p_reason));
      insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
        values (pay.id, actor, 'refunded', btrim(p_reason), (result->>'released_activations')::integer);
    else
      result := internal.record_staff_slot_reversal(line.id, 'refunded', btrim(p_reason));
    end if;
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_refund_requests (id, payment_id, payment_line_id, account_id, kind, reason_code, reason,
      ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at,
      released_activations, channel, approved_at, ozow_transaction_id, ozow_refund_id)
    values (new_id, pay.id, line.id, pay.owner_id, 'refunded', p_reason_code, btrim(p_reason),
      case when p_channel = 'api' then 'vm-refund-' || new_id::text else p_ozow_refund_id::text || ':' || new_id::text end,
      amount, refunded_before, approval,
      case when approval then 'awaiting_approval' when p_channel = 'api' then 'approved' else 'applied' end, actor,
      case when p_channel = 'dashboard' and not approval then statement_timestamp() end,
      case when p_channel = 'dashboard' and not approval then (result->>'released_activations')::integer end,
      p_channel, case when p_channel = 'api' and not approval then statement_timestamp() end, transaction,
      p_ozow_refund_id)
    returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'channel', request.channel,
    'kind', request.kind, 'line_id', request.payment_line_id, 'amount_cents', request.amount_cents,
    'needs_approval', request.needs_approval, 'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
alter function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) owner to postgres;
revoke all on function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) from public;

CREATE OR REPLACE FUNCTION internal.approve_staff_payment_refund(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests; pay private.payments; result jsonb;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  perform internal.lock_kept_record_subject(request.account_id, request.payment_id);
  select * into pay from private.payments p where p.id = request.payment_id for update;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must approve this refund' using errcode='42501', detail='refund_approver_same';
  end if;
  if request.status not in ('awaiting_approval', 'declined') and request.approved_by = actor then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
      'released_activations', request.released_activations, 'payment_status', pay.status, 'repeated', true);
  end if;
  if request.status <> 'awaiting_approval' then
    raise exception 'this refund is no longer waiting for approval' using errcode='PT409', detail='refund_not_waiting';
  end if;
  -- The payment or slot changed since the refund was recorded (for example a
  -- reversal recorded before this rule existed): decline it and record again.
  if pay.status <> 'complete'
    or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
    or (request.payment_line_id is null
      and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed'))
    or (request.payment_line_id is not null
      and not exists(select 1 from private.payment_lines l where l.id = request.payment_line_id and l.status = 'open'))
    or (request.channel in ('api', 'dashboard')
      and internal.ozow_refund_transaction(pay.id) is distinct from request.ozow_transaction_id) then
    raise exception 'the payment changed since this refund was recorded; decline it and record it again'
      using errcode='PT409', detail='refund_payment_changed';
  end if;
  -- A dashboard refund Ozow does not have, or did not pay, never takes effect.
  if request.channel = 'dashboard' and (request.ozow_missing_at is not null
      or request.ozow_status in ('Failed', 'Cancelled', 'Returned', 'Invalid', 'Error')) then
    raise exception 'Ozow has no paid refund with this id; decline it' using errcode='PT409', detail='refund_ozow_failed';
  end if;
  if request.channel = 'api' then
    -- Approved: the server sends it to Ozow; the payment changes only when
    -- Ozow reports the refund complete.
    update private.payment_refund_requests set status = 'approved', approved_by = actor,
      approved_at = statement_timestamp()
      where id = request.id returning * into request;
    perform internal.staff_actor('payments:refund');
    perform internal.assert_staff_payment_actor(actor, request.account_id);
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
      'released_activations', null, 'payment_status', pay.status, 'repeated', false);
  end if;
  -- The record leaves "waiting" first, so the reversal below is no longer held
  -- back by internal.payment_reversal_waiting_guard; it is one transaction, so
  -- a failed reversal puts the record back to waiting.
  update private.payment_refund_requests set status = 'applied', approved_by = actor, applied_at = statement_timestamp()
    where id = request.id;
  if request.payment_line_id is null then
    result := internal.reverse_payment(pay.id, request.kind, request.reason);
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (pay.id, actor, request.kind, request.reason, (result->>'released_activations')::integer);
  else
    result := internal.record_staff_slot_reversal(request.payment_line_id, request.kind, request.reason);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
    where id = request.id returning * into request;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
    'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
alter function internal.approve_staff_payment_refund(uuid) owner to postgres;
revoke all on function internal.approve_staff_payment_refund(uuid) from public;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.close_staff_ozow_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; request private.payment_refund_requests;
begin
  actor := internal.staff_actor('payments:refund');
  if p_request_id is null or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'refund request and reason required' using errcode='22023';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if not found then raise exception 'refund request not found' using errcode='22023'; end if;
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must close this refund' using errcode='42501', detail='refund_closer_same';
  end if;
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||request.payment_id::text, 0));
  perform internal.lock_kept_record_subject(request.account_id, request.payment_id);
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  if internal.same_identity(actor, request.requested_by) then
    raise exception 'a different staff member must close this refund' using errcode='42501', detail='refund_closer_same';
  end if;
  if request.status = 'failed' and request.failure_reason = 'closed_by_staff' and request.closed_by = actor
      and request.close_reason = btrim(p_reason) then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'repeated', true);
  end if;
  if not coalesce((request.status = 'approved' and request.send_attempts = 0)
      or (request.status = 'sent' and request.ozow_refund_id is null and request.send_outcome = 'unknown'
        and request.sent_at < statement_timestamp() - interval '1 day'
        and request.ozow_missing_at is not null
        and request.ozow_missing_at >= request.sent_at + interval '1 day'
        -- An Ozow refund of the payment this site could not match, seen since
        -- the send, may be this one: never close while it is unexplained.
        and not exists(select 1 from private.payment_problems p where p.payment_id = request.payment_id
          and p.reason in ('refund_unmatched', 'refund_mismatch') and p.last_seen_at >= request.sent_at)), false) then
    raise exception 'only a refund that never reached Ozow can be closed' using errcode='PT409', detail='refund_not_closable';
  end if;
  update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
    failure_reason = 'closed_by_staff', closed_by = actor, close_reason = btrim(p_reason)
    where id = request.id;
  return jsonb_build_object('request_id', request.id, 'status', 'failed', 'repeated', false);
end;
$function$;
alter function internal.close_staff_ozow_refund(uuid,text) owner to postgres;
revoke all on function internal.close_staff_ozow_refund(uuid,text) from public;
grant execute on function internal.close_staff_ozow_refund(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_ozow_refund_send(p_request_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid; kind text; outcome text;
begin
  if p_request_id is null or jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'refund send result required' using errcode='22023';
  end if;
  kind := p_result->>'outcome';
  if kind is null or kind not in ('accepted', 'refused', 'unknown')
      or (kind = 'accepted' and not internal.valid_ozow_refund_fact(p_result))
      or (kind = 'refused' and coalesce(p_result->>'failure_reason', '') not in ('ozow_refused', 'ozow_auth')) then
    raise exception 'valid refund send result required' using errcode='22023';
  end if;
  select r.payment_id into payment from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(r.account_id, r.payment_id) from private.payment_refund_requests r where r.id = p_request_id;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.send_attempts = 0 then
    raise exception 'this refund was not sent' using errcode='PT409', detail='refund_not_sent';
  end if;
  if kind = 'accepted' then
    if (p_result->>'transaction_id')::uuid is distinct from request.ozow_transaction_id
        or (p_result->>'amount_cents')::bigint is distinct from request.amount_cents
        or (request.ozow_refund_id is not null and request.ozow_refund_id <> (p_result->>'refund_id')::uuid)
        or exists(select 1 from private.payment_refund_requests r where r.id <> request.id and r.status <> 'declined'
          and (r.ozow_refund_id = (p_result->>'refund_id')::uuid or lower(r.ozow_reference) = p_result->>'refund_id')) then
      perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', 'refund_send', request.id::text);
      return jsonb_build_object('request_id', request.id, 'outcome', 'mismatch', 'status', request.status,
        'ozow_refund_id', request.ozow_refund_id, 'ozow_status', request.ozow_status);
    end if;
    if request.ozow_refund_id is null then
      update private.payment_refund_requests set ozow_refund_id = (p_result->>'refund_id')::uuid,
        send_outcome = 'accepted' where id = request.id returning * into request;
    end if;
    outcome := internal.apply_ozow_refund_state(request.id, p_result->>'status',
      (p_result->>'requested_at')::timestamptz, (p_result->>'completed_at')::timestamptz, 'refund_send');
  elsif kind = 'refused' and request.status = 'sent' and request.ozow_refund_id is null
      and request.send_outcome = 'unknown' and request.send_attempts = 1 then
    update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
      failure_reason = p_result->>'failure_reason', send_outcome = 'refused' where id = request.id;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
    outcome := 'failed';
  elsif request.status = 'sent' and request.ozow_refund_id is null and request.send_outcome = 'unknown'
      and (kind = 'refused' or request.send_attempts >= 3) then
    if kind = 'refused' then
      update private.payment_refund_requests set send_attempts = 3 where id = request.id;
    end if;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_stuck', 'refund_send', request.id::text);
    outcome := 'stuck';
  else
    outcome := 'unchanged';
  end if;
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  return jsonb_build_object('request_id', request.id, 'outcome', outcome, 'status', request.status,
    'ozow_refund_id', request.ozow_refund_id, 'ozow_status', request.ozow_status);
end;
$function$;
alter function internal.record_ozow_refund_send(uuid,jsonb) owner to postgres;
revoke all on function internal.record_ozow_refund_send(uuid,jsonb) from public;
grant execute on function internal.record_ozow_refund_send(uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_status(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare refund uuid; transaction uuid; amount bigint; request private.payment_refund_requests;
  payment uuid; outcome text; source text; typed boolean := false;
begin
  source := p_event->>'source';
  if not internal.valid_ozow_refund_fact(p_event) or source is null or source not in ('refund_notice', 'refund_check') then
    raise exception 'valid Ozow refund status required' using errcode='22023';
  end if;
  refund := (p_event->>'refund_id')::uuid;
  transaction := (p_event->>'transaction_id')::uuid;
  amount := (p_event->>'amount_cents')::bigint;
  -- Which record Ozow's refund belongs to, in this order: a record holding the
  -- id that was not declined; else a typed reference equal to the id that was
  -- not declined; else the one lost send it fits; else a declined record with
  -- the id; else a declined typed reference (the last two only alert staff).
  select r.payment_id into payment from private.payment_refund_requests r
    where r.ozow_refund_id = refund and r.status <> 'declined';
  if payment is null then
    select * into request from private.payment_refund_requests r
      where r.channel = 'manual' and r.status <> 'declined' and lower(r.ozow_reference) = refund::text
      order by r.requested_at desc limit 1;
    typed := found;
    if not typed then
      select r.payment_id into payment from private.payment_refund_requests r
        where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
          (p_event->>'requested_at')::timestamptz);
      if payment is null then
        select r.payment_id into payment from private.payment_refund_requests r
          where r.ozow_refund_id = refund order by r.requested_at desc limit 1;
      end if;
      if payment is null then
        select * into request from private.payment_refund_requests r
          where r.channel = 'manual' and lower(r.ozow_reference) = refund::text
          order by r.requested_at desc limit 1;
        typed := found;
      end if;
    end if;
  end if;
  if typed then
    -- A refund recorded with a typed reference (Ozow's refund id); the record
    -- cannot carry Ozow's status. Typed on another payment than the one Ozow
    -- refunded, or Ozow pays a refund whose record was declined: staff must
    -- look. A failure or return of a refund recorded as made alerts too.
    if internal.ozow_refund_transaction(request.payment_id) is distinct from transaction
        or (request.status = 'declined' and p_event->>'status' not in ('Failed', 'Cancelled', 'Invalid', 'Error')) then
      perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', source, request.id::text);
      return jsonb_build_object('outcome', 'mismatch', 'request_id', request.id, 'status', request.status,
        'ozow_status', null);
    end if;
    if p_event->>'status' in ('Failed', 'Cancelled', 'Invalid', 'Error', 'Returned') and request.status = 'applied' then
      perform internal.ozow_refund_problem(request.payment_id,
        case when p_event->>'status' = 'Returned' then 'refund_returned' else 'refund_failed' end, source, request.id::text);
      return jsonb_build_object('outcome', 'flagged', 'request_id', request.id, 'status', request.status,
        'ozow_status', null);
    end if;
    return jsonb_build_object('outcome', 'recorded', 'request_id', request.id, 'status', request.status,
      'ozow_status', null);
  end if;
  if payment is null then
    perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
      refund::text);
    return jsonb_build_object('outcome', 'unmatched');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_kept_record_subject(p.owner_id, p.id) from private.payments p where p.id = payment;
  select * into request from private.payment_refund_requests r
    where r.ozow_refund_id = refund and r.status <> 'declined' for update;
  if not found then
    select * into request from private.payment_refund_requests r
      where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
        (p_event->>'requested_at')::timestamptz) and r.payment_id = payment
      for update;
    if found then
      update private.payment_refund_requests set ozow_refund_id = refund, send_outcome = 'accepted'
        where id = request.id returning * into request;
    else
      select * into request from private.payment_refund_requests r
        where r.ozow_refund_id = refund and r.payment_id = payment order by r.requested_at desc limit 1 for update;
    end if;
    if not found then
      perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
        refund::text);
      return jsonb_build_object('outcome', 'unmatched');
    end if;
  end if;
  if request.ozow_transaction_id is distinct from transaction or request.amount_cents <> amount then
    -- A waiting dashboard refund whose id Ozow reports for another transaction
    -- or amount is not the refund recorded: like one Ozow does not have, it
    -- is never approved.
    if request.channel = 'dashboard' and request.status = 'awaiting_approval' then
      update private.payment_refund_requests set ozow_missing_at = statement_timestamp() where id = request.id;
    end if;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', source, request.id::text);
    return jsonb_build_object('outcome', 'mismatch', 'request_id', request.id);
  end if;
  outcome := internal.apply_ozow_refund_state(request.id, p_event->>'status', (p_event->>'requested_at')::timestamptz,
    (p_event->>'completed_at')::timestamptz, source);
  select * into request from private.payment_refund_requests r where r.id = request.id;
  return jsonb_build_object('outcome', outcome, 'request_id', request.id, 'status', request.status,
    'ozow_status', request.ozow_status);
end;
$function$;
alter function internal.apply_ozow_refund_status(jsonb) owner to postgres;
revoke all on function internal.apply_ozow_refund_status(jsonb) from public;
grant execute on function internal.apply_ozow_refund_status(jsonb) to service_role;

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
      and t.status = 'awaiting_confirmation') then
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

commit;
