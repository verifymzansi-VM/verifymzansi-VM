-- Fixes found in review of the bank transfer update (20261113162457) and the
-- communication choices update (20261113134500).
--
-- Apply after 20261113162457_staff_invoice_payments.sql (it refuses with 55000
-- unless every function it replaces has the reviewed body of that update, of
-- 20261113134500 or of 20261113021223, or already this update's). It does not
-- depend on 20261113172356_ozow_api_refunds.sql (open pull request #221) and
-- touches nothing that update changes, so either may be applied first; record
-- them in filename order. No API command, argument, return type or grant is
-- added, removed or changed: the website release deployed before it keeps
-- working. In one transaction it:
--
-- 1. Bank references of recorded bank transfers. Until now a reference was
--    used once across every record, declined ones included, so a reference
--    declined by mistake could never be recorded again, and two customers who
--    both used a common reference ("VerifyMzansi", their name) could not both
--    be recorded. One bank credit is now identified by its reference (letters
--    and digits, whatever the case, spaces or punctuation), the amount and the
--    date it cleared: among the records that are waiting or confirmed, that
--    combination is unique (new partial unique index
--    invoice_transfers_open_reference_idx replaces invoice_transfers_reference_idx).
--    So the same credit can never wait or be confirmed twice, for any customer;
--    a declined record frees its reference (staff are told to "decline it and
--    record it again" when the recorder can no longer record payments or
--    referred the customer); and the same reference may be recorded for
--    another amount or another day. Two genuine transfers with the same
--    reference, amount and day are refused (PT409 bank_reference_used): the
--    safe side, since they cannot be told apart from one transfer recorded
--    twice. The one case the index no longer stops is the same credit recorded
--    again with a wrongly typed date: to show it to the second staff member, a
--    record's similar_records now counts the other waiting or confirmed
--    records with the same reference and amount (any customer or date),
--    besides those of the same customer, amount and date under another
--    reference; the confirmation screen shows it as "Possible duplicate".
--    Two-person confirmation is unchanged. A stricter alternative, for the
--    owner to choose instead: the reference alone unique among waiting and
--    confirmed records (no date typo can pass, but a common reference is then
--    refused for every second customer). (internal.record_staff_invoice_payment
--    and internal.invoice_transfer_dto, full bodies.)
-- 2. Refund references of a bank-transfer payment. Staff record the refund of a
--    payment made by bank transfer with the reference of the transfer back,
--    which banks often print with spaces. For such a payment the reference may
--    now hold single spaces (4 to 100 letters, digits, spaces or . _ : / -, at
--    least four letters or digits; runs of spaces are stored as one), refused
--    as refund_reference_required, refund_reference_invalid or
--    refund_reference_used with no mention of Ozow. Ozow references keep
--    exactly their rules and messages. New internal.staff_refund_reference and
--    internal.assert_staff_refund_reason; internal.record_staff_payment_refund,
--    internal.record_staff_slot_refund and internal.staff_refund_repeat (full
--    bodies); the check payment_refund_requests_ozow_reference_check accepts
--    single inner spaces, and the new trigger
--    payment_refund_requests_reference_rule refuses a reference with a space
--    unless the payment was made by bank transfer.
-- 3. Receipt date. The receipt read api.get_payment_receipt also returns
--    cleared_on, the date the money cleared, for a payment made by bank
--    transfer; the receipt email shows it as "Date paid" instead of the time a
--    second staff member confirmed it. completed_at, the slots and every other
--    payment rule are unchanged (internal.get_payment_receipt, full body).
-- 4. Privacy export and consent records. A member's privacy export now also
--    holds their communication choice history (communication_choices), the
--    Terms they accepted at sign-up (signup_terms) and their recorded bank
--    transfers (bank_transfers: amount, slots, term, reference, dates, whether
--    the written cooling-off waiver was recorded, and the outcome; never which
--    staff member recorded, confirmed or declined it, nor staff notes, as for
--    the other payment records) (internal.frontend_privacy_export_data, full
--    body).
--    Retention: the retention job (internal.retention_verification, full body)
--    deleted the posting-terms acceptances of a closed account 30 days after
--    closure, while the sign-up Terms acceptance and the communication choice
--    history stayed until the Auth user is deleted. All three consent records
--    are now treated alike: kept while the account is open, and deleted 30
--    days after closure unless a legal hold names the account, in the same
--    sweep (each batch now takes only closed accounts that still hold such
--    rows, so the sweep cannot stall behind accounts already cleared; this
--    also applies to the home area and posting-terms deletes). Recorded bank transfers are payment records: they are kept with
--    the payments (never purged; tax records are kept at least five years).
--    FOR THE OWNER'S LAWYER TO CONFIRM: 30 days after closure for consent
--    proof (the period already decided for posting-terms acceptances). If a
--    longer period is needed to prove consent (for example three years for
--    claims), change all three in one later update; never one alone.
-- 5. Email history. A member whose account is restricted can read their own
--    email history, as they can read and withdraw their communication
--    choices (internal.list_my_email_history checks internal.consent_actor:
--    a signed-in, confirmed account with a live session). The rest of the
--    read is unchanged.
--
-- ORDER: apply after 20261113162457_staff_invoice_payments.sql, and before the
-- website release from the same pull request is deployed (that release works
-- with or without it: before it, a bank refund reference with a space is
-- refused as before and the receipt shows the confirmation date).
-- Read-only preflight: ../preflight/20261113223806_bank_transfer_and_consent_fixes.check.sql.
-- Rollback: ../rollback/20261113223806_bank_transfer_and_consent_fixes.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: every function this update replaces has its reviewed body
-- (before this update, or this update's); the functions it adds are absent or
-- this update's; the reference rule and index are the earlier or this update's.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)'),
      ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)'),('internal.get_payment_receipt(uuid)'),
      ('internal.record_staff_payment_refund(uuid,text,text,text,text)'),('internal.record_staff_slot_refund(uuid,text,text,text,text)'),
      ('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)'),('internal.frontend_privacy_export_data(uuid)'),
      ('internal.retention_verification(integer)'),('internal.list_my_email_history(integer)'),
      ('internal.staff_refund_reference(uuid,text)'),('internal.assert_staff_refund_reason(text,text,text)'),
      ('internal.payment_refund_reference_rule()')) v(sig)
  loop
    if shape not in (
        'internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) 6b00db574fbf4056485339f1766460b9',
        'internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) fa71c56d4a686ea343f23d551985af9e',
        'internal.invoice_transfer_dto(private.invoice_transfers,uuid) 271116a2ef1b920f162c0c6e3dd9d367',
        'internal.invoice_transfer_dto(private.invoice_transfers,uuid) b91dbdd96bec847ddb165d6a663cc7cb',
        'internal.get_payment_receipt(uuid) 82b6d1f1a4f8f1b7e1325c71146b453d',
        'internal.get_payment_receipt(uuid) 764707a2ed4f9c87985e88b1afcde37c',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) 03691c9ff0eb92fed4be87b11c1fb15b',
        'internal.record_staff_payment_refund(uuid,text,text,text,text) 49d728545decec524a1a7dd6e09639e1',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) a315072d628da2b6f164491cbc1a0076',
        'internal.record_staff_slot_refund(uuid,text,text,text,text) cbea96f3d2df4f3255c565790df97fed',
        'internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) 6e38d5e6f28b5ed84b79388329effc18',
        'internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) 31f93ac046f3cb4b73bc6896e8e4d2a3',
        'internal.frontend_privacy_export_data(uuid) 364c075188caa06e95654bc787256078',
        'internal.frontend_privacy_export_data(uuid) d30c545386536a718e824d1ec56f03ce',
        'internal.retention_verification(integer) 8ec82ea0aadf31494bebb7a28d5640a5',
        'internal.retention_verification(integer) fe726b6672545b8b33901361eaf91226',
        'internal.list_my_email_history(integer) 4b43516e282fc258bf747c427f4c18e0',
        'internal.list_my_email_history(integer) bae293aa4451ea71502c27863c1cf5e6',
        'internal.staff_refund_reference(uuid,text) absent',
        'internal.staff_refund_reference(uuid,text) ae254508232ecdd23136e0d47549673f',
        'internal.assert_staff_refund_reason(text,text,text) absent',
        'internal.assert_staff_refund_reason(text,text,text) 9bdc2d6c07af6313c21463bd5fdca8d0',
        'internal.payment_refund_reference_rule() absent',
        'internal.payment_refund_reference_rule() 5f84fd9a07a75476cf72b741b20f5806') then
      raise exception 'bank transfer and consent fixes precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
  -- Bodies this update calls and does not replace.
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.consent_actor()')) is distinct from '099a58b1b468c01729de1ee233a6de84'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.guard_consent_record()')) is distinct from '0efc7c208cfc205c057c1015781cfd71'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)')) is distinct from '1364f8c78e36281bae5f16a4ba5a466c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment(uuid,text,text)')) is distinct from '66005adb9e06b17e689dbac47ce93d5a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.refund_needs_approval(text,bigint,bigint)')) is distinct from '7f3795506bf5dedfc96e78c6adb0b1ff'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_payment_actor(uuid,uuid)')) is distinct from 'fe81cc39557206e06346fcf5e9f33bfd'
    or to_regclass('private.communication_choice_events') is null
    or to_regclass('private.signup_terms_acceptances') is null
    or to_regclass('private.invoice_transfers') is null
    or to_regclass('private.payment_refund_requests') is null then
    raise exception 'bank transfer and consent fixes precondition: apply 20261113134500 and 20261113162457 first (reviewed bodies required)'
      using errcode='55000';
  end if;
  if not coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='private.payment_refund_requests'::regclass
      and c.conname='payment_refund_requests_ozow_reference_check') in (
      'CHECK ((ozow_reference ~ ''^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$''::text))',
      'CHECK (((ozow_reference ~ ''^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$''::text) AND (ozow_reference = btrim(ozow_reference)) AND (ozow_reference !~~ ''%  %''::text)))'), false) then
    raise exception 'bank transfer and consent fixes precondition: the refund reference rule differs from the reviewed one'
      using errcode='55000';
  end if;
  if to_regclass('private.invoice_transfers_reference_idx') is not null
      and pg_get_indexdef(to_regclass('private.invoice_transfers_reference_idx')) is distinct from
        'CREATE UNIQUE INDEX invoice_transfers_reference_idx ON private.invoice_transfers USING btree (upper(regexp_replace(bank_reference, ''[^A-Za-z0-9]''::text, ''''::text, ''g''::text)))'
    or to_regclass('private.invoice_transfers_open_reference_idx') is not null
      and pg_get_indexdef(to_regclass('private.invoice_transfers_open_reference_idx')) is distinct from
        'CREATE UNIQUE INDEX invoice_transfers_open_reference_idx ON private.invoice_transfers USING btree (upper(regexp_replace(bank_reference, ''[^A-Za-z0-9]''::text, ''''::text, ''g''::text)), amount_received_cents, cleared_on) WHERE (status <> ''declined''::text)' then
    raise exception 'bank transfer and consent fixes precondition: a bank reference index differs from the reviewed one'
      using errcode='55000';
  end if;
