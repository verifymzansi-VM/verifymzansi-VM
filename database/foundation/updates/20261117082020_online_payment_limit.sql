-- Online payment limit and posting-v5 published (owner's decisions of
-- 16 November 2026). The R10,000 online limit is removed: the only online
-- limit left is the most Ozow accepts in one payment on our site (its
-- "Maximum Transaction Amount", R1,300 for site VER-VER-020 today). Anyone may
-- still ask for an invoice first at any amount, and pay it with "Pay now"
-- (Ozow) or by bank transfer.
--
-- Apply after 20261114154823_slot_packages.sql and after
-- 20261116175757_close_and_erase_account.sql (pull request #230, applied
-- first; this update does not depend on it). It refuses with 55000
-- unless the five functions it replaces have their reviewed bodies, or this
-- update's). Only adds: no API command, argument or grant is removed or
-- changed. In one transaction it:
--
-- 1. Adds internal.online_payment_max_cents(), the one setting: 130000 cents
--    (R1,300). When Ozow changes our site's maximum, a reviewed update
--    replaces only this function; the checks below and the website follow.
--    STABLE, not IMMUTABLE, so a changed value is never folded into a plan a
--    pooled connection keeps.
-- 2. Replaces internal.start_slot_checkout (api.start_slot_checkout) and
--    internal.start_slot_renewal_checkout (api.start_slot_renewal_checkout),
--    full bodies, changing only their limit: an order or renewal whose total
--    is above the setting is refused with PT413, detail
--    online_payment_above_limit (before: above 1,000,000 cents, R10,000, with
--    no detail). The total exactly at the setting is accepted.
-- 3. Replaces internal.start_invoice_payment (api.start_invoice_payment,
--    "Pay now" on an invoice), full body, adding one check: an invoice whose
--    total is above the setting is refused with the same PT413
--    online_payment_above_limit, before any payment row is written, so it is
--    paid by bank transfer only (staff record it, a second staff member
--    confirms it). Before, any invoice total was sent to Ozow, which refuses
--    amounts above its maximum.
-- 4. Replaces internal.start_package_checkout (api.start_package_checkout,
--    Multi-listing packages), full body, changing only its money limit: a
--    package above the setting (before: above R10,000) is bought by invoice,
--    PT413 package_invoice_required as before; more than 100 slots stays by
--    invoice. One cap for every online payment (coordinator's review, owner's
--    decision that Ozow's maximum is the only online limit).
-- 5. Replaces internal.claim_checkout_request (api.claim_checkout_request,
--    the server's lease before it asks Ozow for a payment page), full body,
--    adding a final guard: no new Ozow request above the setting (PT413
--    online_payment_above_limit). An Ozow page already open is unaffected.
-- 6. Adds the public read api.get_payment_limits() (anon and authenticated,
--    like the price catalogue; no account data): {"online_max_cents"}.
--    The checkout uses it to offer only the invoice above the limit, and the
--    invoice page to offer only bank transfer above it.
-- 7. Publishes posting terms version posting-v5
--    (src/lib/legal/terms-documents/posting-v5.json, canonical hash pinned
--    below and in catalogue.json): it inserts one row into
--    private.posting_terms_versions and does NOT make posting-v5 current;
--    20261117082021_switch_posting_terms_v5.sql does that once the website
--    release that knows posting-v5 is deployed. posting-v5 is posting-v4 with
--    "Paying, VAT & invoices" (and one refund sentence) rewritten: pay online
--    at any amount up to the payment provider's maximum, an invoice first on
--    request at any amount (paid with Pay now or by EFT), and above the
--    maximum an invoice paid by EFT.
--
-- Order: apply after the pull request is merged and before its website release
-- is deployed. The website deployed before it shows the R10,000 rule; with
-- this update applied it refuses orders above R1,300 with its old "paid by
-- invoice" message (Ozow refuses those amounts today anyway) and never calls
-- the new read. Then deploy, then apply the switch.
-- Read-only preflight: ../preflight/20261117082020_online_payment_limit.check.sql.
-- Rollback: ../rollback/20261117082020_online_payment_limit.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces have the reviewed bodies
-- (or this update's); posting-v4 (or posting-v5) is current and posting-v5 is
-- not published with another document.
do $$
declare shape text; current_version text; published_hash text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.start_slot_checkout(uuid,integer,bigint,boolean)'),
      ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)'),
      ('internal.start_invoice_payment(text,bigint,boolean)'),
      ('internal.start_package_checkout(uuid,integer,bigint,boolean)'),
      ('internal.claim_checkout_request(uuid,uuid)')) v(sig)
  loop
    if shape not in (
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) cae84c17b05a49fc3937064eaaff38f2',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) c8035d1400d4786ded224cbfda9b0864',
        'internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) e014633dd37ebb3fa212fc2944dd7ed6',
        'internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) 4c9ceef45be61e47ec685d82e8392c96',
        'internal.start_invoice_payment(text,bigint,boolean) 157a3a3a51c3abfdef565e37a2af3785',
        'internal.start_invoice_payment(text,bigint,boolean) 58e3e24aa91f41a476435c8b152b94d2',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) feb6e6f31e0bc1f6a1de41e8c927acb8',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) 947486cd48be84b7a45714ec51d1bae4',
        'internal.claim_checkout_request(uuid,uuid) 0234950a11ec46ce9ccb0e707b940e72',
        'internal.claim_checkout_request(uuid,uuid) ed0fda34dc274593ad117b51d47eb13c') then
      raise exception 'online payment limit precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  select c.version into current_version from private.posting_terms_current c where c.singleton;
  if current_version is null or current_version not in('posting-v4','posting-v5') then
    raise exception 'online payment limit precondition: current posting terms are %, expected posting-v4',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into published_hash from private.posting_terms_versions v where v.version='posting-v5';
  if published_hash is not null and published_hash<>'LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc' then
    raise exception 'posting-v5 is already published with a different document' using errcode='55000';
  end if;
  -- Read by the final check: this file never changes the current version.
  perform pg_catalog.set_config('vm.posting_terms_before_v5',current_version,true);
