-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_package_add_checkout(p_package_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); q record; plan private.plan_versions; pay private.payments;
  total bigint; open_slots integer;
begin
  if p_package_id is null or p_slots is null or p_expected_total_cents is null then
    raise exception 'package, number of slots and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you add slots' using errcode='PT412';
  end if;
  -- This account, then its package, as the package checkout locks them.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is distinct from p_package_id then
    raise exception 'this package has ended' using errcode='PT409', detail='package_ended';
  end if;
  if q.days_left < 7 then
    raise exception 'slots can be added while 7 or more days of the package are left'
      using errcode='PT409', detail='package_add_too_late';
  end if;
  select v.* into plan from private.plan_versions v where v.id = q.plan_id;
  if not found then
    raise exception 'this package term is not on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  if p_slots < 1 or q.places + p_slots > 250 then
    raise exception 'a package holds at most 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  total := q.unit_price_cents * p_slots;
  -- More than 100 slots in all, or above the most Ozow accepts in one payment:
  -- by invoice.
  if q.places + p_slots > 100 or total > internal.online_payment_max_cents() then
    raise exception 'adds above 100 slots in all or the online payment limit of % cents are paid by invoice',
      internal.online_payment_max_cents() using errcode='PT413', detail='package_invoice_required';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  if exists(select 1 from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
      where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)) then
    raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  -- One package order open at a time (a new package or an add; an invoice's
  -- own Pay now attempts are the invoice's).
  select p.* into pay from private.payments p join private.plan_versions v on v.id = p.plan_version_id
    where p.owner_id = actor and p.status = 'pending' and p.target_post_id is null
      and internal.slot_package_plan(v.plan_code)
      and not exists(select 1 from private.customer_invoice_payments l where l.payment_id = p.id)
    order by p.created_at desc, p.id limit 1
    for update of p;
  if found then
    select l.slot_count into open_slots from private.payment_lines l where l.payment_id = pay.id and l.line_number = 1;
    if pay.checkout_url is not null then
      -- Open at Ozow: the member continues, checks or cancels it first.
      perform internal.price_draft_actor();
      return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
        'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
        'slots', open_slots, 'package', true, 'reused', true);
    elsif pay.checkout_claim_until > clock_timestamp() then
      raise exception 'checkout is being created' using errcode='PT409';
    end if;
    if not (pay.snapshot->>'category' = 'slot_package_add' and pay.snapshot->>'package_id' = p_package_id::text
        and open_slots = p_slots and pay.amount_cents = total
        and pay.created_at > statement_timestamp() - interval '30 minutes') then
      -- Never sent to Ozow, so it can never be paid: replaced.
      update private.payments set status = 'cancelled', status_changed_at = clock_timestamp() where id = pay.id;
      pay := null;
    end if;
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan',
        'category', 'slot_package_add', 'package_id', q.package_id,
        'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'unit_price_cents', q.unit_price_cents, 'days_left', q.days_left,
        'package_ends_at', q.ends_at, 'slots', p_slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', p_slots,
        'activations_per_period', plan.activations_per_period * p_slots,
        'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', 'Multi-listing package: ' || p_slots::text
          || case when p_slots = 1 then ' slot' else ' slots' end || ' added for ' || q.days_left::text || ' days',
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording_version', 'package-add-starts-now-v1',
          'wording', 'My added slots start now and end with my package; the 7-day cooling-off does not apply because the service starts immediately')))
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
alter function internal.start_package_add_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_package_add_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function internal.start_package_add_checkout(uuid,integer,bigint,boolean) to authenticated;