end$$;

-- 1. One bank credit (reference, amount, date cleared) waits or is confirmed
-- once; a declined record frees it. Built before the old index is dropped, so
-- there is never a moment without a rule.
create unique index if not exists invoice_transfers_open_reference_idx on private.invoice_transfers
  (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')), amount_received_cents, cleared_on)
  where status <> 'declined';
drop index if exists private.invoice_transfers_reference_idx;

-- What a staff member needs to see of a record: also the customer's account
-- email (to match the bank statement) and how many other waiting or confirmed
-- records may be the same bank credit: the same reference and amount (any
-- customer or date: a date typed wrongly), or the same customer, amount and
-- date under another reference.
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
      and (upper(regexp_replace(x.bank_reference, '[^A-Za-z0-9]', '', 'g'))
          = upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g'))
        or (x.account_id = t.account_id and x.cleared_on = t.cleared_on))),
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

-- Record a cleared bank transfer: stored as waiting; nothing starts.
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
  -- The same bank credit (reference, amount, date cleared) waiting or
  -- confirmed: the same request again by the same staff member returns it;
  -- anything else is refused. A declined record does not count.
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key
      and t.amount_received_cents = p_amount_cents and t.cleared_on = cleared and t.status <> 'declined';
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

-- 2. Refund references. The reference of a refund or chargeback of this
-- payment, as stored: for a payment made by bank transfer, the bank's
-- reference (single spaces allowed, runs of spaces stored as one); for every
-- other payment (or an unknown one, refused afterwards as not found), Ozow's
-- reference exactly as before.
CREATE OR REPLACE FUNCTION internal.staff_refund_reference(p_payment_id uuid, p_reference text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare reference text;
begin
  if exists(select 1 from private.payments p where p.id = p_payment_id and p.provider = 'invoice') then
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
alter function internal.staff_refund_reference(uuid,text) owner to postgres;
revoke all on function internal.staff_refund_reference(uuid,text) from public, anon, authenticated, service_role;

-- The rest of a refund's input: kind, reason code and audit reason.
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
      's14_cancellation', 'breach_credit') then
    raise exception 'valid refund reason code required' using errcode='22023', detail='refund_reason_code_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