end$$;

-- The one setting: the most Ozow accepts in one payment on our site, in cents.
CREATE OR REPLACE FUNCTION internal.online_payment_max_cents()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 130000::bigint;
$function$;
alter function internal.online_payment_max_cents() owner to postgres;
revoke all on function internal.online_payment_max_cents() from public, anon, authenticated, service_role;

-- Public, like the price catalogue: no account data, so the price pages can
-- show it to signed-out visitors too.
CREATE OR REPLACE FUNCTION internal.get_payment_limits()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('online_max_cents', internal.online_payment_max_cents());
$function$;
alter function internal.get_payment_limits() owner to postgres;
revoke all on function internal.get_payment_limits() from public, anon, authenticated, service_role;
grant execute on function internal.get_payment_limits() to anon;
grant execute on function internal.get_payment_limits() to authenticated;

CREATE OR REPLACE FUNCTION api.get_payment_limits()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_payment_limits();
$function$;
alter function api.get_payment_limits() owner to postgres;
revoke all on function api.get_payment_limits() from public, anon, authenticated, service_role;
grant execute on function api.get_payment_limits() to anon;
grant execute on function api.get_payment_limits() to authenticated;

CREATE OR REPLACE FUNCTION internal.start_slot_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
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
  counted jsonb;
  slot_limit integer;
  total bigint;
  lines integer;
  renewal boolean;
begin
  if p_plan_id is null or p_slots is null or p_slots not between 1 and 25 or p_expected_total_cents is null then
    raise exception 'slot plan, number of slots and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  perform internal.lock_evidence_subject(actor);
  select * into plan from private.plan_versions v
    where v.id=p_plan_id and v.retired_at is null and v.is_public and internal.individual_slot_plan(v.plan_code);
  if not found then raise exception 'this slot is not on sale' using errcode='22023'; end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you buy a slot' using errcode='PT412';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs, posts
  -- use its places; Individual slots can be bought again in its last 7 days.
  if internal.slot_package_blocks_individual(fingerprint, actor) then
    raise exception 'Individual slots cannot be bought while your Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  total := plan.price_cents * p_slots;
  -- Above the most Ozow accepts in one payment (internal.online_payment_max_cents,
  -- the one setting): the order is paid by invoice and bank transfer.
  if total > internal.online_payment_max_cents() then
    raise exception 'this order is above the online payment limit of % cents; ask for an invoice',
      internal.online_payment_max_cents() using errcode='PT413', detail='online_payment_above_limit';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  -- One person at a time (every account of the identity), then this account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id=actor and p.status='pending' and p.plan_version_id=plan.id and p.target_post_id is null
    for update;
  if found then
    select count(*) into lines from private.payment_lines l where l.payment_id=pay.id;
    renewal := exists(select 1 from private.payment_lines l where l.payment_id=pay.id and l.renews_entitlement_id is not null);
    -- A renewal (api.start_slot_renewal_checkout) is never reused as an order
    -- of new slots: like an order of another number of slots it is continued,
    -- checked or cancelled first.
    if lines <> p_slots or renewal then
      if pay.checkout_url is not null then
        -- Open at Ozow for another order: the member continues, checks or
        -- cancels it first.
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
          'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
          'slots', lines, 'renewal', renewal, 'reused', true);
      elsif pay.checkout_claim_until > clock_timestamp() then
        raise exception 'checkout is being created' using errcode='PT409';
      end if;
      -- Never sent to Ozow, so it can never be paid: replaced.
      update private.payments set status='cancelled', status_changed_at=clock_timestamp() where id=pay.id;
      pay := null;
    end if;
  end if;
  counted := internal.individual_slots_counted(fingerprint, actor, pay.id);
  slot_limit := internal.individual_slot_limit(fingerprint);
  if (counted->>'held')::integer + (counted->>'pending')::integer + p_slots > slot_limit then
    raise exception 'you can hold at most % Individual slots at a time', slot_limit using errcode='PT429';
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan', 'category', 'individual',
        'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', p_slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', case when p_slots = 1 then plan.label else p_slots::text || ' × ' || plan.label end,
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording', 'My slot starts now; the 7-day cooling-off does not apply because the service starts immediately')))
    returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
      select pay.id, n, plan.id, plan.price_cents from pg_catalog.generate_series(1, p_slots) n;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', p_slots, 'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_slot_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_slot_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function internal.start_slot_checkout(uuid,integer,bigint,boolean) to authenticated;

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
  -- E3 (20261114154823): while the person's Multi-listing package runs, an
  -- Individual slot runs to its own end (its post then moves into a free
  -- place of the package); it can be renewed again in the package's last 7
  -- days.
  if internal.slot_package_blocks_individual(fingerprint, actor) then
    raise exception 'Individual slots cannot be renewed while your Multi-listing package runs'
      using errcode='PT409', detail='package_active';
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
  -- Above the most Ozow accepts in one payment: renew fewer slots at a time.
  if total > internal.online_payment_max_cents() then
    raise exception 'this renewal is above the online payment limit of % cents; renew fewer slots in one payment',
      internal.online_payment_max_cents() using errcode='PT413', detail='online_payment_above_limit';
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

CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent();
begin
  if p_expected_total_cents is null then
    raise exception 'invoice total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023', detail='invoice_consent_required';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and t.status = 'awaiting_confirmation') then
    raise exception 'your bank transfer to this invoice is being checked; you do not need to pay again'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  if inv.buyer_name is null then
    raise exception 'add your billing details before paying' using errcode='PT409', detail='invoice_billing_required';
  end if;
  if inv.total_cents <> p_expected_total_cents then
    raise exception 'the invoice total is % cents', inv.total_cents using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id and v.retired_at is null
    and v.is_public and internal.individual_slot_plan(v.plan_code) and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice can no longer be paid online; ask for a new one'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you pay' using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, actor) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  -- One person at a time (every account of the identity), then this account,
  -- as the slot checkout does.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select p.* into latest from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
    where l.invoice_id = inv.id order by l.attempt desc limit 1 for update of p;
  if latest.id is not null then
    if latest.status in ('complete', 'refunded', 'chargeback') then
      raise exception 'this invoice is already paid' using errcode='PT409', detail='invoice_paid';
    end if;
    if latest.status = 'pending' and latest.checkout_url is not null
        and latest.checkout_expires_at > pg_catalog.clock_timestamp() then
      -- Its Ozow page is still open: the customer continues there.
      perform internal.price_draft_actor();
      return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
        'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
        'slots', inv.slots, 'reused', true);
    end if;
    if internal.customer_invoice_attempt_live(latest) then
      raise exception 'your last payment of this invoice is still being checked; try again in a few minutes'
        using errcode='PT409', detail='invoice_payment_checking';
    end if;
    if latest.status <> 'pending' then
      latest := null; -- closed (expired, cancelled or failed): a new attempt
    end if;
  end if;
  -- Above the most Ozow accepts in one payment: the invoice is paid by bank
  -- transfer only (staff record it; a second staff member confirms it). After
  -- the "already paid" check, so a paid invoice still says it is paid.
  if inv.total_cents > internal.online_payment_max_cents() then
    raise exception 'this invoice is above the online payment limit of % cents; pay it by bank transfer',
      internal.online_payment_max_cents() using errcode='PT413', detail='online_payment_above_limit';
  end if;
  if latest.id is null then
    select count(*) into attempts from private.customer_invoice_payments l where l.invoice_id = inv.id;
    if attempts >= 20 then
      raise exception 'this invoice has had too many payment attempts; contact us'
        using errcode='PT429', detail='invoice_attempts_exhausted';
    end if;
    -- Another payment open for the same slot term (one per term at a time).
    select * into other from private.payments p
      where p.owner_id = actor and p.status = 'pending' and p.plan_version_id = plan.id and p.target_post_id is null
      for update;
    if found then
      if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
        raise exception 'finish or cancel your other open payment for this slot first'
          using errcode='PT409', detail='invoice_checkout_open';
      end if;
      -- Never sent to Ozow, so it can never be paid: closed.
      update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
        where id = other.id;
    end if;
  end if;
  counted := internal.individual_slots_counted(fingerprint, actor, latest.id);
  if (counted->>'held')::integer + (counted->>'pending')::integer + inv.slots > internal.individual_slot_limit(fingerprint) then
    raise exception 'you can hold at most % Individual slots at a time', internal.individual_slot_limit(fingerprint)
      using errcode='PT429', detail='slot_limit_reached';
  end if;
  if inv.cooling_off_consent_at is null then
    update private.customer_invoices set cooling_off_consent_at = statement_timestamp(),
        cooling_off_consent_version = consent->>'version'
      where id = inv.id returning * into inv;
  end if;
  if latest.id is not null then
    -- An attempt never sent to Ozow: the website sends it now.
    perform internal.price_draft_actor();
    return jsonb_build_object('payment_id', latest.id, 'merchant_reference', latest.merchant_reference,
      'amount_cents', latest.amount_cents::text, 'currency', latest.currency, 'status', latest.status,
      'slots', inv.slots, 'reused', true);
  end if;
  insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
    values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
        'category', 'individual', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
        'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
        'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', inv.description,
        'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
        'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
          'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton))),
      case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
    returning * into pay;
  insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents)
    select pay.id, n, plan.id, inv.unit_price_cents from pg_catalog.generate_series(1, inv.slots) n;
  insert into private.customer_invoice_payments (payment_id, invoice_id, attempt) values (pay.id, inv.id, attempts + 1);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'slots', inv.slots, 'reused', false);
