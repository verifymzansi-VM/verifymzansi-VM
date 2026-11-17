-- Reviewed rollback for updates/20261117141803_bank_transfer_expiry.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It refuses (55000) once any bank transfer has expired (the earlier schema
-- cannot hold that state; rolling back would lose it), and unless the six
-- functions have this update's bodies (a later update changed one: undo that
-- update first). Otherwise it drops the sweep, the two reads and the setting,
-- puts back the earlier bodies of the six functions and of the staff audit
-- view byte for byte, the earlier unique indexes and status rule, and drops
-- expired_at. Before rolling back, deploy a website that no longer calls the
-- sweep or the reads (the release from the same pull request tolerates their
-- absence, so it may stay).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.invoice_transfer_guard()'),
      ('internal.confirm_staff_invoice_payment(uuid)'),
      ('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.invoice_transfer_dto(private.invoice_transfers,uuid)'),
      ('internal.retention_commerce(integer)')) v(sig)
  loop
    if shape not in (
        'internal.invoice_transfer_guard() af70f9825c745ba7b8befd4fac7eb172',
        'internal.confirm_staff_invoice_payment(uuid) d5e6989a1e81cd2936ed9294aecb4574',
        'internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text) 76c273eb51960b75755d1adf6725772f',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 131c741d783cdd500496d1ce049ae0b0',
        'internal.invoice_transfer_dto(private.invoice_transfers,uuid) de3c7355b17b84d785e06abe80aa8e91',
        'internal.retention_commerce(integer) 55051470a07c224838cb58dc45d66406') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.invoice_transfers t where t.status = 'expired') then
    raise exception 'rollback precondition: % bank transfers have expired; the earlier schema cannot hold them (fix forward)',
      (select count(*) from private.invoice_transfers t where t.status = 'expired') using errcode='55000';
  end if;
end$$;

drop function if exists api.expire_waiting_bank_transfers(integer);
drop function if exists internal.expire_waiting_bank_transfers(integer);
drop function if exists api.get_staff_expired_invoice_transfers();
drop function if exists internal.get_staff_expired_invoice_transfers();
drop function if exists api.get_my_invoice_transfer_expiry(text);
drop function if exists internal.get_my_invoice_transfer_expiry(text);

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
  if cleared > today or cleared < today - 90 then
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
  -- The same bank credit waiting or confirmed: the same request again by the
  -- same staff member returns it; anything else is refused.
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key
      and t.amount_received_cents = inv.total_cents and t.cleared_on = cleared and t.status <> 'declined';
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
      and t.status = 'awaiting_confirmation') then
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
revoke all on function internal.invoice_transfer_dto(private.invoice_transfers,uuid) from public;

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
  -- declined or recorded, and always with the invoice they name.
  delete from private.invoice_transfers where id in(select t.id from private.invoice_transfers t
    where internal.retention_tax_year_due(coalesce(t.confirmed_at,t.declined_at,t.recorded_at))
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

drop function if exists internal.invoice_transfer_expires_after();

drop index if exists private.invoice_transfers_expired_idx;
drop index if exists private.invoice_transfers_open_reference_idx;
create unique index invoice_transfers_open_reference_idx on private.invoice_transfers
  (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]', '', 'g')), amount_received_cents, cleared_on)
  where status <> 'declined'::text;
drop index if exists private.invoice_transfers_customer_invoice_open_idx;
create unique index invoice_transfers_customer_invoice_open_idx on private.invoice_transfers (customer_invoice_id)
  where customer_invoice_id is not null and status <> 'declined'::text;
alter table private.invoice_transfers drop constraint if exists invoice_transfers_expired,
  drop constraint if exists invoice_transfers_status_check,
  add constraint invoice_transfers_status_check
    check (status = any (array['awaiting_confirmation'::text, 'confirmed'::text, 'declined'::text]));
alter table private.invoice_transfers drop column if exists expired_at;

notify pgrst,'reload schema';
commit;
