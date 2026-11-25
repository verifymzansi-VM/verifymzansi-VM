-- Staff refunds: the first-purchase refund and part refunds (launch checklist
-- item 77).
--
-- The posting terms (posting-v6) promise two refunds that staff could not
-- record: a first purchase cancelled within 5 business days after its payment
-- is confirmed, refunded in full; and part of a payment (unused whole days less
-- the R50 cancellation fee, or a reasonable part for days we failed to
-- provide). Until now every refund was a whole payment or a whole slot.
--
-- Only adds: two new API commands, two new columns, wider table rules and new
-- internal helpers. No API command, argument, grant or result field is
-- removed or changed. In one transaction it:
--
-- 1. Adds api.record_staff_refund(p_payment_id, p_line_id, p_channel,
--    p_amount_cents, p_reason_code, p_reason, p_reference, p_ozow_fact,
--    p_asked_on) (capability payments:refund, an authenticator code from the
--    last 15 minutes, and the staff rule of money actions). One command for
--    every refund, in three ways: 'ozow' (the server sends it to Ozow, only in
--    Ozow's 13-day window), 'dashboard' (already refunded by hand in the Ozow
--    dashboard; p_reference is Ozow's refund id) and 'reference' (a bank
--    transfer back, or a refund recorded with Ozow's reference, under the
--    existing rules of internal.staff_refund_reference). Refunds only;
--    chargebacks stay whole, on the existing commands.
-- 2. The amount: p_amount_cents, or null for everything still left. It is
--    more than 0 and at most what is left on the slot and on the payment
--    (internal.refund_left_cents: paid, less refunds applied, waiting or on
--    their way through Ozow). The insert guard of
--    private.payment_refund_requests now holds every refund to what the
--    payment's and the slot's other refund records leave (PT409
--    refund_more_than_left) instead of requiring the full amount, so the
--    existing whole-refund commands can never pay back more than is left; a
--    chargeback is still the full amount.
-- 3. What happens to the slot (new column ends_paid_days, fixed when the
--    refund is recorded): the paid days end now (the slot or payment is
--    reversed as before: grant revoked, posts hidden, commission reversed)
--    unless the refund is a part of what is left for 'Our failure, after a
--    fix was offered' or 'Billing error': then the slot keeps running (or has
--    already ended) and only the money goes back. Either way the member gets
--    the neutral 'Payment update' email. Approving a waiting refund
--    (internal.approve_staff_payment_refund), Ozow confirming a refund it was
--    sent (internal.apply_ozow_refund_state) and recording one apply it
--    through one helper (internal.apply_staff_refund). A waiting renewal
--    blocks only a refund that ends the paid days (approving and sending
--    check it again, internal.claim_ozow_refund_send).
-- 4. The reason 'first_purchase_cancelled' (new column customer_asked_on,
--    required with it and only with it), accepted only by the new command:
--    the account's first purchase (no payment of the same account confirmed
--    earlier, whatever happened to it later), refunded in full (the whole
--    payment, nothing refunded before), for a written request the customer
--    made on p_asked_on: not before the payment was confirmed, not in the
--    future, and no later than the 5th business day after the day it was
--    confirmed (South African time). Business days are Monday to Friday
--    except the public holidays of the Public Holidays Act
--    (internal.za_public_holiday: the fixed dates, the Monday after one on a
--    Sunday, Good Friday and Family Day from the Easter date, and 27 December
--    when Christmas is on a Sunday). Holidays declared for one year only (for
--    example an election day) are not known in advance and are not counted.
-- 5. Adds api.get_staff_refunds_left(p_payment_ids) (capability
--    payments:view): for up to 50 payments, what was refunded, what is left
--    (per payment and per slot), each slot's paid dates, until when Ozow
--    refunds it, and whether it is the account's first purchase with the last
--    day to ask.
-- 6. internal.payment_net_cents (staff sales and the VAT registration count)
--    takes part refunds into account: a payment brings in its amount less the
--    refunds applied to it (and less reversed slots no refund record covers);
--    nothing once refunded or charged back without such a record, as before.
--
-- Two staff members above R1 000 (internal.refund_needs_approval) is
-- unchanged: the total returned on one payment, this refund included, so
-- splitting a refund does not avoid it. No row is written or changed.
--
-- ORDER: apply first, then merge. The Deploy gate probes every command of
-- ../runtime-api-manifest.json; the live website reads nothing new and offers
-- neither new value. It refuses with 55000 unless the five functions it
-- replaces have their reviewed bodies (or this update's) and the ones it adds
-- are absent (or this update's). Run again, it changes nothing.
-- Read-only preflight: ../preflight/20261125110216_staff_part_refunds.check.sql.
-- Rollback: ../rollback/20261125110216_staff_part_refunds.down.sql.
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
    from (values ('internal.payment_refund_request_guard()'),
      ('internal.payment_net_cents(private.payments)'),
      ('internal.approve_staff_payment_refund(uuid)'),
      ('internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text)'),
      ('internal.claim_ozow_refund_send(uuid)'),
      ('internal.za_public_holiday(date)'),
      ('internal.za_business_day(date)'),
      ('internal.first_purchase_last_ask_day(timestamp with time zone)'),
      ('internal.payment_is_first_purchase(uuid)'),
      ('internal.assert_first_purchase_refund(uuid,date)'),
      ('internal.refund_left_cents(uuid,uuid)'),
      ('internal.staff_refund_result(private.payment_refund_requests,boolean)'),
      ('internal.apply_staff_refund(uuid,uuid)'),
      ('internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)'),
      ('internal.get_staff_refunds_left(uuid[])'),
      ('api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)'),
      ('api.get_staff_refunds_left(uuid[])')) v(sig)
  loop
    if shape not in (
        'internal.payment_refund_request_guard() 11b86b7a627aad245c84433118601705',
        'internal.payment_refund_request_guard() 9e8a87d429606cdd7c092cee4ba695ba',
        'internal.payment_net_cents(private.payments) 28d85be00f5d30c0f2121b120ea55dc9',
        'internal.payment_net_cents(private.payments) 237b3d0054e49f02f2da9cd227d5c789',
        'internal.approve_staff_payment_refund(uuid) 189b3f24e9b847bf75760eeaae9b2686',
        'internal.approve_staff_payment_refund(uuid) be81e7fe3ff545e00e9cd5b0b26e1860',
        'internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) 431e2541a83cf8e892efd61aa5cacd4d',
        'internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) 0ea76f550ca87fa76fe8431f390ceb4c',
        'internal.claim_ozow_refund_send(uuid) c16477b6080ff5e7075f63936cd5383b',
        'internal.claim_ozow_refund_send(uuid) 3b5affd02d571f3aa264dfd17ad938cb',
        'internal.za_public_holiday(date) absent',
        'internal.za_public_holiday(date) b9cf3aed314a50c059acca41d3decc47',
        'internal.za_business_day(date) absent',
        'internal.za_business_day(date) 75386489557e85499d60cba6160b094a',
        'internal.first_purchase_last_ask_day(timestamp with time zone) absent',
        'internal.first_purchase_last_ask_day(timestamp with time zone) ef96b90f35d916053e7fa5ca05acebd4',
        'internal.payment_is_first_purchase(uuid) absent',
        'internal.payment_is_first_purchase(uuid) 3f369250c24ea059f2c3b13102981076',
        'internal.assert_first_purchase_refund(uuid,date) absent',
        'internal.assert_first_purchase_refund(uuid,date) 2d9dff6d73922a859999ad1f349bd614',
        'internal.refund_left_cents(uuid,uuid) absent',
        'internal.refund_left_cents(uuid,uuid) fceaee2d494b94bd4d1f38e1e4a0692e',
        'internal.staff_refund_result(private.payment_refund_requests,boolean) absent',
        'internal.staff_refund_result(private.payment_refund_requests,boolean) cfe27e3019d6875bdd690f86a5f8fdbb',
        'internal.apply_staff_refund(uuid,uuid) absent',
        'internal.apply_staff_refund(uuid,uuid) cb274221e355aaa375113f2a6fe204e1',
        'internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) absent',
        'internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) d076961cccdb12863765b3336cf7a6db',
        'internal.get_staff_refunds_left(uuid[]) absent',
        'internal.get_staff_refunds_left(uuid[]) 5df1c510531ea6e328ca33cba01e0b9f',
        'api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) absent',
        'api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) bf894de8138626297c957328cb812fd6',
        'api.get_staff_refunds_left(uuid[]) absent',
        'api.get_staff_refunds_left(uuid[]) d721ae75b29975a22c613227abf39aa4') then
      raise exception 'staff part refunds precondition: % is neither the reviewed body nor this update''s', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

-- 2.-4. The new columns and table rules. Existing records end the paid days
-- (as every refund did) and name no ask date.
alter table private.payment_refund_requests
  add column if not exists ends_paid_days boolean not null default true,
  add column if not exists customer_asked_on date;
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_reason_code_check,
  add constraint payment_refund_requests_reason_code_check check (reason_code = any (array['billing_error'::text,
    'duplicate'::text, 'our_failure_after_fix_offered'::text, 's14_cancellation'::text, 'breach_credit'::text,
    'renewal_cancelled_before_start'::text, 'first_purchase_cancelled'::text]));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_keeps_days,
  add constraint payment_refund_requests_keeps_days check (ends_paid_days
    or (kind = 'refunded' and reason_code = any (array['our_failure_after_fix_offered'::text, 'billing_error'::text])));
alter table private.payment_refund_requests drop constraint if exists payment_refund_requests_first_purchase,
  add constraint payment_refund_requests_first_purchase check ((reason_code = 'first_purchase_cancelled')
    = (customer_asked_on is not null)
    and (reason_code <> 'first_purchase_cancelled'
      or (kind = 'refunded' and ends_paid_days and payment_line_id is null)));

-- 4. Business days in South Africa.
CREATE OR REPLACE FUNCTION internal.za_public_holiday(p_day date)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  fixed constant text[] := array['01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26'];
  y integer; a integer; b integer; c integer; d integer; e integer; f integer; g integer; h integer;
  i integer; k integer; l integer; m integer; easter date;
begin
  if p_day is null then return null; end if;
  -- The fixed dates of the Public Holidays Act.
  if to_char(p_day, 'MM-DD') = any(fixed) then return true; end if;
  -- A public holiday on a Sunday: the Monday after it is one.
  if extract(isodow from p_day) = 1 and to_char(p_day - 1, 'MM-DD') = any(fixed) then return true; end if;
  -- Christmas on a Sunday: the Monday is already the Day of Goodwill, so the
  -- Tuesday (27 December) is kept free as well.
  if to_char(p_day, 'MM-DD') = '12-27' and extract(isodow from p_day) = 2 then return true; end if;
  -- Good Friday and Family Day (the Monday after Easter Sunday). Easter
  -- Sunday by the Gregorian calendar (the anonymous algorithm).
  y := extract(year from p_day)::integer;
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  easter := make_date(y, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
  return p_day = easter - 2 or p_day = easter + 1;
end;
$function$;
revoke all on function internal.za_public_holiday(date) from public;

CREATE OR REPLACE FUNCTION internal.za_business_day(p_day date)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Monday to Friday, except a public holiday (internal.za_public_holiday).
  select extract(isodow from p_day) < 6 and not internal.za_public_holiday(p_day);
$function$;
revoke all on function internal.za_business_day(date) from public;

CREATE OR REPLACE FUNCTION internal.first_purchase_last_ask_day(p_confirmed timestamp with time zone)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare day date; counted integer := 0;
begin
  -- The 5th business day after the day the payment was confirmed (South
  -- African time): the last day a customer may ask to cancel a first purchase.
  if p_confirmed is null then return null; end if;
  day := (p_confirmed at time zone 'Africa/Johannesburg')::date;
  while counted < 5 loop
    day := day + 1;
    if internal.za_business_day(day) then counted := counted + 1; end if;
  end loop;
  return day;
end;
$function$;
revoke all on function internal.first_purchase_last_ask_day(timestamp with time zone) from public;

CREATE OR REPLACE FUNCTION internal.payment_is_first_purchase(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A confirmed payment of a (not erased) account, with no payment of the same
  -- account confirmed before it, whatever happened to that one later.
  select coalesce((select p.owner_id is not null and p.completed_at is not null
      and not exists(select 1 from private.payments q where q.owner_id = p.owner_id and q.id <> p.id
        and q.status in ('complete', 'refunded', 'chargeback') and q.completed_at is not null
        and (q.completed_at, q.id) < (p.completed_at, p.id))
    from private.payments p where p.id = p_payment_id), false);
$function$;
revoke all on function internal.payment_is_first_purchase(uuid) from public;

CREATE OR REPLACE FUNCTION internal.assert_first_purchase_refund(p_payment_id uuid, p_asked_on date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
  select * into pay from private.payments p where p.id = p_payment_id;
  if pay.owner_id is null then
    raise exception 'the account that paid was erased, so its first purchase cannot be checked'
      using errcode='PT409', detail='first_purchase_account_erased';
  end if;
  if not internal.payment_is_first_purchase(pay.id) then
    raise exception 'this is not the account''s first purchase' using errcode='PT409', detail='first_purchase_not_first';
  end if;
  if p_asked_on is null then
    raise exception 'the date the customer asked in writing is required' using errcode='22023',
      detail='first_purchase_asked_on_required';
  end if;
  if p_asked_on < (pay.completed_at at time zone 'Africa/Johannesburg')::date or p_asked_on > today then
    raise exception 'the date the customer asked must be between the day the payment was confirmed and today'
      using errcode='22023', detail='first_purchase_asked_on_invalid';
  end if;
  if p_asked_on > internal.first_purchase_last_ask_day(pay.completed_at) then
    raise exception 'the customer asked after the 5 business days for cancelling a first purchase'
      using errcode='PT409', detail='first_purchase_too_late';
  end if;
end;
$function$;
revoke all on function internal.assert_first_purchase_refund(uuid,date) from public;

-- 2. What is still left to refund.
CREATE OR REPLACE FUNCTION internal.refund_left_cents(p_payment_id uuid, p_line_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The payment's amount less what was refunded or charged back, waits for
  -- approval or is on its way through Ozow (internal.payment_refunded_before_cents);
  -- for one slot, also at most the slot's amount less the same for that slot.
  -- A slot reversed without a refund record of its own has nothing left.
  select greatest(least(
      p.amount_cents - internal.payment_refunded_before_cents(p.id),
      case when p_line_id is null then p.amount_cents
        else (select case when l.status = 'reversed' and not exists(select 1 from private.payment_refund_requests r
              where r.payment_line_id = l.id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent'))
            then 0
            else l.amount_cents - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
              where r.payment_line_id = l.id and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0) end
          from private.payment_lines l where l.id = p_line_id and l.payment_id = p.id) end), 0)::bigint
  from private.payments p where p.id = p_payment_id;
$function$;
revoke all on function internal.refund_left_cents(uuid,uuid) from public;

CREATE OR REPLACE FUNCTION internal.staff_refund_result(p_request private.payment_refund_requests, p_repeated boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', p_request.id, 'status', p_request.status, 'channel', p_request.channel,
    'kind', p_request.kind, 'line_id', p_request.payment_line_id, 'amount_cents', p_request.amount_cents,
    'needs_approval', p_request.needs_approval, 'ends_paid_days', p_request.ends_paid_days,
    'released_activations', p_request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = p_request.payment_id),
    'repeated', p_repeated);
$function$;
revoke all on function internal.staff_refund_result(private.payment_refund_requests,boolean) from public;

-- 3. The effect of a refund record that was just applied.
CREATE OR REPLACE FUNCTION internal.apply_staff_refund(p_request_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; result jsonb;
begin
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  if not found or request.status <> 'applied' or request.released_activations is not null then
    raise exception 'only a refund just applied takes effect' using errcode='22023';
  end if;
  if not request.ends_paid_days then
    -- Only money goes back: the slot keeps running (or has already ended).
    if request.account_id is not null then
      insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
      values ('payment_reversed', request.payment_id, request.account_id, 'payment_part_refund:' || request.id);
    end if;
    result := jsonb_build_object('status', request.kind, 'released_activations', 0);
  elsif request.payment_line_id is null then
    result := internal.reverse_payment(request.payment_id, request.kind, request.reason);
    insert into private.frontend_payment_reversals(payment_id, actor_id, kind, reason, released_activations)
      values (request.payment_id, p_actor, request.kind, request.reason, (result->>'released_activations')::integer);
  else
    result := internal.reverse_payment_line(request.payment_line_id, request.kind, request.reason, p_actor);
  end if;
  update private.payment_refund_requests set released_activations = (result->>'released_activations')::integer
    where id = request.id;
  return result;
end;
$function$;
revoke all on function internal.apply_staff_refund(uuid,uuid) from public;

-- 1. The refund command.
CREATE OR REPLACE FUNCTION internal.record_staff_refund(p_payment_id uuid, p_line_id uuid, p_channel text, p_amount_cents bigint, p_reason_code text, p_reason text, p_reference text, p_ozow_fact jsonb, p_asked_on text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; payment uuid; pay private.payments; line private.payment_lines;
  prior private.payment_refund_requests; request private.payment_refund_requests; channel text;
  transaction uuid; refund_id uuid; reference text; left_cents bigint; amount bigint; refunded_before bigint;
  approval boolean; ends boolean; asked date; new_id uuid := pg_catalog.gen_random_uuid();
begin
  actor := internal.staff_actor('payments:refund');
  -- The day the customer asked (YYYY-MM-DD), for a first purchase.
  if p_asked_on is not null then
    if p_asked_on !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'the date the customer asked must be a date (YYYY-MM-DD)' using errcode='22023',
        detail='first_purchase_asked_on_invalid';
    end if;
    begin
      asked := p_asked_on::date;
    exception when others then
      raise exception 'the date the customer asked must be a date (YYYY-MM-DD)' using errcode='22023',
        detail='first_purchase_asked_on_invalid';
    end;
  end if;
  channel := case p_channel when 'ozow' then 'api' when 'dashboard' then 'dashboard' when 'reference' then 'manual' end;
  if channel is null then raise exception 'refund channel required' using errcode='22023'; end if;
  -- The one list of reasons, and the first-purchase reason (only here).
  if p_reason_code = 'first_purchase_cancelled' then
    if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
      raise exception 'audit reason required' using errcode='22023';
    end if;
  else
    perform internal.assert_staff_refund_reason('refunded', p_reason_code, p_reason);
    if asked is not null then
      raise exception 'the date the customer asked is only for a first purchase' using errcode='22023',
        detail='refund_asked_on_unexpected';
    end if;
  end if;
  if p_amount_cents is not null and p_amount_cents < 1 then
    raise exception 'a refund is at least 1 cent' using errcode='22023', detail='refund_amount_invalid';
  end if;
  if p_payment_id is null then raise exception 'payment required' using errcode='22023'; end if;
  select p.owner_id, p.id into buyer, payment from private.payments p where p.id = p_payment_id;
  if payment is null then raise exception 'payment not found' using errcode='22023'; end if;
  if p_line_id is not null and not exists(select 1 from private.payment_lines l
      where l.id = p_line_id and l.payment_id = payment) then
    raise exception 'slot payment line not found' using errcode='22023';
  end if;
  if channel = 'dashboard' then
    if p_reference is null or btrim(p_reference) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Ozow refund id required' using errcode='22023', detail='ozow_refund_id_required';
    end if;
    refund_id := lower(btrim(p_reference))::uuid;
    -- The refund as the website read it from Ozow, when it could: it only refuses.
    if p_ozow_fact is not null and (not internal.valid_ozow_refund_fact(p_ozow_fact)
        or p_ozow_fact->>'refund_id' is distinct from refund_id::text) then
      raise exception 'valid Ozow refund required' using errcode='22023';
    end if;
  elsif p_ozow_fact is not null or (channel = 'api' and p_reference is not null) then
    raise exception 'refund channel required' using errcode='22023';
  elsif channel = 'manual' then
    reference := internal.staff_refund_reference(payment, p_reference, 'refunded');
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
  if channel = 'dashboard' then
    -- A declined record took no effect, so its refund id may be recorded again.
    select * into prior from private.payment_refund_requests r
      where r.ozow_refund_id = refund_id and r.status <> 'declined';
    if not found then
      select * into prior from private.payment_refund_requests r
        where r.channel = 'manual' and r.status <> 'declined' and lower(r.ozow_reference) = refund_id::text;
    end if;
  elsif channel = 'api' then
    select * into prior from private.payment_refund_requests r
      where r.payment_id = pay.id and r.channel = 'api' and r.status in ('awaiting_approval', 'approved', 'sent')
        and r.payment_line_id is not distinct from line.id and r.reason_code = p_reason_code
        and r.reason = btrim(p_reason) and r.requested_by = actor;
  else
    select * into prior from private.payment_refund_requests r
      where lower(r.ozow_reference) = lower(reference) and r.status <> 'declined';
  end if;
  if prior.id is not null then
    if prior.channel = channel and prior.payment_id = pay.id and prior.payment_line_id is not distinct from line.id
        and prior.kind = 'refunded' and prior.reason_code = p_reason_code and prior.reason = btrim(p_reason)
        and prior.requested_by = actor and (p_amount_cents is null or prior.amount_cents = p_amount_cents)
        and prior.customer_asked_on is not distinct from asked then
      return internal.staff_refund_result(prior, true);
    end if;
    if channel = 'dashboard' then
      raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
    elsif channel = 'manual' then
      if internal.refund_by_bank_transfer(pay.id, 'refunded') then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
  end if;
  if pay.status <> 'complete' or exists(select 1 from private.frontend_payment_reversals v where v.payment_id = pay.id)
      or (p_line_id is not null and line.status <> 'open') then
    raise exception 'only a completed payment or open slot that was not reversed can be refunded' using errcode='PT409', detail='payment_not_refundable';
  end if;
  if p_line_id is null and exists(select 1 from private.payment_lines l where l.payment_id = pay.id and l.status = 'reversed') then
    raise exception 'a slot of this payment was already reversed; refund its other slots one by one' using errcode='PT409', detail='payment_slot_reversed';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  -- Not while a refund through Ozow is on its way: Ozow may still pay it.
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.channel = 'api'
      and r.status in ('approved', 'sent')) then
    raise exception 'a refund of this payment is on its way through Ozow' using errcode='PT409', detail='refund_in_flight';
  end if;
  -- The amount: everything left, or a part of it.
  left_cents := internal.refund_left_cents(pay.id, line.id);
  if left_cents < 1 then
    raise exception 'nothing is left to refund on this payment' using errcode='PT409', detail='refund_more_than_left';
  end if;
  amount := coalesce(p_amount_cents, left_cents);
  if amount > left_cents then
    raise exception 'at most % cents are left to refund', left_cents using errcode='PT409', detail='refund_more_than_left';
  end if;
  -- The slot keeps running only for a part refund of our failure or a billing error.
  ends := amount = left_cents or p_reason_code not in ('our_failure_after_fix_offered', 'billing_error');
  if p_reason_code = 'first_purchase_cancelled' then
    if p_line_id is not null or amount <> pay.amount_cents then
      raise exception 'a first purchase is refunded in full: the whole payment, with nothing refunded before'
        using errcode='PT409', detail='first_purchase_whole_payment';
    end if;
    perform internal.assert_first_purchase_refund(pay.id, asked);
  end if;
  if p_reason_code in ('duplicate', 'renewal_cancelled_before_start') and amount <> left_cents then
    raise exception 'this reason refunds everything left' using errcode='PT409', detail='refund_whole_only';
  end if;
  if p_reason_code = 'renewal_cancelled_before_start' and not internal.refund_renewal_not_started(pay.id, line.id) then
    raise exception 'this reason is only for a renewal whose days have not started' using errcode='PT409', detail='renewal_already_started';
  end if;
  if ends and internal.refund_renewal_waiting(pay.id, line.id) then
    raise exception 'a renewal of this slot is waiting; refund the renewal first, then this period' using errcode='PT409', detail='renewal_queued';
  end if;
  if channel in ('api', 'dashboard') then
    transaction := internal.ozow_refund_transaction(pay.id);
    if transaction is null then
      raise exception 'this payment was not paid through Ozow; record its refund with its reference' using errcode='PT409', detail='payment_not_ozow';
    end if;
  end if;
  -- Ozow refunds a payment only within its window (internal.ozow_refund_window);
  -- after that staff pay it back by bank transfer and record the bank reference.
  -- A refund already made in the Ozow dashboard is recorded whenever it was made.
  if channel = 'api' and not internal.ozow_refund_window_open(pay.id) then
    raise exception 'Ozow refunds only within 13 days of the payment; pay it back by bank transfer and record the bank reference'
      using errcode='PT409', detail='outside_refund_window';
  end if;
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
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  -- The same reference recorded at the same moment for another payment: the
  -- unique index decides; say so in the reference's words.
  declare violated text;
  begin
    insert into private.payment_refund_requests (id, payment_id, payment_line_id, account_id, kind, reason_code, reason,
        ozow_reference, amount_cents, recorded_before_cents, needs_approval, status, requested_by, applied_at,
        channel, approved_at, ozow_transaction_id, ozow_refund_id, ends_paid_days, customer_asked_on)
      values (new_id, pay.id, line.id, pay.owner_id, 'refunded', p_reason_code, btrim(p_reason),
        case channel when 'api' then 'vm-refund-' || new_id::text when 'dashboard' then refund_id::text || ':' || new_id::text
          else reference end,
        amount, refunded_before, approval,
        case when approval then 'awaiting_approval' when channel = 'api' then 'approved' else 'applied' end, actor,
        case when not approval and channel <> 'api' then statement_timestamp() end,
        channel, case when channel = 'api' and not approval then statement_timestamp() end,
        transaction, refund_id, ends, asked)
      returning * into request;
  exception when unique_violation then
    get stacked diagnostics violated = constraint_name;
    if violated in ('payment_refund_requests_reference_idx', 'payment_refund_requests_ozow_key_idx',
        'payment_refund_requests_ozow_refund_idx') then
      if channel = 'dashboard' then
        raise exception 'this Ozow refund was already recorded' using errcode='PT409', detail='ozow_refund_id_used';
      end if;
      if internal.refund_by_bank_transfer(pay.id, 'refunded') then
        raise exception 'this refund reference was already recorded' using errcode='PT409', detail='refund_reference_used';
      end if;
      raise exception 'this Ozow reference was already recorded' using errcode='PT409', detail='ozow_reference_used';
    end if;
    raise;
  end;
  -- Recorded and not waiting (a reference or the dashboard): it takes effect now.
  if request.status = 'applied' then
    perform internal.apply_staff_refund(request.id, actor);
  end if;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  select * into request from private.payment_refund_requests r where r.id = new_id;
  return internal.staff_refund_result(request, false);
end;
$function$;
revoke all on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) from public;
grant execute on function internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_refund(p_payment_id uuid, p_line_id uuid, p_channel text, p_amount_cents bigint, p_reason_code text, p_reason text, p_reference text, p_ozow_fact jsonb, p_asked_on text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_refund(p_payment_id, p_line_id, p_channel, p_amount_cents, p_reason_code, p_reason,
    p_reference, p_ozow_fact, p_asked_on);
$function$;
revoke all on function api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) from public;
grant execute on function api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) to authenticated;

-- 5. What is left to refund, for the staff payments list.
CREATE OR REPLACE FUNCTION internal.get_staff_refunds_left(p_payment_ids uuid[])
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
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id,
      'refunded_cents', internal.payment_refunded_before_cents(p.id),
      'left_cents', case when p.status = 'complete' then internal.refund_left_cents(p.id, null) else 0 end,
      'ozow_refund_until', case when internal.ozow_refund_transaction(p.id) is not null
        then p.created_at + internal.ozow_refund_window() end,
      'first_purchase', internal.payment_is_first_purchase(p.id),
      'first_purchase_ask_until', case when internal.payment_is_first_purchase(p.id)
        then internal.first_purchase_last_ask_day(p.completed_at) end,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('line_id', l.id,
          'left_cents', case when p.status = 'complete' and l.status = 'open'
            then internal.refund_left_cents(p.id, l.id) else 0 end,
          'starts_at', (select min(e.starts_at) from private.entitlements e where e.payment_line_id = l.id),
          'ends_at', (select max(e.ends_at) from private.entitlements e where e.payment_line_id = l.id))
        order by l.line_number) from private.payment_lines l where l.payment_id = p.id), '[]'::jsonb))
    order by p.id), '[]'::jsonb)
    into result
    from private.payments p where p.id = any(p_payment_ids);
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
revoke all on function internal.get_staff_refunds_left(uuid[]) from public;
grant execute on function internal.get_staff_refunds_left(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_refunds_left(p_payment_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_refunds_left(p_payment_ids);
$function$;
revoke all on function api.get_staff_refunds_left(uuid[]) from public;
grant execute on function api.get_staff_refunds_left(uuid[]) to authenticated;

-- 2. The insert guard: at most what is left (chargebacks: the full amount).
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
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    -- A chargeback is the paid amount of the payment or slot; a refund is at
    -- most what is left of it (20261125110216_staff_part_refunds.sql).
    if new.kind = 'chargeback' and new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    -- (What the other refund records of the payment, and of the slot, leave;
    -- the commands check reversed slots themselves, and a whole-payment or
    -- slot reversal is made before its record is written.)
    if new.kind = 'refunded' and (new.amount_cents > (select p.amount_cents from private.payments p where p.id = new.payment_id)
          - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r where r.payment_id = new.payment_id
            and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0)
        or (new.payment_line_id is not null and new.amount_cents > (select l.amount_cents from private.payment_lines l
            where l.id = new.payment_line_id)
          - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r where r.payment_line_id = new.payment_line_id
            and r.status in ('applied', 'awaiting_approval', 'approved', 'sent')), 0))) then
      raise exception 'a refund is at most what is left of the payment' using errcode='PT409', detail='refund_more_than_left';
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
revoke all on function internal.payment_refund_request_guard() from public;

