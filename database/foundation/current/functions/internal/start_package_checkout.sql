-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
