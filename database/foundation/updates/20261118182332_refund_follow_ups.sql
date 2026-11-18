-- Refund follow-ups and Ozow's refund window (owner's decisions of 18 November
-- 2026, plan B).
--
-- Apply after 20261118072601_staff_data_minimisation.sql (filename order; this
-- update does not depend on it), and only once the website release of pull
-- request #267 is live: that release reads the new reason code and failure
-- reason, and words the three new refusals. It refuses with 55000 unless the
-- ten functions it replaces have their reviewed bodies (or this update's) and
-- the six it adds are absent (or this update's). Only adds: no API command,
-- argument, grant or result field is removed, added or changed. In one
-- transaction it:
--
-- 1. Adds the refund reason 'renewal_cancelled_before_start' ("Cancelled
--    before the renewal started") to the one list
--    (internal.assert_staff_refund_reason, now also used by the refunds
--    through Ozow and the Ozow dashboard record instead of their own copy),
--    to the unused internal.assert_staff_refund_input and to the table rule
--    payment_refund_requests_reason_code_check. It fits only a refund whose
--    slots are all renewals whose days have not started
--    (internal.refund_renewal_not_started; the whole payment of a renewal, or
--    one renewed slot of it); otherwise PT409 renewal_already_started.
--    Approving a waiting refund with it checks it again, and so does the
--    server before it sends one through Ozow (it fails as 'payment_changed').
-- 2. Renewal first: a refund that would end a period whose slot has a renewal
--    bought and not started (internal.refund_renewal_waiting) is refused with
--    PT409 renewal_queued, in every channel (a reference, through Ozow, the
--    Ozow dashboard). Refunding the renewal first, then the period, leaves no
--    days without the slot. Chargebacks are not refused (the bank already
--    took the money). Approving a waiting refund checks it again (a renewal
--    may be bought while it waits), and so does the server before it sends a
--    refund through Ozow (it fails with 'payment_changed', as today when the
--    payment changed). Each of these first locks the payment's grants, so a
--    renewal settling at the same moment is seen.
-- 3. A declined refund record took no effect, so its reference is free again:
--    the unique index payment_refund_requests_reference_idx leaves declined
--    records out (as payment_refund_requests_ozow_key_idx already does), and
--    internal.staff_refund_repeat ignores them. The same reference recorded
--    at the same moment for another payment is refused in the reference's
--    words (ozow_reference_used or refund_reference_used), not as a raw
--    unique violation.
-- 4. Ozow's refund window: internal.ozow_refund_window() is 13 days (Ozow
--    says 14; one day less for time zones and Ozow's clock), counted from the
--    payment's created_at (internal.ozow_refund_window_open). A refund through
--    Ozow is refused after it (PT409 outside_refund_window), when asked for
--    and when approved; one approved in time but not yet sent fails before
--    anything is sent ('outside_refund_window' added to
--    payment_refund_requests_failed; no payment problem alert, as it is
--    expected; it is listed under 'Refunds that need staff'). A refund already
--    made in the Ozow dashboard is recorded as before, whenever it was made.
-- 5. After the window, staff pay an Ozow payment back by bank transfer and
--    record the bank reference (internal.refund_by_bank_transfer): the
--    existing reference commands accept it for a refund of an Ozow payment
--    (the bank rule of internal.staff_refund_reference(uuid,text,text):
--    spaces allowed, at least four letters or digits, refusals
--    refund_reference_*), also once refunds through Ozow have been used
--    (ozow_reference_retired no longer applies to it). A refund recorded
--    with a reference is refused while a refund through Ozow of the same
--    payment is approved or sent (PT409 refund_in_flight): Ozow may still
--    pay that one. No new command. The
--    two-argument internal.staff_refund_reference stays, unused; a later
--    update may drop it.
--
-- No row is written or changed. Records waiting or approved when this is
-- applied are judged by the new rules when they are approved or sent (the
-- preflight counts them).
--
-- Order: the website of #267 is live (it already is); then this update; then
-- the release of this update's pull request, which offers the new reason and
-- the bank transfer form. Database first is safe for that release's
-- predecessor (#267): it shows the new values and refusals in plain words; it
-- simply does not offer the new reason or the bank transfer form yet.
-- Read-only preflight: ../preflight/20261118182332_refund_follow_ups.check.sql.
-- Rollback: ../rollback/20261118182332_refund_follow_ups.down.sql.
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
    from (values ('internal.assert_staff_refund_reason(text,text,text)'),
      ('internal.assert_staff_refund_input(text,text,text,text)'),
      ('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)'),
      ('internal.payment_refund_reference_rule()'),
      ('internal.payment_refund_request_guard()'),
      ('internal.record_staff_payment_refund(uuid,text,text,text,text)'),
      ('internal.record_staff_slot_refund(uuid,text,text,text,text)'),
      ('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)'),
      ('internal.approve_staff_payment_refund(uuid)'),
      ('internal.claim_ozow_refund_send(uuid)'),
      ('internal.ozow_refund_window()'),
      ('internal.ozow_refund_window_open(uuid)'),
      ('internal.refund_by_bank_transfer(uuid,text)'),
      ('internal.refund_renewal_waiting(uuid,uuid)'),
      ('internal.refund_renewal_not_started(uuid,uuid)'),
      ('internal.staff_refund_reference(uuid,text,text)')) v(sig)
  loop
    if shape not in (
        'internal.assert_staff_refund_reason(text,text,text) 9bdc2d6c07af6313c21463bd5fdca8d0',
        'internal.assert_staff_refund_reason(text,text,text) f1f95b8057b5dc46696e5da2b4644685',
        'internal.assert_staff_refund_input(text,text,text,text) 09b161b7933849f4f5c221dd3c6e6f6d',
        'internal.assert_staff_refund_input(text,text,text,text) 8e66526256db946ba25b9f8462ecc9c1',
        'internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) 31f93ac046f3cb4b73bc6896e8e4d2a3',
        'internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) 4abd76e6a63c1097cc9b3ae042b4d9fd',
        'internal.payment_refund_reference_rule() 5f84fd9a07a75476cf72b741b20f5806',
        'internal.payment_refund_reference_rule() bcd393024fa7d491426eabe75841fda2',
        'internal.payment_refund_request_guard() 08e1cff16910b59c8d305a1eae7f7b56',
        'internal.payment_refund_request_guard() 11b86b7a627aad245c84433118601705',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) 2ba50b5b15c6259c1b2c6369d3473e90',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) c71a8c2d3db386d46c39aa1fbe9f1729',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) 193a2b3abdbc83b0b16d81d759dc168e',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) 127eb069abea6bc0159a8206e17f0863',
        'internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) b47de2156d93ce9ee6a48bcb6d206adc',
        'internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb) f5bc560c0a12f637532ebf6492843ee6',
        'internal.approve_staff_payment_refund(uuid) 6c7090e7cb1fee5fffd3c3495e76e2ab',
        'internal.approve_staff_payment_refund(uuid) 189b3f24e9b847bf75760eeaae9b2686',
        'internal.claim_ozow_refund_send(uuid) 0b9666cbe9d56092d32b11e326c1fb90',
        'internal.claim_ozow_refund_send(uuid) c16477b6080ff5e7075f63936cd5383b',
        'internal.ozow_refund_window() absent',
        'internal.ozow_refund_window() 87040940d4cf4f969d15867cc1100ca6',
        'internal.ozow_refund_window_open(uuid) absent',
        'internal.ozow_refund_window_open(uuid) 23634fcb911129480d1c737d1f585d58',
        'internal.refund_by_bank_transfer(uuid,text) absent',
        'internal.refund_by_bank_transfer(uuid,text) 7a196d4327b5854a6a73a83280e515b0',
        'internal.refund_renewal_waiting(uuid,uuid) absent',
        'internal.refund_renewal_waiting(uuid,uuid) 059a78b1022f10ff9bb7a9679001875b',
        'internal.refund_renewal_not_started(uuid,uuid) absent',
        'internal.refund_renewal_not_started(uuid,uuid) 4d5c9cc568bfb4edd04da482d1a465dc',
        'internal.staff_refund_reference(uuid,text,text) absent',
        'internal.staff_refund_reference(uuid,text,text) 4959d13e9ecc22a0ef6ed4bd94d99e7a') then
      raise exception 'refund follow-ups precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. The new reason, and 4. the new failure reason, in the table rules.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_reason_code_check,
  add constraint payment_refund_requests_reason_code_check check (reason_code = any (array['billing_error'::text, 'duplicate'::text, 'our_failure_after_fix_offered'::text, 's14_cancellation'::text, 'breach_credit'::text, 'renewal_cancelled_before_start'::text]));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_failed,
  add constraint payment_refund_requests_failed check ((status = 'failed'::text) = (failed_at is not null and failure_reason is not null)
    and (failure_reason is null or failure_reason = any (array['ozow_refused'::text, 'ozow_auth'::text, 'ozow_failed'::text, 'ozow_cancelled'::text, 'ozow_invalid'::text, 'payment_changed'::text, 'closed_by_staff'::text, 'outside_refund_window'::text])));

-- 3. A declined record's reference may be recorded again.
do $$
begin
  if pg_get_indexdef('private.payment_refund_requests_reference_idx'::regclass) not like '% WHERE %' then
    drop index private.payment_refund_requests_reference_idx;
    create unique index payment_refund_requests_reference_idx on private.payment_refund_requests
      (lower(ozow_reference)) where status <> 'declined';
  end if;
end$$;

-- The rules (new helpers first: the changed functions use them).
CREATE OR REPLACE FUNCTION internal.ozow_refund_window()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Ozow refunds a payment up to 14 days after it; one day less, for time zones
  -- and Ozow's own clock (owner's decision of 18 November 2026).
  select interval '13 days';
$function$;
alter function internal.ozow_refund_window() owner to postgres;
revoke all on function internal.ozow_refund_window() from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.ozow_refund_window_open(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Counted from the payment's created_at (the start of the Ozow transaction).
  select coalesce((select statement_timestamp() < p.created_at + internal.ozow_refund_window()
    from private.payments p where p.id = p_payment_id), false);
$function$;
alter function internal.ozow_refund_window_open(uuid) owner to postgres;
revoke all on function internal.ozow_refund_window_open(uuid) from public, anon, authenticated, service_role;

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
revoke all on function internal.refund_by_bank_transfer(uuid,text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.refund_renewal_waiting(p_payment_id uuid, p_line_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A renewal of a slot this refund would end is bought and has not started:
  -- refunding this period first would leave the slot without days until the
  -- renewal starts. p_line_id null: any slot of the payment.
  select exists(select 1 from private.entitlements e
    join private.entitlements r on r.renews_entitlement_id = e.id
    where e.payment_id = p_payment_id and (p_line_id is null or e.payment_line_id = p_line_id)
      and r.status <> 'revoked' and r.starts_at > statement_timestamp());
$function$;
alter function internal.refund_renewal_waiting(uuid,uuid) owner to postgres;
revoke all on function internal.refund_renewal_waiting(uuid,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.refund_renewal_not_started(p_payment_id uuid, p_line_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Every slot this refund covers is a renewal whose days have not started
  -- (the reason 'renewal_cancelled_before_start'). p_line_id null: the whole
  -- payment, as for a payment of one renewed slot.
  select coalesce((select bool_and(e.renews_entitlement_id is not null and e.starts_at > statement_timestamp())
    from private.entitlements e
    where e.payment_id = p_payment_id and (p_line_id is null or e.payment_line_id = p_line_id)), false);
$function$;
alter function internal.refund_renewal_not_started(uuid,uuid) owner to postgres;
revoke all on function internal.refund_renewal_not_started(uuid,uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.staff_refund_reference(p_payment_id uuid, p_reference text, p_kind text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare reference text;
begin
  -- A bank reference (spaces allowed): a bank-transfer payment, or an Ozow
  -- payment paid back by bank transfer once Ozow's refund window has passed.
  if internal.refund_by_bank_transfer(p_payment_id, p_kind) then
    reference := regexp_replace(btrim(coalesce(p_reference, '')), '\s+', ' ', 'g');
    if reference = '' then
      raise exception 'bank refund reference required' using errcode='22023', detail='refund_reference_required';
    end if;
    if reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$'
        or length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) < 4 then
      raise exception 'bank refund reference must be 4 to 100 letters, digits, spaces or . _ : / -'
        using errcode='22023', detail='refund_reference_invalid';
    end if;
    return reference;
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'Ozow refund reference required' using errcode='22023', detail='ozow_reference_required';
  end if;
  if p_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$' then
    raise exception 'Ozow refund reference must be 4 to 100 letters, digits or . _ : / -' using errcode='22023', detail='ozow_reference_invalid';
  end if;
  return p_reference;
end;
$function$;
alter function internal.staff_refund_reference(uuid,text,text) owner to postgres;
revoke all on function internal.staff_refund_reference(uuid,text,text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.assert_staff_refund_reason(p_kind text, p_reason_code text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_kind is null or p_kind not in ('refunded', 'chargeback') then
    raise exception 'refund or chargeback required' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit', 'renewal_cancelled_before_start') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_staff_refund_reason(text,text,text) owner to postgres;
revoke all on function internal.assert_staff_refund_reason(text,text,text) from public;

CREATE OR REPLACE FUNCTION internal.assert_staff_refund_input(p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_ozow_reference is null or btrim(p_ozow_reference) = '' then
    raise exception 'Ozow refund reference required' using errcode='22023', detail='ozow_reference_required';
  end if;
  if p_ozow_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$' then
    raise exception 'Ozow refund reference must be 4 to 100 letters, digits or . _ : / -' using errcode='22023', detail='ozow_reference_invalid';
  end if;
  if p_kind is null or p_kind not in ('refunded', 'chargeback') then
    raise exception 'refund or chargeback required' using errcode='22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('billing_error', 'duplicate', 'our_failure_after_fix_offered',
      's14_cancellation', 'breach_credit', 'renewal_cancelled_before_start') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_staff_refund_input(text,text,text,text) owner to postgres;
revoke all on function internal.assert_staff_refund_input(text,text,text,text) from public;

CREATE OR REPLACE FUNCTION internal.staff_refund_repeat(p_actor uuid, p_payment_id uuid, p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare prior private.payment_refund_requests;
begin
  -- A declined record took no effect, so its reference may be recorded again.
  select * into prior from private.payment_refund_requests r where lower(r.ozow_reference) = lower(btrim(p_ozow_reference))
    and r.status <> 'declined';
  if not found then return null; end if;
  if prior.payment_id = p_payment_id and prior.payment_line_id is not distinct from p_line_id and prior.kind = p_kind
      and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = p_actor then
    return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'kind', prior.kind,
      'released_activations', prior.released_activations,
      'payment_status', (select p.status from private.payments p where p.id = prior.payment_id), 'repeated', true);
  end if;
  if internal.refund_by_bank_transfer(p_payment_id, p_kind) then
    raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
  end if;
  raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
end;
$function$;
alter function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) from public;

CREATE OR REPLACE FUNCTION internal.payment_refund_reference_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only a bank reference may hold a space: of a refund of a bank-transfer
  -- payment, or of an Ozow payment paid back by bank transfer once Ozow's
  -- refund window has passed (internal.refund_by_bank_transfer). Ozow's
  -- references never do. References never change afterwards
  -- (internal.payment_refund_request_guard).
  if position(' ' in new.ozow_reference) > 0
      and not (new.channel = 'manual' and internal.refund_by_bank_transfer(new.payment_id, new.kind)) then
    raise exception 'only the bank reference of a refund paid back by bank transfer may contain spaces' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_reference_rule() owner to postgres;
revoke all on function internal.payment_refund_reference_rule() from public;

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
    -- never with a typed reference. Chargebacks, payments made outside Ozow
    -- and Ozow payments whose refund window has passed (paid back by bank
    -- transfer, internal.refund_by_bank_transfer) keep the reference.
    if new.channel = 'manual' and new.kind = 'refunded'
        and internal.ozow_refund_transaction(new.payment_id) is not null
        and not internal.refund_by_bank_transfer(new.payment_id, new.kind)
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
  reference := internal.staff_refund_reference(p_payment_id, p_ozow_reference, p_kind);
  perform internal.assert_staff_refund_reason(p_kind, p_reason_code, p_reason);
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if not found then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_payment_id::text, 0));
  perform internal.lock_kept_record_subject(buyer, p_payment_id);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
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
  -- Not while a refund through Ozow is on its way: Ozow may still pay it.
  if p_kind = 'refunded' and exists(select 1 from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, null) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if p_kind = 'refunded' and internal.refund_renewal_waiting(pay.id, null) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
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
  -- The same reference recorded at the same moment for another payment: the
  -- unique index decides; say so in the reference's words.
  declare violated text;
  begin
    insert into private.payment_refund_requests (payment_id, account_id, kind, reason_code, reason, ozow_reference,
        amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
      values (pay.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference, pay.amount_cents, refunded_before,
        approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
        case when approval then null else statement_timestamp() end,
        case when approval then null else (result->>'released_activations')::integer end)
      returning * into request;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated in ('payment_refund_requests_reference_idx', 'payment_refund_requests_ozow_key_idx') then
      if internal.refund_by_bank_transfer(pay.id, p_kind) then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    raise;
  end;
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
    p_ozow_reference, p_kind);
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
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
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
  -- Not while a refund through Ozow is on its way: Ozow may still pay it.
  if p_kind = 'refunded' and exists(select 1 from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, line.id) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if p_kind = 'refunded' and internal.refund_renewal_waiting(pay.id, line.id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  refunded_before := internal.payment_refunded_before_cents(pay.id);
  -- A payment of an erased account: always a second staff member.
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents) or pay.owner_id is null;
  if not approval then
    result := internal.record_staff_slot_reversal(line.id, p_kind, btrim(p_reason));
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- The same reference recorded at the same moment for another payment: the
  -- unique index decides; say so in the reference's words.
  declare violated text;
  begin
    insert into private.payment_refund_requests (payment_id, payment_line_id, account_id, kind, reason_code, reason,
        ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at, released_activations)
      values (pay.id, line.id, pay.owner_id, p_kind, p_reason_code, btrim(p_reason), reference,
        line.amount_cents, refunded_before, approval, case when approval then 'awaiting_approval' else 'applied' end, actor,
        case when approval then null else statement_timestamp() end,
        case when approval then null else (result->>'released_activations')::integer end)
      returning * into request;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated in ('payment_refund_requests_reference_idx', 'payment_refund_requests_ozow_key_idx') then
      if internal.refund_by_bank_transfer(pay.id, p_kind) then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    raise;
  end;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', p_kind, 'line_id', line.id,
    'released_activations', request.released_activations,
    'payment_status', coalesce(result->>'payment_status', pay.status), 'repeated', false);
end;
$function$;
alter function internal.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

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
  -- The one list of reasons (an Ozow refund is always a refund).
  perform internal.assert_staff_refund_reason('refunded', p_reason_code, p_reason);
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
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
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
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, line.id) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if internal.refund_renewal_waiting(pay.id, line.id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  -- Ozow refunds a payment only within its window (internal.ozow_refund_window);
  -- after that staff pay it back by bank transfer and record the bank reference.
  -- A refund already made in the Ozow dashboard is recorded whenever it was made.
  if p_channel = 'api' and not internal.ozow_refund_window_open(pay.id) then
    raise exception 'Ozow refunds only within 13 days of the payment; pay it back by bank transfer and record the bank reference'
      using errcode='PT409', detail='outside_refund_window';
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
  -- The refunded period's grants: a renewal bought at the same moment waits for
  -- this, so the renewal rules below see it.
  perform 1 from private.entitlements e where e.payment_id = pay.id order by e.id for update;
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
  -- The reason holds only while the renewal's days have not started.
  if request.reason_code = 'renewal_cancelled_before_start'
      and not internal.refund_renewal_not_started(pay.id, request.payment_line_id) then
    raise exception 'the renewal has started; decline this refund and record it with another reason' using errcode='PT409', detail='renewal_already_started';
  end if;
  -- A renewal of the slot bought while the refund waited: refund the renewal
  -- first (decline this one and record it again afterwards).
  if request.kind = 'refunded' and internal.refund_renewal_waiting(pay.id, request.payment_line_id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  if request.channel = 'api' and not internal.ozow_refund_window_open(pay.id) then
    raise exception 'Ozow refunds only within 13 days of the payment; decline this refund, pay it back by bank transfer and record the bank reference'
      using errcode='PT409', detail='outside_refund_window';
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
    -- The refunded period's grants: a renewal bought at the same moment waits for
    -- this, so the renewal rules below see it.
    perform 1 from private.entitlements e where e.payment_id = request.payment_id order by e.id for update;
    if (select p.status from private.payments p where p.id = request.payment_id) is distinct from 'complete'
        or internal.ozow_refund_transaction(request.payment_id) is distinct from request.ozow_transaction_id
        or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = request.payment_id)
        or (request.payment_line_id is null and exists(select 1 from private.payment_lines l
          where l.payment_id = request.payment_id and l.status = 'reversed'))
        or (request.payment_line_id is not null and not exists(select 1 from private.payment_lines l
          where l.id = request.payment_line_id and l.status = 'open'))
        or internal.refund_renewal_waiting(request.payment_id, request.payment_line_id)
        or (request.reason_code = 'renewal_cancelled_before_start'
          and not internal.refund_renewal_not_started(request.payment_id, request.payment_line_id)) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'payment_changed' where id = request.id returning * into request;
      perform internal.ozow_refund_problem(request.payment_id, 'refund_failed', 'refund_send', request.id::text);
      return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
    end if;
    -- Ozow's refund window passed before it was sent: nothing goes to Ozow and
    -- staff pay it back by bank transfer (it is listed under 'Refunds that need
    -- staff'). Expected, so it raises no payment problem alert.
    if not internal.ozow_refund_window_open(request.payment_id) then
      update private.payment_refund_requests set status = 'failed', failed_at = statement_timestamp(),
        failure_reason = 'outside_refund_window' where id = request.id returning * into request;
      return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
    end if;
    update private.payment_refund_requests set status = 'sent', sent_at = statement_timestamp(), send_attempts = 1,
      last_send_at = statement_timestamp(), send_outcome = 'unknown' where id = request.id returning * into request;
  elsif request.status = 'sent' and request.send_outcome = 'unknown' and request.ozow_refund_id is null
      and request.send_attempts < 3 and request.last_send_at <= statement_timestamp() - interval '30 minutes'
      and request.sent_at > statement_timestamp() - interval '6 hours' then
    update private.payment_refund_requests set send_attempts = send_attempts + 1, last_send_at = statement_timestamp()
      where id = request.id returning * into request;
  else
    return jsonb_build_object('request_id', request.id, 'claimed', false, 'status', request.status);
  end if;
  return jsonb_build_object('request_id', request.id, 'claimed', true, 'status', request.status,
    'attempt', request.send_attempts, 'sent_at', request.sent_at, 'idempotency_key', request.ozow_reference,
    'transaction_id', request.ozow_transaction_id, 'amount_cents', request.amount_cents,
    'reason_code', request.reason_code);
end;
$function$;
alter function internal.claim_ozow_refund_send(uuid) owner to postgres;
revoke all on function internal.claim_ozow_refund_send(uuid) from public;
grant execute on function internal.claim_ozow_refund_send(uuid) to service_role;

-- No grant changes: the replaced functions keep theirs, the helpers have none.
do $$
declare f text;
begin
  foreach f in array array['internal.ozow_refund_window()', 'internal.ozow_refund_window_open(uuid)', 'internal.refund_by_bank_transfer(uuid,text)', 'internal.refund_renewal_waiting(uuid,uuid)', 'internal.refund_renewal_not_started(uuid,uuid)', 'internal.staff_refund_reference(uuid,text,text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
        or has_function_privilege('service_role', f, 'execute') then
      raise exception 'refund follow-ups: unexpected grants on %', f;
    end if;
  end loop;
end$$;

notify pgrst,'reload schema';
commit;