end;
$function$;
alter function internal.assert_staff_refund_reason(text,text,text) owner to postgres;
revoke all on function internal.assert_staff_refund_reason(text,text,text) from public, anon, authenticated, service_role;

-- A reference already recorded: the same request again by the same staff
-- member returns the first result; anything else is refused, in the words of
-- the payment's method.
CREATE OR REPLACE FUNCTION internal.staff_refund_repeat(p_actor uuid, p_payment_id uuid, p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare prior private.payment_refund_requests;
begin
  select * into prior from private.payment_refund_requests r where lower(r.ozow_reference) = lower(btrim(p_ozow_reference));
  if not found then return null; end if;
  if prior.payment_id = p_payment_id and prior.payment_line_id is not distinct from p_line_id and prior.kind = p_kind
      and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason) and prior.requested_by = p_actor then
    return jsonb_build_object('request_id', prior.id, 'status', prior.status, 'kind', prior.kind,
      'released_activations', prior.released_activations,
      'payment_status', (select p.status from private.payments p where p.id = prior.payment_id), 'repeated', true);
  end if;
  if exists(select 1 from private.payments p where p.id = p_payment_id and p.provider = 'invoice') then
    raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
  end if;
  raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
end;
$function$;
alter function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated, service_role;

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
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_payment_id::text, 0));
  perform internal.lock_evidence_subject(buyer);
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
  approval := internal.refund_needs_approval(p_kind, refunded_before, pay.amount_cents);
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
revoke all on function internal.record_staff_payment_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
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
  if buyer is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||payment::text, 0));
  perform internal.lock_evidence_subject(buyer);
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
  approval := internal.refund_needs_approval(p_kind, refunded_before, line.amount_cents);
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
revoke all on function internal.record_staff_slot_refund(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;

-- The stored rule: single inner spaces are possible, and only a refund of a
-- payment made by bank transfer may hold one (trigger below). Every existing
-- reference meets the new check, which only adds spaces.
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_ozow_reference_check,
  add constraint payment_refund_requests_ozow_reference_check check (ozow_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$'
    and ozow_reference = btrim(ozow_reference) and ozow_reference not like '%  %');

CREATE OR REPLACE FUNCTION internal.payment_refund_reference_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only the reference of a refund of a bank-transfer payment may hold a
  -- space; Ozow's references never do. References never change afterwards
  -- (internal.payment_refund_request_guard).
  if position(' ' in new.ozow_reference) > 0
      and not exists(select 1 from private.payments p where p.id = new.payment_id and p.provider = 'invoice') then
    raise exception 'only the refund reference of a bank-transfer payment may contain spaces' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_reference_rule() owner to postgres;
revoke all on function internal.payment_refund_reference_rule() from public, anon, authenticated, service_role;
drop trigger if exists payment_refund_requests_reference_rule on private.payment_refund_requests;
create trigger payment_refund_requests_reference_rule before insert on private.payment_refund_requests
  for each row execute function internal.payment_refund_reference_rule();

-- 3. The receipt read also gives the date the money of a bank transfer cleared.
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
    'bank_reference', t.bank_reference,
    'cleared_on', to_char(t.cleared_on::timestamp, 'YYYY-MM-DD'))
  from private.payments p left join private.invoices i on i.payment_id = p.id
    left join private.invoice_transfers t on t.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