-- 6. What a payment brought in, with part refunds.
CREATE OR REPLACE FUNCTION internal.payment_net_cents(p private.payments)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- What the payment brought in: its amount less the refunds and chargebacks
  -- applied to it, and less its reversed slots that no applied refund record
  -- covers. Nothing once the whole payment was refunded or charged back
  -- without a record of that kind (for example a bank's chargeback notice).
  select case when p.status in ('refunded', 'chargeback') and not exists(select 1 from private.payment_refund_requests r
      where r.payment_id = p.id and r.status = 'applied' and r.kind = p.status) then 0::bigint
    else greatest(p.amount_cents
      - coalesce((select sum(r.amount_cents) from private.payment_refund_requests r
        where r.payment_id = p.id and r.status = 'applied'), 0)
      - coalesce((select sum(l.amount_cents) from private.payment_lines l
        where l.payment_id = p.id and l.status = 'reversed'
          and not exists(select 1 from private.payment_refund_requests r where r.payment_id = p.id
            and r.status = 'applied' and r.ends_paid_days and (r.payment_line_id = l.id or r.payment_line_id is null))), 0),
      0)::bigint end;
$function$;
revoke all on function internal.payment_net_cents(private.payments) from public;

-- 3. Approving a waiting refund applies it through internal.apply_staff_refund.
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
  -- first (decline this one and record it again afterwards). Only a refund
  -- that ends the paid days (20261125110216_staff_part_refunds.sql).
  if request.kind = 'refunded' and request.ends_paid_days
      and internal.refund_renewal_waiting(pay.id, request.payment_line_id) then
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
  result := internal.apply_staff_refund(request.id, actor);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, request.account_id);
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  return jsonb_build_object('request_id', request.id, 'status', request.status, 'kind', request.kind,
    'released_activations', request.released_activations,
    'payment_status', (select p.status from private.payments p where p.id = pay.id), 'repeated', false);
