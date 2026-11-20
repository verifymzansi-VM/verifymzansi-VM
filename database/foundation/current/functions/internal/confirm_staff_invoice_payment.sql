-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint; inv private.customer_invoices;
  is_package boolean; add_package uuid;
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
  -- 20261120045404: an added-slots invoice adds them to the package it names.
  add_package := internal.package_add_invoice_package(t.customer_invoice_id);
  if is_package then
    -- One package per account at a time, only while packages are on sale (as
    -- an Ozow payment of a package is delivered).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||t.account_id::text, 707));
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale; decline this transfer and return the money'
        using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if add_package is not null then
      -- Added slots only while the package still runs, with room; money that
      -- arrives after it ended is returned in full (D1).
      if not internal.slot_package_add_ok(t.account_id, add_package, t.slots) then
        raise exception 'the customer''s package has ended (or has no room); decline this transfer and return the money in full'
          using errcode='PT409', detail='package_ended';
      end if;
    elsif internal.slot_package_open(t.account_id) then
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
    if (case when add_package is not null
          then (select i.total_cents from private.customer_invoices i where i.id = t.customer_invoice_id)
          else plan.price_cents * t.slots end) is distinct from t.amount_received_cents then
      raise exception 'the recorded amount is not the order total' using errcode='PT428', detail='invoice_amount_mismatch';
    end if;
  else
    -- E3 (20261114154823): while the person's Multi-listing package runs (until
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid;
    -- except (D6, 20261119151152) a transfer to an invoice issued before the
    -- package started: its slots run beside the package to their own end. A
    -- transfer recorded without an invoice is refused as before.
    if internal.slot_package_blocks_invoice(fingerprint, t.account_id,
        (select i.issued_at from private.customer_invoices i where i.id = t.customer_invoice_id)) then
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
            'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately'))
          -- Added slots (20261120045404): delivered into the package asked for.
          || case when add_package is null then '{}'::jsonb else jsonb_build_object('category', 'slot_package_add',
            'package_id', add_package, 'unit_price_cents', inv.unit_price_cents) end,
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
    'slots_started', made, 'ends_at', case when add_package is not null
      then (select max(e.ends_at) from private.entitlements e where e.payment_id = pay.id)
      else statement_timestamp() + make_interval(days => plan.duration_days) end,
    'repeated', false);
end;
$function$;
alter function internal.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function internal.confirm_staff_invoice_payment(uuid) from public;
grant execute on function internal.confirm_staff_invoice_payment(uuid) to authenticated;