-- 4. The privacy export also holds the consent records and bank transfers.
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

-- Retention: thirty days after closure, the posting-terms acceptances, the
-- sign-up Terms acceptance and the communication choice history of the
-- account go together (unless a legal hold names it). Lawyer to confirm the
-- period (see the header).
CREATE OR REPLACE FUNCTION internal.retention_verification(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; numbers integer:=0; challenges integer; proofs integer; localities integer;
  acceptances integer; signup_acceptances integer; choice_events integer; histories integer:=0; cases uuid[];
begin
  for candidate in
    select s.id,s.owner_id,s.case_id from private.verification_identity_submissions s
      join private.evidence_cases c on c.id=s.case_id
      join private.evidence_artifacts a on a.id=s.id_artifact_id
    where s.number_erased_at is null and c.status<>'open'
      and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp())
      and not internal.evidence_fraud_held(s.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=s.owner_id and h.released_at is null)
    order by s.owner_id,s.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    update private.verification_identity_submissions
      set number_ciphertext=null,number_iv=null,number_tag=null,number_erased_at=statement_timestamp()
    where id=candidate.id and number_erased_at is null
      and exists(select 1 from private.evidence_cases c join private.evidence_artifacts a on a.case_id=c.id
        where c.id=candidate.case_id and c.status<>'open' and a.id=id_artifact_id
          and (a.state in('cleanup_required','deleted') or a.retain_until<=statement_timestamp()))
      and not internal.evidence_fraud_held(candidate.case_id)
      and not exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null);
    if found then numbers:=numbers+1; end if;
  end loop;

  delete from private.verification_phone_proofs where id in(select p.id from private.verification_phone_proofs p
    where p.revoked_at<statement_timestamp()-interval '30 days' order by p.revoked_at limit p_limit for update skip locked);
  get diagnostics proofs=row_count;
  delete from private.verification_phone_challenges where id in(select c.id from private.verification_phone_challenges c
    where c.expires_at<statement_timestamp()-interval '24 hours'
      and not exists(select 1 from private.verification_phone_proofs p where p.challenge_id=c.id)
    order by c.expires_at limit p_limit for update skip locked);
  get diagnostics challenges=row_count;

  -- Thirty days after closure: home area and the consent records go
  -- (posting-terms acceptances, the sign-up Terms acceptance and the
  -- communication choice history, together). Each batch takes the oldest
  -- closed accounts that still hold such rows, so the sweep never stalls on
  -- accounts already cleared.
  delete from private.verification_localities where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.verification_localities l where l.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics localities=row_count;
  delete from private.posting_terms_acceptances where owner_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.posting_terms_acceptances a where a.owner_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics acceptances=row_count;
  delete from private.signup_terms_acceptances where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.signup_terms_acceptances a where a.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics signup_acceptances=row_count;
  delete from private.communication_choice_events where account_id in(select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '30 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and exists(select 1 from private.communication_choice_events e where e.account_id=x.user_id)
    order by x.closed_at limit p_limit);
  get diagnostics choice_events=row_count;

  -- Five years after closure: the verification history of the account, once
  -- every file is deleted and no ban still depends on it.
  for candidate in
    select x.user_id from private.account_closures x
    where x.closed_at<statement_timestamp()-interval '5 years'
      and not exists(select 1 from private.legal_holds h where h.subject_id=x.user_id and h.released_at is null)
      and not exists(select 1 from private.evidence_artifacts a where a.owner_id=x.user_id and a.state<>'deleted')
      and not exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=x.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)))
      and (exists(select 1 from private.evidence_cases c where c.subject_id=x.user_id
          and not exists(select 1 from private.decisions d where d.case_id=c.id and d.status='approved' and d.action='restrict_account'))
        or exists(select 1 from private.verification_phone_challenges p where p.owner_id=x.user_id))
    order by x.closed_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.user_id::text,2408)) then continue; end if;
    -- Candidate discovery may precede other subjects' work in this batch.
    -- Recheck preservation rules under the same lock used by hold writers.
    if exists(select 1 from private.legal_holds h where h.subject_id=candidate.user_id and h.released_at is null)
      or exists(select 1 from private.evidence_cases c join private.evidence_fraud_holds h on h.case_id=c.id
        where c.subject_id=candidate.user_id and h.closed_at is null)
      or exists(select 1 from private.evidence_artifacts a where a.owner_id=candidate.user_id and a.state<>'deleted')
      or exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
        where c.subject_id=candidate.user_id and (exists(select 1 from private.banned_identities b where b.decision_id=d.id)
          or exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id))) then continue; end if;
    select coalesce(array_agg(c.id),'{}') into cases from private.evidence_cases c where c.subject_id=candidate.user_id;
    delete from private.identity_submission_names where owner_id=candidate.user_id;
    delete from private.verification_current_submissions where case_id=any(cases);
    delete from private.identity_review_proposals where submission_id in(select s.id from private.verification_identity_submissions s
      where s.owner_id=candidate.user_id) or decision_id in(select d.id from private.decisions d where d.case_id=any(cases));
    delete from private.identity_ban_proposal_requests where owner_id=candidate.user_id;
    delete from private.accepted_identity_facts where owner_id=candidate.user_id;
    delete from private.decisions where case_id=any(cases) and not (status='approved' and action='restrict_account');
    delete from private.evidence_access_log where case_id=any(cases);
    delete from private.evidence_fraud_holds where case_id=any(cases);
    delete from private.verification_identity_submissions where owner_id=candidate.user_id;
    delete from private.evidence_artifacts where owner_id=candidate.user_id;
    delete from private.evidence_cases c where c.id=any(cases) and not exists(select 1 from private.decisions d where d.case_id=c.id);
    delete from private.verification_phone_proofs where owner_id=candidate.user_id;
    delete from private.verification_phone_challenges where owner_id=candidate.user_id;
    delete from private.legal_holds where subject_id=candidate.user_id and released_at is not null;
    histories:=histories+1;
  end loop;
  return jsonb_build_object('identity_numbers_erased',numbers,'phone_proofs',proofs,'phone_challenges',challenges,
    'closed_account_localities',localities,'closed_account_terms_acceptances',acceptances,
    'closed_account_signup_terms',signup_acceptances,'closed_account_communication_choices',choice_events,
    'closed_account_verification_histories',histories);
