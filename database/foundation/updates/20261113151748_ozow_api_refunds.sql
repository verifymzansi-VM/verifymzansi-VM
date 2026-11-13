-- Staff refunds sent to Ozow by the website's server through Ozow's One API,
-- only after the existing approval rules pass; a separate admin path for a
-- refund made by hand in the Ozow dashboard; refund outcomes from Ozow's signed
-- refund notices; and a daily read-only check of Ozow's refund list.
--
-- Apply after 20261113085340_retire_old_staff_reversal_commands.sql (it
-- refuses with 55000 unless that update is applied and the staff payment fixes
-- of 20261113021223 have their reviewed bodies). Only adds: no API command,
-- argument or grant is removed or changed, and every existing refund record
-- keeps its meaning, so the website release deployed before it keeps working
-- unchanged. The website only uses the new commands while the Worker variable
-- OZOW_API_REFUNDS_ENABLED is "true". In one transaction it:
--
-- 1. Refund records (private.payment_refund_requests) gain a channel: 'manual'
--    (every existing record, and the reference commands as today), 'api'
--    (sent to Ozow by the server) and 'dashboard' (made by hand in the Ozow
--    dashboard and recorded with Ozow's refund id), and the Ozow facts of a
--    refund: the Ozow transaction refunded, Ozow's refund id (unique), its
--    status and times, and the send bookkeeping. An API refund record goes
--    awaiting_approval (above R1,000 returned on the payment, as today) ->
--    approved -> sent -> applied (Ozow reported it complete), failed or
--    returned. Its reference is "vm-refund-<record id>", which is also the
--    Idempotency-Key the server sends to Ozow, so a retried send of the same
--    record can never create a second refund at Ozow. Only one refund of a
--    payment is in flight at a time (awaiting approval, approved or sent), and
--    money in flight counts towards the R1,000 approval rule.
-- 2. New staff commands (capability payments:refund, admins only, recent
--    authenticator code; the staff member's own accepted ID review; never a
--    payment of their own identity, checked again after the lock waits):
--    api.request_staff_ozow_refund(p_payment_id, p_line_id, p_reason_code,
--    p_reason) records an API refund of a whole Ozow payment (p_line_id null)
--    or one slot; api.record_staff_dashboard_refund(p_payment_id, p_line_id,
--    p_reason_code, p_reason, p_ozow_refund_id) records a refund made in the
--    Ozow dashboard (used once) and takes effect as today's refunds do;
--    api.get_staff_ozow_refunds(p_payment_ids) lists API and dashboard refund
--    records of up to 50 payments and the API refunds that need staff.
--    api.approve_staff_payment_refund approves an API refund into "approved"
--    instead of reversing at once; everything else about it is unchanged.
-- 3. New service commands for the website's server (service_role only):
--    api.claim_ozow_refund_send(p_request_id) hands an approved API refund to
--    the sender once ("sent"); a send whose outcome is unknown may be retried
--    with the same Idempotency-Key at most twice more, five minutes apart and
--    within six hours. api.list_ozow_refund_sends_due(p_limit) lists approved
--    refunds the server has not sent and unknown sends due a retry.
--    api.record_ozow_refund_send(p_request_id, p_result) stores Ozow's answer:
--    accepted (Ozow's refund id), refused (only a first attempt; the record
--    fails and staff are alerted) or unknown. api.apply_ozow_refund_status(
--    p_event) applies a refund status read back from Ozow after a signed
--    notice: only Complete reverses the payment or slot (as today's approved
--    refund does); Failed, Error, Invalid or Cancelled fail the record and
--    Returned returns it, both with a staff alert; a refund id Ozow reports
--    that matches no record raises an alert. api.reconcile_ozow_refunds(
--    p_refunds) is the daily check: it changes no refund, and raises an alert
--    for each listed Ozow refund without a record and each API refund stuck
--    in "approved" or "sent" for more than a day. A refund id already
--    recorded in any way (also as a typed reference) never links to another
--    record, and a lost send links only to a refund Ozow says was requested
--    after it was sent. api.claim_ozow_refund_checks(p_limit) hands the
--    10-minute job sent refunds without a final answer (and each dashboard
--    refund once) to read back from Ozow; api.report_ozow_refund_missing(
--    p_request_id) records that Ozow has no such refund and alerts staff.
--    A final status is never replaced by a non-final one.
-- 3a. New staff command api.close_staff_ozow_refund(p_request_id, p_reason):
--    a staff member other than the requester closes an API refund that never
--    reached Ozow (approved and never sent, or a lost send that Ozow, read
--    more than a day later, does not have), so the payment can be refunded
--    again. Once the server has sent a refund to Ozow, a refund of an Ozow
--    payment can no longer be recorded with a typed reference
--    (ozow_reference_retired); chargebacks and payments made outside Ozow keep
--    the reference.
-- 4. Payment problems (the staff payment alert emails) gain the reasons
--    refund_failed, refund_returned, refund_unmatched, refund_stuck and
--    refund_mismatch and the sources refund_notice, refund_check and
--    refund_send (internal.record_payment_problem, full body).
-- 5. While an API refund is approved or sent, nothing else reverses that
--    payment or one of its slots (internal.payment_reversal_waiting_guard).
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release can call the new commands).
-- Read-only preflight: ../preflight/20261113151748_ozow_api_refunds.check.sql.
-- Rollback: ../rollback/20261113151748_ozow_api_refunds.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the retirement update is applied, and each function this
-- update replaces is the reviewed body before it or already this update's.
do $$
begin
  if to_regprocedure('api.record_frontend_staff_payment_reversal(uuid,text,text)') is not null
    or to_regprocedure('api.get_frontend_staff_payments(integer,text)') is not null
    or to_regclass('private.payment_refund_requests') is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment(uuid,text,text)')) is distinct from '66005adb9e06b17e689dbac47ce93d5a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)')) is distinct from '1364f8c78e36281bae5f16a4ba5a466c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.refund_needs_approval(text,bigint,bigint)')) is distinct from '7f3795506bf5dedfc96e78c6adb0b1ff'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_payment_actor(uuid,uuid)')) is distinct from 'fe81cc39557206e06346fcf5e9f33bfd'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refund_request_guard()')) not in ('ac76d0b81b37bbfc12ad483e7eadf9cf', 'd37bd25269a7848d43721e1b20b97267')
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refunded_before_cents(uuid)')) not in ('deeeb438b3d54710a061b49a4e52e9f5', 'edcb14caf62c8375f0216d828ecc276d')
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.approve_staff_payment_refund(uuid)')) not in ('f757a5e1ac7aa4a199dbcd05f5465083', 'df4585dd0d0c12f4fbf2e76d9e70a553')
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_reversal_waiting_guard()')) not in ('ee9f44cbbc9d2b70cd6db25f90dc7acb', 'd994c95ef0874bb69be72b4e54666ae7')
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_payment_problem(uuid,text,text,boolean,text)')) not in ('cd1051937fb931de8ced633770d8c9b7', '73a0ff98c9e3f2003e76349481435cba') then
    raise exception 'ozow api refunds precondition: apply 20261113085340_retire_old_staff_reversal_commands.sql first (reviewed bodies required)'
      using errcode='55000';
  end if;