end;
$function$;
alter function internal.start_invoice_payment(text,bigint,boolean) owner to postgres;
revoke all on function internal.start_invoice_payment(text,bigint,boolean) from public;
grant execute on function internal.start_invoice_payment(text,bigint,boolean) to authenticated;

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

CREATE OR REPLACE FUNCTION internal.claim_checkout_request(p_payment_id uuid, p_owner_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  perform internal.payment_invoice_config();
  select * into pay from private.payments where id=p_payment_id and owner_id=p_owner_id for update;
  if not found or pay.status<>'pending' or not exists(select 1 from private.current_account_access a where a.id=p_owner_id) then
    raise exception 'pending checkout unavailable' using errcode='PT409'; end if;
  if pay.checkout_url is null and pay.checkout_claim_until>clock_timestamp() then
    raise exception 'checkout is being created' using errcode='PT409'; end if;
  -- A Multi-listing package (20261114154823) reaches Ozow only while packages
  -- are on sale and the member's ID review is still accepted.
  if exists(select 1 from private.plan_versions v where v.id=pay.plan_version_id
      and internal.slot_package_plan(v.plan_code)) then
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.current_verified_identity(pay.owner_id) is null then
      raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
    end if;
  end if;
  -- Final guard (20261117082020): a new Ozow request is never created above
  -- the most Ozow accepts in one payment; every checkout refuses first.
  if pay.checkout_url is null and pay.amount_cents > internal.online_payment_max_cents() then
    raise exception 'this payment is above the online payment limit of % cents', internal.online_payment_max_cents()
      using errcode='PT413', detail='online_payment_above_limit';
  end if;
  if pay.checkout_url is null then
    -- No request is attached, so every earlier attempt ended before Ozow's
    -- page reached the member. Each attempt gets a fresh 30-minute window;
    -- after an earlier lease, also a new idempotency key (Ozow must not see a
    -- key it already answered with another expiry).
    update private.payments set checkout_claim_token=pg_catalog.gen_random_uuid(),
      checkout_claim_until=clock_timestamp()+interval '2 minutes',
      checkout_expires_at=clock_timestamp()+interval '30 minutes',
      provider_idempotency_key=case when checkout_claim_token is null then provider_idempotency_key
        else pg_catalog.gen_random_uuid() end
      where id=pay.id returning * into pay;
  end if;
  return internal.billing_payment_dto(pay)||jsonb_build_object('claim_token',pay.checkout_claim_token,
    'idempotency_key',pay.provider_idempotency_key,'correlation_id',pay.provider_correlation_id);
end;
$function$;
alter function internal.claim_checkout_request(uuid,uuid) owner to postgres;
revoke all on function internal.claim_checkout_request(uuid,uuid) from public;
grant execute on function internal.claim_checkout_request(uuid,uuid) to service_role;

-- posting-v5: published, not current (the switch makes it current).
insert into private.posting_terms_versions(version,document_hash) values('posting-v5','LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc')
  on conflict(version) do nothing;

do $$begin
  if not exists(select 1 from private.posting_terms_versions v
      where v.version='posting-v5' and v.document_hash='LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc') then
    raise exception 'posting-v5 was not published';
  end if;
  if (select c.version from private.posting_terms_current c where c.singleton)
      is distinct from pg_catalog.current_setting('vm.posting_terms_before_v5',true) then
    raise exception 'publishing posting-v5 must not change the current posting terms';
  end if;
end$$;

commit;
