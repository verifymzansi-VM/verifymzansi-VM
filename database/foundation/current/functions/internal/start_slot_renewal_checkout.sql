-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_slot_renewal_checkout(p_entitlement_ids uuid[], p_plan_id uuid, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  pay private.payments;
  open_pay private.payments;
  fingerprint text;
  slots integer;
  chains uuid[];
  open_chains uuid[];
  total bigint;
  slot_limit integer;
  lines integer;
begin
  if p_entitlement_ids is null or coalesce(array_ndims(p_entitlement_ids), 0) <> 1
    or cardinality(p_entitlement_ids) not between 1 and 25 or array_position(p_entitlement_ids, null) is not null
    or p_plan_id is null or p_expected_total_cents is null then
    raise exception 'slots to renew, term and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  slots := cardinality(p_entitlement_ids);
  perform internal.lock_evidence_subject(actor);
  select * into plan from private.plan_versions v
    where v.id=p_plan_id and v.retired_at is null and v.is_public and internal.individual_slot_plan(v.plan_code);
  if not found then raise exception 'this slot is not on sale' using errcode='22023'; end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you renew a slot' using errcode='PT412';
  end if;
  -- Each id must be a period of one of this account's Individual slots that
  -- is still running; anything else (another account's slot included) reads
  -- as not found.
  if exists(select 1 from unnest(p_entitlement_ids) x(id) where not exists(
      select 1 from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id and l.payment_id=e.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
        join private.payments p on p.id=e.payment_id
      where e.id=x.id and e.owner_id=actor and e.source='retail_paid' and e.status='active' and l.status='open'
        and p.status='complete' and p.owner_id=actor and internal.individual_slot_plan(v.plan_code)
        and internal.slot_chain_held(e.id))) then
    raise exception 'slot not found' using errcode='PT404', detail='slot_unavailable';
  end if;
  select array_agg(distinct coalesce(e.slot_id, e.id) order by coalesce(e.slot_id, e.id)) into chains
    from private.entitlements e where e.id = any(p_entitlement_ids);
  if cardinality(chains) <> slots then
    raise exception 'each slot can be renewed once per order' using errcode='22023';
  end if;
  -- Renewing opens 14 days (internal.slot_renewal_window) before the slot ends.
  if exists(select 1 from unnest(p_entitlement_ids) x(id)
      where internal.slot_chain_last_end(x.id) > clock_timestamp() + internal.slot_renewal_window()) then
    raise exception 'a slot can be renewed from % before it ends', internal.slot_renewal_window()
      using errcode='PT409', detail='renewal_not_open';
  end if;
  total := plan.price_cents * slots;
  if total > 1000000 then
    raise exception 'orders above R10,000 are paid by invoice' using errcode='PT413';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  -- Pending orders: a renewal of the same slots for the same term is
  -- continued. Another order for this term (one order per term can be open)
  -- or another renewal naming any of these slots is cancelled when it was
  -- never sent to Ozow, and otherwise returned (continue, check or cancel it
  -- first).
  for open_pay in select p.* from private.payments p
      where p.owner_id=actor and p.status='pending' and p.target_post_id is null
        and (p.plan_version_id = plan.id
          or exists(select 1 from private.payment_lines l where l.payment_id=p.id and l.renews_entitlement_id is not null))
      order by p.created_at, p.id for update loop
    select array_agg(distinct coalesce(t.slot_id, t.id) order by coalesce(t.slot_id, t.id)) into open_chains
      from private.payment_lines l join private.entitlements t on t.id=l.renews_entitlement_id
      where l.payment_id=open_pay.id;
    if open_pay.plan_version_id = plan.id and open_chains = chains then
      pay := open_pay;
    elsif open_pay.plan_version_id = plan.id or open_chains && chains then
      if open_pay.checkout_url is not null then
        select count(*) into lines from private.payment_lines l where l.payment_id=open_pay.id;
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', open_pay.id, 'merchant_reference', open_pay.merchant_reference,
          'amount_cents', open_pay.amount_cents::text, 'currency', open_pay.currency, 'status', open_pay.status,
          'slots', lines, 'renewal', open_chains is not null, 'reused', true);
      elsif open_pay.checkout_claim_until > clock_timestamp() then
        raise exception 'checkout is being created' using errcode='PT409';
      end if;
      update private.payments set status='cancelled', status_changed_at=clock_timestamp() where id=open_pay.id;
    end if;
  end loop;
  slot_limit := internal.individual_slot_limit(fingerprint);
  -- Within the limit, and a staff-raised limit never carries renewals past its end.
  if not internal.individual_renewals_allowed(fingerprint, actor, pay.id, chains) then
    raise exception 'you can renew at most % Individual slots ahead, and % that start after a raised limit ends',
      slot_limit, internal.individual_slot_limit(null) using errcode='PT429';
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan', 'category', 'individual',
        'renewal', true, 'code', plan.plan_code, 'version', plan.version, 'label', 'Renewal: ' || plan.label,
        'area', plan.area, 'price_cents', plan.price_cents, 'slots', slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', 'Renewal: ' || case when slots = 1 then plan.label else slots::text || ' × ' || plan.label end,
        -- The start date each slot's new days were shown with (its end now).
        'renewal_starts', (select jsonb_agg(jsonb_build_object('entitlement_id', x.id,
            'starts_at', internal.slot_chain_last_end(x.id)) order by x.n)
          from unnest(p_entitlement_ids) with ordinality x(id, n)),
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording_version', 'renewal-cooling-off-v1',
          'wording', 'My new days start on the date shown for each slot, when its current days end. If I ask to cancel before they start, I get a full refund; once they start, the 7-day cooling-off no longer applies')))
    returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, renews_entitlement_id)
      select pay.id, x.n, plan.id, plan.price_cents, x.id
      from unnest(p_entitlement_ids) with ordinality x(id, n);
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', slots, 'renewal', true, 'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) owner to postgres;
revoke all on function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) from public;
grant execute on function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) to authenticated;