end$$;

-- 1. Refund records: channel, Ozow facts and send bookkeeping.
alter table private.payment_refund_requests
  add column if not exists channel text not null default 'manual',
  add column if not exists approved_at timestamptz,
  add column if not exists ozow_transaction_id uuid,
  add column if not exists ozow_refund_id uuid,
  add column if not exists ozow_status text,
  add column if not exists ozow_status_at timestamptz,
  add column if not exists ozow_requested_at timestamptz,
  add column if not exists ozow_completed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists send_attempts integer not null default 0,
  add column if not exists last_send_at timestamptz,
  add column if not exists send_outcome text,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists returned_at timestamptz,
  add column if not exists ozow_checked_at timestamptz,
  add column if not exists ozow_missing_at timestamptz,
  add column if not exists closed_by uuid references auth.users (id) on delete restrict,
  add column if not exists close_reason text;

alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_status_check;
alter table private.payment_refund_requests add constraint payment_refund_requests_status_check
  check (status in ('awaiting_approval', 'approved', 'sent', 'applied', 'failed', 'returned', 'declined'));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_channel_check;
alter table private.payment_refund_requests add constraint payment_refund_requests_channel_check
  check (channel in ('manual', 'api', 'dashboard'));
-- What each channel may be: today's reference records only wait, apply or are
-- declined and carry no Ozow facts; a dashboard record names Ozow's refund id
-- as its reference; an API record's reference is its own Idempotency-Key.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_channel_rule;
alter table private.payment_refund_requests add constraint payment_refund_requests_channel_rule check (case channel
  when 'manual' then status in ('awaiting_approval', 'applied', 'declined') and ozow_transaction_id is null
    and ozow_refund_id is null and sent_at is null and send_attempts = 0 and send_outcome is null
  when 'dashboard' then kind = 'refunded' and status in ('awaiting_approval', 'applied', 'declined')
    and ozow_transaction_id is not null and ozow_refund_id is not null and ozow_reference = ozow_refund_id::text
    and sent_at is null and send_attempts = 0 and send_outcome is null
  else kind = 'refunded' and ozow_transaction_id is not null and ozow_reference = 'vm-refund-' || id::text
    and (sent_at is null or status in ('sent', 'applied', 'failed', 'returned'))
    and (sent_at is not null or status not in ('sent', 'applied', 'returned'))
    and (status not in ('awaiting_approval', 'declined')) = (approved_at is not null)
    and (status <> 'applied' or ozow_refund_id is not null)
  end);
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_send_state;
alter table private.payment_refund_requests add constraint payment_refund_requests_send_state check (
  send_attempts between 0 and 3 and (send_attempts = 0) = (last_send_at is null)
  and (send_attempts = 0) = (send_outcome is null)
  and (send_outcome is null or send_outcome in ('unknown', 'accepted', 'refused')));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_ozow_status_check;
alter table private.payment_refund_requests add constraint payment_refund_requests_ozow_status_check check (
  (ozow_status is null) = (ozow_status_at is null)
  and (ozow_status is null or ozow_status in ('Pending', 'Submitted', 'Complete', 'Failed', 'Cancelled', 'Returned',
    'Invalid', 'PendingInvestigation', 'Error')));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_failed;
alter table private.payment_refund_requests add constraint payment_refund_requests_failed check (
  (status = 'failed') = (failed_at is not null and failure_reason is not null)
  and (failure_reason is null or failure_reason in ('ozow_refused', 'ozow_auth', 'ozow_failed', 'ozow_cancelled',
    'ozow_invalid', 'payment_changed', 'closed_by_staff')));
-- A refund through Ozow that never reached Ozow is closed by a staff member
-- other than its requester, with a reason.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_closed;
alter table private.payment_refund_requests add constraint payment_refund_requests_closed check (
  (failure_reason is not distinct from 'closed_by_staff') = (closed_by is not null and close_reason is not null)
  and (closed_by is null or closed_by <> requested_by)
  and (close_reason is null or internal.plain_text_valid(close_reason, 5, 500, true)));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_returned;
alter table private.payment_refund_requests add constraint payment_refund_requests_returned check (
  (status = 'returned') = (returned_at is not null));
-- A second staff member approves exactly when the approval rule says so; an
-- approved API refund keeps its approver while it is sent and settled.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_approver;
alter table private.payment_refund_requests add constraint payment_refund_requests_approver check (
  case when needs_approval and status not in ('awaiting_approval', 'declined')
    then approved_by is not null and approved_by <> requested_by else approved_by is null end);

create unique index if not exists payment_refund_requests_ozow_refund_idx on private.payment_refund_requests
  (ozow_refund_id) where ozow_refund_id is not null;
-- One refund of a payment in flight at a time.
create unique index if not exists payment_refund_requests_in_flight_idx on private.payment_refund_requests (payment_id)
  where status in ('awaiting_approval', 'approved', 'sent');
-- An Ozow refund is recorded once, whichever way it was recorded (its id, or
-- a typed reference equal to it).
create unique index if not exists payment_refund_requests_ozow_key_idx on private.payment_refund_requests
  (lower(coalesce(ozow_refund_id::text, ozow_reference)));
create index if not exists payment_refund_requests_transaction_idx on private.payment_refund_requests
  (ozow_transaction_id) where ozow_transaction_id is not null;
create index if not exists payment_refund_requests_send_due_idx on private.payment_refund_requests (status, last_send_at)
  where channel = 'api' and status in ('approved', 'sent');
create index if not exists payment_refund_requests_closed_by_idx on private.payment_refund_requests (closed_by)
  where closed_by is not null;