end;
$function$;
alter function internal.retention_verification(integer) owner to postgres;
revoke all on function internal.retention_verification(integer) from public, anon, authenticated, service_role;

-- 5. Finished account emails of the caller: sent, or failed for good (the
-- email job stops after 8 attempts; a last attempt still running or whose
-- outcome is unknown is not shown). Any signed-in, confirmed account with a
-- live session reads its own, also while restricted. Nothing that identifies
-- a recipient, record or provider error leaves the database.
CREATE OR REPLACE FUNCTION internal.list_my_email_history(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.consent_actor(); items jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'status', x.status, 'at', x.at)
      order by x.created_at desc, x.id), '[]'::jsonb)
    into items
  from (select o.id, o.kind, o.created_at,
      case when o.processed_at is not null then 'sent' else 'failed' end as status,
      coalesce(o.processed_at, o.created_at) as at
    from private.outbox_events o
    where o.owner_id = actor and (o.processed_at is not null
      or (o.delivery_attempts >= 8 and o.delivery_error is distinct from 'outcome_unknown'
        and (o.delivery_until is null or o.delivery_until < statement_timestamp())))
    order by o.created_at desc, o.id
    limit p_limit) x;
  return jsonb_build_object('items', items);
end;
$function$;
alter function internal.list_my_email_history(integer) owner to postgres;
revoke all on function internal.list_my_email_history(integer) from public, anon, authenticated, service_role;
grant execute on function internal.list_my_email_history(integer) to authenticated;

commit;