end;
$function$;
revoke all on function internal.approve_staff_payment_refund(uuid) from public;
grant execute on function internal.approve_staff_payment_refund(uuid) to authenticated;

-- 3. Ozow confirming a refund it was sent applies it through internal.apply_staff_refund.
CREATE OR REPLACE FUNCTION internal.apply_ozow_refund_state(p_request_id uuid, p_status text, p_requested_at timestamp with time zone, p_completed_at timestamp with time zone, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare request private.payment_refund_requests; outcome text; actor uuid;
begin
  select * into request from private.payment_refund_requests r where r.id = p_request_id;
  outcome := case when p_status = 'Complete' then 'complete' when p_status = 'Returned' then 'returned'
    when p_status in ('Failed', 'Error', 'Invalid', 'Cancelled') then 'failed' else 'pending' end;
  -- Ozow has this refund after all: an earlier "missing" no longer holds.
  if request.ozow_missing_at is not null then
    update private.payment_refund_requests set ozow_missing_at = null where id = request.id
      returning * into request;
  end if;
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
      -- internal.payment_reversal_waiting_guard; one transaction. A part
      -- refund that keeps the slot running only returns money
      -- (20261125110216_staff_part_refunds.sql).
      update private.payment_refund_requests set status = 'applied', applied_at = statement_timestamp(),
        send_outcome = 'accepted' where id = request.id;
      perform internal.apply_staff_refund(request.id, actor);
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
revoke all on function internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text) from public;

-- 3. Before sending, a waiting renewal blocks only a refund that ends the paid days.
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
        or (request.ends_paid_days and internal.refund_renewal_waiting(request.payment_id, request.payment_line_id))
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
revoke all on function internal.claim_ozow_refund_send(uuid) from public;
grant execute on function internal.claim_ozow_refund_send(uuid) to service_role;

commit;