-- The Ozow transaction an Ozow refund is raised against: the transaction id of
-- an Ozow payment, when it is Ozow's (a UUID). Null for anything else. Callers
-- check the payment's status themselves.
CREATE OR REPLACE FUNCTION internal.ozow_refund_transaction(p_payment_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select lower(p.provider_transaction_id)::uuid from private.payments p
  where p.id = p_payment_id and p.provider = 'ozow'
    and p.provider_transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$function$;
alter function internal.ozow_refund_transaction(uuid) owner to postgres;
revoke all on function internal.ozow_refund_transaction(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed text[]; allowed text[];
  ozow_facts constant text[] := array['ozow_refund_id','ozow_status','ozow_status_at','ozow_requested_at',
    'ozow_completed_at','send_outcome','ozow_checked_at','ozow_missing_at'];
begin
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
        where r.ozow_refund_id::text = lower(btrim(new.ozow_reference))) then
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
revoke all on function internal.payment_refund_request_guard() from public, anon, authenticated, service_role;

-- Money returned, waiting to be returned or on its way back on a payment:
-- every applied, waiting, approved or sent refund or chargeback record, plus
-- slots reversed without one (the earlier single-slot command), but never the
-- slots of a payment reversed whole by a record (that record already counts
-- them). Failed, returned and declined records returned nothing.
CREATE OR REPLACE FUNCTION internal.payment_refunded_before_cents(p_payment_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
      where r.payment_id = p_payment_id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0)
    + coalesce((select sum(l.amount_cents) from private.payment_lines l
      where l.payment_id = p_payment_id and l.status = 'reversed'
        and not exists(select 1 from private.payment_refund_requests r
          where r.status = 'applied' and r.payment_id = p_payment_id
            and (r.payment_line_id = l.id or r.payment_line_id is null))), 0)::bigint;
$function$;
alter function internal.payment_refunded_before_cents(uuid) owner to postgres;
revoke all on function internal.payment_refunded_before_cents(uuid) from public, anon, authenticated, service_role;

-- While a refund of a payment waits for a second staff member, or an API
-- refund of it is approved or on its way to Ozow, nothing else may reverse that
-- payment or one of its slots. Its own approval or completion marks the record
-- applied before it reverses, so it passes.
CREATE OR REPLACE FUNCTION internal.payment_reversal_waiting_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare payment uuid := (case when tg_table_name = 'payments' then to_jsonb(new)->>'id'
  else to_jsonb(new)->>'payment_id' end)::uuid;
begin
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if exists(select 1 from private.payment_refund_requests r
      where r.payment_id = payment and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  return new;
end;
$function$;
alter function internal.payment_reversal_waiting_guard() owner to postgres;
revoke all on function internal.payment_reversal_waiting_guard() from public, anon, authenticated, service_role;

-- One slot reversed for a refund Ozow completed: the single-slot reversal
-- without a staff session (the server applies it from Ozow's status), audited
-- as the staff member who approved the refund (or recorded it, when it needed
-- no second approver).
CREATE OR REPLACE FUNCTION internal.reverse_payment_line(p_line_id uuid, p_kind text, p_reason text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare line private.payment_lines; pay private.payments; ent private.entitlements;
  released integer := 0; v_post_ids uuid[] := '{}'::uuid[]; open_left integer; c record;
begin
  if p_line_id is null or p_actor is null or p_kind is null or p_kind not in ('refunded', 'chargeback')
    or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'valid slot reversal and reason required' using errcode='22023';
  end if;
  select p.* into pay from private.payments p join private.payment_lines l on l.payment_id = p.id where l.id = p_line_id
    for update of p;
  select * into line from private.payment_lines l where l.id = p_line_id for update;
  if not found or line.status <> 'open' or pay.status <> 'complete' then
    raise exception 'only an open slot of a completed payment can be reversed' using errcode='PT409', detail='payment_not_refundable';
  end if;
  begin
    select * into ent from private.entitlements e where e.payment_line_id = line.id for update nowait;
    perform p.id from private.posts p where p.id in
      (select a.post_id from private.post_activations a where a.entitlement_id = ent.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payment_lines set status = 'reversed', reversal_kind = p_kind, reversal_reason = btrim(p_reason),
    reversed_at = statement_timestamp(), reversed_by = p_actor where id = line.id;
  if ent.id is not null then
    update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind
      where id = ent.id and status <> 'revoked';
    with released_rows as (
      update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
      where a.entitlement_id = ent.id and a.released_at is null
      returning a.post_id
    )
    select coalesce(array_agg(post_id), '{}') into v_post_ids from released_rows;
    released := cardinality(v_post_ids);
    update private.posts p set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
      where p.id = any(v_post_ids) and (p.status in ('live', 'pending_moderation')
        or (p.status = 'paused' and not exists(select 1 from private.frontend_content_holds h
          where h.post_id = p.id and h.released_at is null)));
    update private.post_search_documents set is_visible = false where post_id = any(v_post_ids);
  end if;
  -- Only this slot's commission.
  for c in select x.id, p.account_id from private.partner_commissions x join private.partners p on p.id = x.partner_id
      where x.payment_line_id = line.id and x.status <> 'reversed' for update of x loop
    update private.partner_commissions set status = 'reversed', reversed_at = statement_timestamp(),
      reversal_reason = 'Slot payment ' || p_kind where id = c.id;
    perform internal.notify_account(c.account_id, 'partner_commission_reversed', c.id, null, null);
  end loop;
  select count(*) into open_left from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
  if open_left = 0 then
    -- Every slot is reversed: so is the payment (its commission trigger finds nothing left).
    update private.payments set status = p_kind, fulfillment_status = 'reversed', status_changed_at = statement_timestamp()
      where id = pay.id;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_line_reversed:' || line.id);
  return jsonb_build_object('status', p_kind, 'line_id', line.id, 'released_activations', released,
    'payment_status', case when open_left = 0 then p_kind else pay.status end);
end;
$function$;
alter function internal.reverse_payment_line(uuid,text,text,uuid) owner to postgres;
revoke all on function internal.reverse_payment_line(uuid,text,text,uuid) from public, anon, authenticated, service_role;

-- 2. Payment problems: refund outcomes that need staff.
alter table private.payment_problems drop constraint if exists payment_problems_reason_check;
alter table private.payment_problems add constraint payment_problems_reason_check check (reason in (
  'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch', 'test_mode_mismatch',
  'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch', 'currency_mismatch', 'missing_amount',
  'missing_currency', 'amount_mismatch', 'invalid_json', 'missing_merchant_reference', 'missing_transaction_status',
  'unknown_payment', 'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
  'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion', 'multiple_settlements',
  'refund_failed', 'refund_returned', 'refund_unmatched', 'refund_stuck', 'refund_mismatch'));
alter table private.payment_problems drop constraint if exists payment_problems_source_check;
alter table private.payment_problems add constraint payment_problems_source_check check (source in (
  'notice', 'status_check', 'refund_notice', 'refund_check', 'refund_send'));

CREATE OR REPLACE FUNCTION internal.record_payment_problem(p_payment_id uuid, p_reason text, p_source text, p_alert boolean, p_transaction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare problem private.payment_problems; alert boolean; raise_now boolean; rearm boolean;
begin
  if p_reason is null or p_reason not in (
      'unsupported_transaction_status', 'merchant_reference_mismatch', 'site_code_mismatch',
      'test_mode_mismatch', 'missing_transaction_id', 'payment_id_mismatch', 'transaction_id_mismatch',
      'currency_mismatch', 'missing_amount', 'missing_currency', 'amount_mismatch',
      'invalid_json', 'missing_merchant_reference', 'missing_transaction_status', 'unknown_payment',
      'unknown_reference', 'request_mismatch', 'missing_transaction', 'conflicting_transaction',
      'transaction_reused', 'complete_unfulfillable_target', 'refunded_after_completion',
      'multiple_settlements', 'refund_failed', 'refund_returned', 'refund_unmatched', 'refund_stuck',
      'refund_mismatch')
    or p_source is null or p_source not in ('notice', 'status_check', 'refund_notice', 'refund_check', 'refund_send')
    or p_alert is null or length(p_transaction) not between 1 and 100 then
    raise exception 'invalid payment problem' using errcode='22023';
  end if;
  if p_payment_id is not null and not exists(select 1 from private.payments p where p.id=p_payment_id) then
    raise exception 'payment problem names no payment' using errcode='22023';
  end if;
  -- Only a problem with a known payment can be emailed about.
  alert := p_alert and p_payment_id is not null;
  insert into private.payment_problems(payment_id, reason, source, needs_alert, alert_raised_at, alert_transaction)
    values (p_payment_id, p_reason, p_source, alert, case when alert then clock_timestamp() end,
      case when alert then p_transaction end)
    on conflict on constraint payment_problems_once do nothing
    returning * into problem;
  if found then
    return jsonb_build_object('id',problem.id,'new',true,'alert',problem.needs_alert,'raised',problem.needs_alert);
  end if;
  select * into problem from private.payment_problems p
    where p.reason=p_reason
      and (p.payment_id=p_payment_id or (p_payment_id is null and p.payment_id is null))
    for update;
  -- Seen before: the first source and first time stay; the mark only rises.
  -- Once emailed, a marked repeat from another Ozow transaction (or another
  -- refund record) raises it again (at most 5 times); the same one never does.
  raise_now := alert and not problem.needs_alert;
  rearm := alert and problem.needs_alert and problem.alerted_at is not null and p_transaction is not null
    and problem.alert_transaction is distinct from p_transaction and problem.alert_rearms<5;
  update private.payment_problems p set last_seen_at=clock_timestamp(),
      occurrences=least(p.occurrences,2147483646)+1,
      needs_alert=p.needs_alert or alert,
      alert_raised_at=case when raise_now or rearm then clock_timestamp() else p.alert_raised_at end,
      alert_transaction=case when raise_now or rearm then p_transaction else p.alert_transaction end,
      alert_rearms=p.alert_rearms+case when rearm then 1 else 0 end,
      alerted_at=case when rearm then null else p.alerted_at end,
      alert_claim=case when rearm then null else p.alert_claim end,
      alert_claimed_until=case when rearm then null else p.alert_claimed_until end,
      alert_snapshot=case when rearm then null else p.alert_snapshot end
    where p.id=problem.id
    returning * into problem;
  return jsonb_build_object('id',problem.id,'new',false,'alert',problem.needs_alert,'raised',raise_now or rearm);
end;
$function$;
alter function internal.record_payment_problem(uuid,text,text,boolean,text) owner to postgres;
revoke all on function internal.record_payment_problem(uuid,text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_payment_problem(uuid,text,text,boolean,text) to service_role;

-- A refund problem for staff: alerted when it names a payment; the record id
-- (or Ozow's refund id) is the key that raises it again for another refund.
CREATE OR REPLACE FUNCTION internal.ozow_refund_problem(p_payment_id uuid, p_reason text, p_source text, p_key text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select null::void from internal.record_payment_problem(p_payment_id, p_reason, p_source, true, p_key);
$function$;
alter function internal.ozow_refund_problem(uuid,text,text,text) owner to postgres;
revoke all on function internal.ozow_refund_problem(uuid,text,text,text) from public, anon, authenticated, service_role;

-- 3. Staff commands. The shared rules of an API or dashboard refund record.
CREATE OR REPLACE FUNCTION internal.record_staff_ozow_refund(p_channel text, p_payment_id uuid, p_line_id uuid,
  p_reason_code text, p_reason text, p_ozow_refund_id uuid)
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
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  if p_line_id is not null and not exists(select 1 from private.payment_lines l
      where l.id = p_line_id and l.payment_id = payment) then
    raise exception 'slot payment line not found' using errcode='22023';
  end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = payment for update;
  if p_line_id is not null then
    select * into line from private.payment_lines l where l.id = p_line_id for update;
  end if;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- A repeat of the same request by the same staff member returns its state.
  if p_channel = 'dashboard' then
    select * into prior from private.payment_refund_requests r where r.ozow_refund_id = p_ozow_refund_id;
    if not found then
      select * into prior from private.payment_refund_requests r where lower(r.ozow_reference) = p_ozow_refund_id::text;
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
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  approval := internal.refund_needs_approval('refunded', refunded_before, amount);
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
      case when p_channel = 'api' then 'vm-refund-' || new_id::text else p_ozow_refund_id::text end,
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
alter function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid) owner to postgres;
revoke all on function internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.request_staff_ozow_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text,
  p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_ozow_refund('api', p_payment_id, p_line_id, p_reason_code, p_reason, null);
$function$;
alter function internal.request_staff_ozow_refund(uuid,uuid,text,text) owner to postgres;
revoke all on function internal.request_staff_ozow_refund(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.request_staff_ozow_refund(uuid,uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.request_staff_ozow_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text,
  p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.request_staff_ozow_refund(p_payment_id, p_line_id, p_reason_code, p_reason);
$function$;
alter function api.request_staff_ozow_refund(uuid,uuid,text,text) owner to postgres;
revoke all on function api.request_staff_ozow_refund(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.request_staff_ozow_refund(uuid,uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.record_staff_dashboard_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text,
  p_reason text, p_ozow_refund_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_ozow_refund('dashboard', p_payment_id, p_line_id, p_reason_code, p_reason, p_ozow_refund_id);
$function$;
alter function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) owner to postgres;
revoke all on function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_dashboard_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text,
  p_reason text, p_ozow_refund_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_dashboard_refund(p_payment_id, p_line_id, p_reason_code, p_reason, p_ozow_refund_id);
$function$;
alter function api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) owner to postgres;
revoke all on function api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_dashboard_refund(uuid,uuid,text,text,uuid) to authenticated;

-- A second, different staff member approves a waiting refund: a reference or
-- dashboard refund takes effect now; an API refund becomes approved, for the
-- server to send to Ozow.
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
  perform internal.lock_evidence_subject(request.account_id);
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
revoke all on function internal.approve_staff_payment_refund(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;

-- One refund record as staff see it (no account or contact details).
CREATE OR REPLACE FUNCTION internal.staff_ozow_refund_view(p_request private.payment_refund_requests, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id', p_request.id, 'payment_id', p_request.payment_id, 'line_id', p_request.payment_line_id,
    'channel', p_request.channel, 'status', p_request.status, 'amount_cents', p_request.amount_cents,
    'reason_code', p_request.reason_code, 'needs_approval', p_request.needs_approval,
    'requested_at', p_request.requested_at, 'approved_at', p_request.approved_at, 'sent_at', p_request.sent_at,
    'applied_at', p_request.applied_at, 'failed_at', p_request.failed_at, 'returned_at', p_request.returned_at,
    'failure_reason', p_request.failure_reason, 'ozow_refund_id', p_request.ozow_refund_id,
    'ozow_status', p_request.ozow_status, 'ozow_status_at', p_request.ozow_status_at,
    'send_outcome', p_request.send_outcome, 'send_attempts', p_request.send_attempts,
    'ozow_missing_at', p_request.ozow_missing_at,
    'requested_by_me', internal.same_identity(p_request.requested_by, p_actor));
$function$;
alter function internal.staff_ozow_refund_view(private.payment_refund_requests,uuid) owner to postgres;
revoke all on function internal.staff_ozow_refund_view(private.payment_refund_requests,uuid) from public, anon, authenticated, service_role;

-- API and dashboard refund records of up to 50 payments, which of them can be
-- refunded through Ozow, and the API refunds that need staff: failed or
-- returned in the last 30 days with no later refund of the payment, or
-- approved or sent for more than a day.
CREATE OR REPLACE FUNCTION internal.get_staff_ozow_refunds(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  if p_payment_ids is null or cardinality(p_payment_ids) > 50 or array_position(p_payment_ids, null) is not null then
    raise exception 'up to 50 payments required' using errcode='22023';
  end if;
  select jsonb_build_object(
    -- Once a refund was sent through Ozow, Ozow payments are refunded through
    -- Ozow or recorded from the dashboard, never with a typed reference.
    'typed_reference_retired', exists(select 1 from private.payment_refund_requests r
      where r.channel = 'api' and r.send_attempts > 0),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.id,
        'ozow_refundable', p.status = 'complete' and internal.ozow_refund_transaction(p.id) is not null) order by p.id)
      from private.payments p where p.id = any(p_payment_ids)), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(internal.staff_ozow_refund_view(r, actor) order by r.requested_at, r.id)
      from private.payment_refund_requests r
      where r.payment_id = any(p_payment_ids) and r.channel in ('api', 'dashboard')), '[]'::jsonb),
    'attention', coalesce((select jsonb_agg(internal.staff_ozow_refund_view(a, actor) order by a.requested_at, a.id)
      from (select r.* from private.payment_refund_requests r
        where r.channel = 'api' and (
          (r.status in ('failed', 'returned') and coalesce(r.failed_at, r.returned_at) > statement_timestamp() - interval '30 days'
            and not exists(select 1 from private.payment_refund_requests n where n.payment_id = r.payment_id
              and n.requested_at > r.requested_at and n.status in ('awaiting_approval', 'approved', 'sent', 'applied')))
          or (r.status = 'approved' and r.approved_at < statement_timestamp() - interval '1 day')
          or (r.status = 'sent' and r.sent_at < statement_timestamp() - interval '1 day'))
        order by r.requested_at, r.id limit 20) a), '[]'::jsonb))
    into result;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_ozow_refunds(uuid[]) owner to postgres;
revoke all on function internal.get_staff_ozow_refunds(uuid[]) from public, anon, authenticated, service_role;
grant execute on function internal.get_staff_ozow_refunds(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_ozow_refunds(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_ozow_refunds(p_payment_ids);
$function$;
alter function api.get_staff_ozow_refunds(uuid[]) owner to postgres;
revoke all on function api.get_staff_ozow_refunds(uuid[]) from public, anon, authenticated, service_role;
grant execute on function api.get_staff_ozow_refunds(uuid[]) to authenticated;

-- 4. Service commands for the website's server.
-- The sender takes an approved API refund once ("sent"). A send whose outcome
-- is unknown (no answer, a server error) may be taken again, with the same
-- Idempotency-Key, at most twice more, five minutes apart and within six
-- hours; Ozow returns the refund it already made for that key. A payment that
-- changed before the first send fails the record without contacting Ozow.
CREATE OR REPLACE FUNCTION internal.claim_ozow_refund_send(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid;
begin
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select r.payment_id into payment from private.payment_refund_requests r where r.id = p_request_id and r.channel = 'api';
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.status = 'approved' then
    if (select p.status from private.payments p where p.id = request.payment_id) is distinct from 'complete'
        or internal.ozow_refund_transaction(request.payment_id) is distinct from request.ozow_transaction_id
        or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = request.payment_id)
        or (request.payment_line_id is null and exists(select 1 from private.payment_lines l
          where l.payment_id = request.payment_id and l.status = 'reversed'))
        or (request.payment_line_id is not null and not exists(select 1 from private.payment_lines l
          where l.id = request.payment_line_id and l.status = 'open')) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'payment_changed' where id = request.id returning * into request;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
      return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
    end if;
    update private.payment_refund_requests set status = 'sent', sent_at = statement_timestamp(), send_attempts = 1,
      last_send_at = statement_timestamp(), send_outcome = 'unknown' where id = request.id returning * into request;
  elsif request.status = 'sent' and request.send_outcome = 'unknown' and request.ozow_refund_id is null
      and request.send_attempts < 3 and request.last_send_at <= statement_timestamp() - interval '5 minutes'
      and request.sent_at > statement_timestamp() - interval '6 hours' then
    update private.payment_refund_requests set send_attempts = send_attempts + 1, last_send_at = statement_timestamp()
      where id = request.id returning * into request;
  else
    return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
  end if;
  return jsonb_build_object('request_id', request.id, 'claimed', true, 'status', request.status,
    'attempt', request.send_attempts, 'idempotency_key', request.ozow_reference,
    'transaction_id', request.ozow_transaction_id, 'amount_cents', request.amount_cents,
    'reason_code', request.reason_code);
end;
$function$;
alter function internal.claim_ozow_refund_send(uuid) owner to postgres;
revoke all on function internal.claim_ozow_refund_send(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.claim_ozow_refund_send(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.claim_ozow_refund_send(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_ozow_refund_send(p_request_id);
$function$;
alter function api.claim_ozow_refund_send(uuid) owner to postgres;
revoke all on function api.claim_ozow_refund_send(uuid) from public, anon, authenticated, service_role;
grant execute on function api.claim_ozow_refund_send(uuid) to service_role;

-- Approved API refunds not sent for two minutes (the approval's own send did
-- not happen) and unknown sends due a retry; oldest first, bounded.
CREATE OR REPLACE FUNCTION internal.list_ozow_refund_sends_due(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'invalid refund send limit' using errcode='22023';
  end if;
  return coalesce((select jsonb_agg(d.id order by d.due_at, d.id) from (
      select r.id, coalesce(r.last_send_at, r.approved_at) as due_at from private.payment_refund_requests r
      where r.channel = 'api' and ((r.status = 'approved' and r.approved_at <= statement_timestamp() - interval '2 minutes')
        or (r.status = 'sent' and r.send_outcome = 'unknown' and r.ozow_refund_id is null and r.send_attempts < 3
          and r.last_send_at <= statement_timestamp() - interval '5 minutes'
          and r.sent_at > statement_timestamp() - interval '6 hours'))
      order by 2, 1 limit p_limit) d), '[]'::jsonb);
end;
$function$;
alter function internal.list_ozow_refund_sends_due(integer) owner to postgres;
revoke all on function internal.list_ozow_refund_sends_due(integer) from public, anon, authenticated, service_role;
grant execute on function internal.list_ozow_refund_sends_due(integer) to service_role;

CREATE OR REPLACE FUNCTION api.list_ozow_refund_sends_due(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_ozow_refund_sends_due(p_limit);
$function$;
alter function api.list_ozow_refund_sends_due(integer) owner to postgres;
revoke all on function api.list_ozow_refund_sends_due(integer) from public, anon, authenticated, service_role;
grant execute on function api.list_ozow_refund_sends_due(integer) to service_role;

-- Applies a refund status Ozow reported for a record the caller has locked.
-- Only Complete reverses: the whole payment (as an approved refund does) or
-- the one slot. Failed, Error, Invalid and Cancelled fail an API refund on its
-- way and Returned returns it, both with a staff alert. A record that already
-- settled never changes again; a later Returned or Failed of a completed or
-- dashboard refund, or a Complete of a refund marked failed, alerts staff.
CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_state(p_request_id uuid, p_status text, p_requested_at timestamptz,
  p_completed_at timestamptz, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; outcome text; result jsonb; actor uuid;
begin
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  outcome := case when p_status = 'Complete' then 'complete' when p_status = 'Returned' then 'returned'
    when p_status in ('Failed', 'Error', 'Invalid', 'Cancelled') then 'failed' else 'pending' end;
  -- The same status again (a repeated notice, a retried send, the daily
  -- check) was applied before: nothing changes and nobody is alerted twice.
  if request.ozow_status is not distinct from p_status then
    return 'unchanged';
  end if;
  -- A final status Ozow already gave is never replaced by a non-final one (an
  -- answer that arrives after the notice, or an older list entry).
  if outcome = 'pending' and request.ozow_status in ('Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid', 'Error') then
    return 'unchanged';
  end if;
  update private.payment_refund_requests set ozow_status = p_status, ozow_status_at = statement_timestamp(),
    ozow_requested_at = coalesce(ozow_requested_at, p_requested_at),
    ozow_completed_at = coalesce(ozow_completed_at, case when outcome = 'complete' then p_completed_at end)
    where id = request.id returning * into request;
  if request.channel = 'api' and request.status = 'sent' then
    if outcome = 'complete' then
      actor := coalesce(request.approved_by, request.requested_by);
      -- The record is applied first, so the reversal is no longer held back by
      -- internal.payment_reversal_waiting_guard; one transaction.
      update private.payment_refund_requests set status = 'applied', applied_at = statement_timestamp(),
        send_outcome = 'accepted' where id = request.id;
      if request.payment_line_id is null then
        result := internal.reverse_payment(request.payment_id, 'refunded', request.reason);
        insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
          values (request.payment_id, actor, 'refunded', request.reason, (result->>'released_activations')::integer);
      else
        result := internal.reverse_payment_line(request.payment_line_id, 'refunded', request.reason, actor);
      end if;
      update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
        where id = request.id;
      return 'applied';
    elsif outcome = 'failed' then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = case p_status when 'Cancelled' then 'ozow_cancelled' when 'Invalid' then 'ozow_invalid'
          else 'ozow_failed' end, send_outcome = 'accepted'
        where id = request.id;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', p_source, request.id::text);
      return 'failed';
    elsif outcome = 'returned' then
      update private.payment_refund_requests set status = 'returned', returned_at = statement_timestamp(),
        send_outcome = 'accepted' where id = request.id;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_returned', p_source, request.id::text);
      return 'returned';
    end if;
    return 'pending';
  end if;
  -- A record that already settled (or a dashboard record) never changes again:
  -- staff are told when Ozow's outcome contradicts it.
  if outcome = 'returned' and request.status <> 'returned' then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_returned', p_source, request.id::text);
    return 'flagged';
  end if;
  if outcome = 'failed' and request.status not in ('failed', 'declined') then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', p_source, request.id::text);
    return 'flagged';
  end if;
  if outcome = 'complete' and request.status in ('failed', 'returned', 'declined') then
    perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', p_source, request.id::text);
    return 'flagged';
  end if;
  return 'recorded';
end;
$function$;
alter function internal.apply_ozow_refund_state(uuid,text,timestamptz,timestamptz,text) owner to postgres;
revoke all on function internal.apply_ozow_refund_state(uuid,text,timestamptz,timestamptz,text) from public, anon, authenticated, service_role;

-- One Ozow refund as the server read it from Ozow: a refund id, the
-- transaction refunded, the amount in cents, Ozow's status and times.
CREATE OR REPLACE FUNCTION internal.valid_ozow_refund_fact(p_fact jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_typeof(p_fact) = 'object'
    and p_fact->>'refund_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_fact->>'transaction_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(p_fact->'amount_cents') = 'number' and p_fact->>'amount_cents' ~ '^[1-9][0-9]{0,11}$'
    and p_fact->>'status' in ('Pending', 'Submitted', 'Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid',
      'PendingInvestigation', 'Error')
    and (p_fact->'requested_at' is null or jsonb_typeof(p_fact->'requested_at') = 'null'
      or p_fact->>'requested_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$')
    and (p_fact->'completed_at' is null or jsonb_typeof(p_fact->'completed_at') = 'null'
      or p_fact->>'completed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$'), false);
$function$;
alter function internal.valid_ozow_refund_fact(jsonb) owner to postgres;
revoke all on function internal.valid_ozow_refund_fact(jsonb) from public, anon, authenticated, service_role;

-- The completed Ozow payment of an Ozow transaction, if this site has it.
CREATE OR REPLACE FUNCTION internal.ozow_transaction_payment(p_transaction uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p.id from private.payments p
  where p.provider = 'ozow' and lower(p.provider_transaction_id) = p_transaction::text;
$function$;
alter function internal.ozow_transaction_payment(uuid) owner to postgres;
revoke all on function internal.ozow_transaction_payment(uuid) from public, anon, authenticated, service_role;

-- The one API refund an Ozow refund without a known id can belong to: sent
-- with no answer yet, the same transaction and amount, and requested by Ozow
-- no earlier than ten minutes before this site sent it. A refund id already
-- recorded in any way, or a refund Ozow gives no request time for, never
-- links. Null unless exactly one record fits.
CREATE OR REPLACE FUNCTION internal.ozow_refund_link_candidate(p_refund uuid, p_transaction uuid, p_amount bigint,
  p_requested_at timestamptz)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when count(*) = 1 then min(r.id::text)::uuid end
  from private.payment_refund_requests r
  where p_requested_at is not null
    and r.channel = 'api' and r.status = 'sent' and r.ozow_refund_id is null
    and r.ozow_transaction_id = p_transaction and r.amount_cents = p_amount
    and p_requested_at >= r.sent_at - interval '10 minutes'
    and not exists(select 1 from private.payment_refund_requests x
      where x.ozow_refund_id = p_refund or lower(x.ozow_reference) = p_refund::text);
$function$;
alter function internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamptz) owner to postgres;
revoke all on function internal.ozow_refund_link_candidate(uuid,uuid,bigint,timestamptz) from public, anon, authenticated, service_role;

-- Stores Ozow's answer to a send of an API refund.
--  accepted: Ozow's refund for this record (its transaction and amount), then
--    its status as Ozow gave it;
--  refused: Ozow refused the first send (nothing was created): the record
--    fails and staff are alerted. A refused retry proves nothing about the
--    first send, so it only stops further retries and alerts staff;
--  unknown: nothing changes; after the last attempt staff are alerted.
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
  perform internal.lock_evidence_subject(r.account_id) from private.payment_refund_requests r where r.id = p_request_id;
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.send_attempts = 0 then
    raise exception 'this refund was not sent' using errcode='PT409', detail='refund_not_sent';
  end if;
  if kind = 'accepted' then
    if (p_result->>'transaction_id')::uuid is distinct from request.ozow_transaction_id
        or (p_result->>'amount_cents')::bigint is distinct from request.amount_cents
        or (request.ozow_refund_id is not null and request.ozow_refund_id <> (p_result->>'refund_id')::uuid)
        or exists(select 1 from private.payment_refund_requests r where r.id <> request.id
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
revoke all on function internal.record_ozow_refund_send(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.record_ozow_refund_send(uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION api.record_ozow_refund_send(p_request_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_ozow_refund_send(p_request_id, p_result);
$function$;
alter function api.record_ozow_refund_send(uuid,jsonb) owner to postgres;
revoke all on function api.record_ozow_refund_send(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function api.record_ozow_refund_send(uuid,jsonb) to service_role;

-- A refund status the server read back from Ozow (after a signed refund
-- notice): the record with Ozow's refund id, or the one API refund of that
-- transaction and amount sent without an answer, which it then names; a
-- refund matching no record alerts staff.
CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_status(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare refund uuid; transaction uuid; amount bigint; request private.payment_refund_requests;
  payment uuid; outcome text; source text;
begin
  source := p_event->>'source';
  if not internal.valid_ozow_refund_fact(p_event) or source is null or source not in ('refund_notice', 'refund_check') then
    raise exception 'valid Ozow refund status required' using errcode='22023';
  end if;
  refund := (p_event->>'refund_id')::uuid;
  transaction := (p_event->>'transaction_id')::uuid;
  amount := (p_event->>'amount_cents')::bigint;
  -- A refund recorded with a typed reference (Ozow's refund id) is known; the
  -- record cannot carry Ozow's status, so only a failure or return alerts.
  select * into request from private.payment_refund_requests r
    where r.channel = 'manual' and lower(r.ozow_reference) = refund::text;
  if found then
    if p_event->>'status' in ('Failed', 'Cancelled', 'Invalid', 'Error', 'Returned') and request.status = 'applied' then
      perform internal.ozow_refund_problem(request.payment_id,
        case when p_event->>'status' = 'Returned' then 'refund_returned' else 'refund_failed' end, source, request.id::text);
      return jsonb_build_object('outcome', 'flagged', 'request_id', request.id, 'status', request.status,
        'ozow_status', null);
    end if;
    return jsonb_build_object('outcome', 'recorded', 'request_id', request.id, 'status', request.status,
      'ozow_status', null);
  end if;
  select r.payment_id into payment from private.payment_refund_requests r where r.ozow_refund_id = refund;
  if payment is null then
    select r.payment_id into payment from private.payment_refund_requests r
      where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
        (p_event->>'requested_at')::timestamptz);
  end if;
  if payment is null then
    perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
      refund::text);
    return jsonb_build_object('outcome', 'unmatched');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(p.owner_id) from private.payments p where p.id = payment;
  select * into request from private.payment_refund_requests r where r.ozow_refund_id = refund for update;
  if not found then
    select * into request from private.payment_refund_requests r
      where r.id = internal.ozow_refund_link_candidate(refund, transaction, amount,
        (p_event->>'requested_at')::timestamptz) and r.payment_id = payment
      for update;
    if not found then
      perform internal.ozow_refund_problem(internal.ozow_transaction_payment(transaction), 'refund_unmatched', source,
        refund::text);
      return jsonb_build_object('outcome', 'unmatched');
    end if;
    update private.payment_refund_requests set ozow_refund_id = refund, send_outcome = 'accepted'
      where id = request.id returning * into request;
  end if;
  if request.ozow_transaction_id is distinct from transaction or request.amount_cents <> amount then
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
revoke all on function internal.apply_ozow_refund_status(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.apply_ozow_refund_status(jsonb) to service_role;

CREATE OR REPLACE FUNCTION api.apply_ozow_refund_status(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.apply_ozow_refund_status(p_event);
$function$;
alter function api.apply_ozow_refund_status(jsonb) owner to postgres;
revoke all on function api.apply_ozow_refund_status(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.apply_ozow_refund_status(jsonb) to service_role;

-- The daily check against Ozow's refund list (up to 2,000 refunds read from
-- Ozow by date). Read only for refunds: it changes no record. It alerts staff
-- for each Ozow refund with no record of ours (an API refund still waiting for
-- Ozow's answer on the same transaction and amount is not one), each record
-- whose Ozow transaction or amount differs from Ozow's, and each API refund
-- approved or sent more than a day ago that has not settled.
CREATE OR REPLACE FUNCTION internal.reconcile_ozow_refunds(p_refunds jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare item jsonb; request private.payment_refund_requests; unmatched integer := 0; mismatched integer := 0;
  stuck integer := 0; checked integer := 0;
begin
  if jsonb_typeof(p_refunds) is distinct from 'array' or jsonb_array_length(p_refunds) > 2000 then
    raise exception 'up to 2000 Ozow refunds required' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_refunds) loop
    if not internal.valid_ozow_refund_fact(item) then
      raise exception 'valid Ozow refund required' using errcode='22023';
    end if;
    checked := checked + 1;
    select * into request from private.payment_refund_requests r
      where r.ozow_refund_id = (item->>'refund_id')::uuid
        or (r.channel = 'manual' and lower(r.ozow_reference) = item->>'refund_id');
    if found then
      -- Known, but Ozow's transaction or amount differs, or Ozow paid (or is
      -- paying) a refund whose record was declined or failed.
      if (request.channel <> 'manual' and (request.ozow_transaction_id is distinct from (item->>'transaction_id')::uuid
            or request.amount_cents <> (item->>'amount_cents')::bigint))
          or (request.status in ('declined', 'failed')
            and item->>'status' not in ('Failed', 'Cancelled', 'Invalid', 'Error')) then
        mismatched := mismatched + 1;
        perform internal.ozow_refund_problem(request.payment_id, 'refund_mismatch', 'refund_check', request.id::text);
      elsif request.status in ('awaiting_approval', 'applied')
          and item->>'status' in ('Failed', 'Cancelled', 'Invalid', 'Error', 'Returned') then
        -- A refund recorded as made (or waiting to take effect) that Ozow
        -- did not pay, or whose money came back.
        mismatched := mismatched + 1;
        perform internal.ozow_refund_problem(request.payment_id,
          case when item->>'status' = 'Returned' then 'refund_returned' else 'refund_failed' end, 'refund_check',
          request.id::text);
      end if;
    elsif internal.ozow_refund_link_candidate((item->>'refund_id')::uuid, (item->>'transaction_id')::uuid,
        (item->>'amount_cents')::bigint, (item->>'requested_at')::timestamptz) is null then
      unmatched := unmatched + 1;
      perform internal.ozow_refund_problem(internal.ozow_transaction_payment((item->>'transaction_id')::uuid),
        'refund_unmatched', 'refund_check', item->>'refund_id');
    end if;
  end loop;
  for request in select r.* from private.payment_refund_requests r
      where r.channel = 'api' and ((r.status = 'approved' and r.approved_at < statement_timestamp() - interval '1 day')
        or (r.status = 'sent' and r.sent_at < statement_timestamp() - interval '1 day'))
      order by r.requested_at, r.id loop
    stuck := stuck + 1;
    perform internal.ozow_refund_problem(request.payment_id, 'refund_stuck', 'refund_check', request.id::text);
  end loop;
  return jsonb_build_object('checked', checked, 'unmatched', unmatched, 'mismatched', mismatched, 'stuck', stuck);
end;
$function$;
alter function internal.reconcile_ozow_refunds(jsonb) owner to postgres;
revoke all on function internal.reconcile_ozow_refunds(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.reconcile_ozow_refunds(jsonb) to service_role;

CREATE OR REPLACE FUNCTION api.reconcile_ozow_refunds(p_refunds jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reconcile_ozow_refunds(p_refunds);
$function$;
alter function api.reconcile_ozow_refunds(jsonb) owner to postgres;
revoke all on function api.reconcile_ozow_refunds(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.reconcile_ozow_refunds(jsonb) to service_role;

-- The 10-minute job's follow-up of refunds through Ozow: sent refunds with no
-- final answer after ten minutes (and no send retry still due), and each
-- dashboard refund once, are handed out for the server to read back from Ozow
-- (a refund by its id, or the refunds of the transaction for a send whose
-- answer was lost); each again at most every 30 minutes. Never waits for a
-- record another transaction holds.
CREATE OR REPLACE FUNCTION internal.claim_ozow_refund_checks(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare claimed jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'invalid refund check limit' using errcode='22023';
  end if;
  with due as (
    select r.id from private.payment_refund_requests r
    where (r.ozow_checked_at is null or r.ozow_checked_at <= statement_timestamp() - interval '30 minutes')
      and ((r.channel = 'api' and r.status = 'sent' and r.sent_at <= statement_timestamp() - interval '10 minutes'
          and not (r.ozow_refund_id is null and r.send_outcome = 'unknown' and r.send_attempts < 3
            and r.sent_at > statement_timestamp() - interval '6 hours'))
        or (r.channel = 'dashboard' and r.status in ('awaiting_approval', 'applied')
          and r.requested_at > statement_timestamp() - interval '30 days'
          and (r.ozow_status is null or r.ozow_status not in ('Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid',
            'Error'))))
    order by coalesce(r.ozow_checked_at, r.requested_at), r.id
    limit p_limit
    for update skip locked),
  taken as (
    update private.payment_refund_requests r set ozow_checked_at = statement_timestamp()
    from due where r.id = due.id
    returning r.*)
  select coalesce(jsonb_agg(jsonb_build_object('request_id', t.id, 'ozow_refund_id', t.ozow_refund_id,
      'transaction_id', t.ozow_transaction_id, 'amount_cents', t.amount_cents, 'sent_at', t.sent_at) order by t.id),
    '[]'::jsonb)
    into claimed from taken t;
  return claimed;
end;
$function$;
alter function internal.claim_ozow_refund_checks(integer) owner to postgres;
revoke all on function internal.claim_ozow_refund_checks(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_ozow_refund_checks(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_ozow_refund_checks(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_ozow_refund_checks(p_limit);
$function$;
alter function api.claim_ozow_refund_checks(integer) owner to postgres;
revoke all on function api.claim_ozow_refund_checks(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_ozow_refund_checks(integer) to service_role;

-- The server read Ozow and found no refund for a record: Ozow has no refund
-- with the recorded id, or (for a send whose answer was lost) no refund of the
-- transaction that fits it. Recorded on the record (when it was seen missing)
-- and staff are alerted; nothing else changes.
CREATE OR REPLACE FUNCTION internal.report_ozow_refund_missing(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; payment uuid;
begin
  if p_request_id is null then raise exception 'refund request required' using errcode='22023'; end if;
  select r.payment_id into payment from private.payment_refund_requests r
    where r.id = p_request_id and r.channel in ('api', 'dashboard');
  if payment is null then raise exception 'refund request not found' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  select * into request from private.payment_refund_requests r where r.id = p_request_id for update;
  if request.channel = 'api' and request.status <> 'sent' then
    return jsonb_build_object('request_id', request.id, 'status', request.status, 'reported', false);
  end if;
  update private.payment_refund_requests set ozow_missing_at = statement_timestamp() where id = request.id;
  perform internal.ozow_refund_problem(request.payment_id,
    case when request.ozow_refund_id is null then 'refund_stuck' else 'refund_mismatch' end, 'refund_check',
    request.id::text);
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'reported', true);
end;
$function$;
alter function internal.report_ozow_refund_missing(uuid) owner to postgres;
revoke all on function internal.report_ozow_refund_missing(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.report_ozow_refund_missing(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.report_ozow_refund_missing(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.report_ozow_refund_missing(p_request_id);
$function$;
alter function api.report_ozow_refund_missing(uuid) owner to postgres;
revoke all on function api.report_ozow_refund_missing(uuid) from public, anon, authenticated, service_role;
grant execute on function api.report_ozow_refund_missing(uuid) to service_role;

-- A staff member other than the requester closes a refund through Ozow that
-- never reached Ozow, so the payment can be refunded again: an approved refund
-- the server never sent, or a send whose answer was lost when, more than a day
-- after it was sent, the server found no such refund at Ozow. The record fails
-- ('closed_by_staff') with the closer and the reason.
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
  perform internal.lock_evidence_subject(request.account_id);
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
revoke all on function internal.close_staff_ozow_refund(uuid,text) from public, anon, authenticated, service_role;
grant execute on function internal.close_staff_ozow_refund(uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION api.close_staff_ozow_refund(p_request_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.close_staff_ozow_refund(p_request_id, p_reason);
$function$;
alter function api.close_staff_ozow_refund(uuid,text) owner to postgres;
revoke all on function api.close_staff_ozow_refund(uuid,text) from public, anon, authenticated, service_role;
grant execute on function api.close_staff_ozow_refund(uuid,text) to authenticated;

commit;
