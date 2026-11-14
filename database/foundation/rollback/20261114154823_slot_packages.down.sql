-- Reviewed rollback of updates/20261114154823_slot_packages.sql. Only with the
-- owner's decision; prefer a forward fix. Revert and deploy the website
-- release that uses it first: this removes the commands that release calls.
--
-- It refuses (55000) once a package was bought or opened, a package payment
-- was started, or the sales switch is on, and when a function is not the
-- update's body. Otherwise it puts back the eleven earlier bodies and drops
-- the update's functions, trigger, indexes, constraints, columns and tables.
-- The three package terms stay in the catalogue (catalogue versions are
-- retained); they are not public, and nothing sells them once
-- api.start_package_checkout is gone.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  if to_regclass('private.slot_packages') is not null
      and exists(select 1 from private.slot_packages) then
    raise exception 'slot packages rollback: a package exists' using errcode='55000';
  end if;
  if exists(select 1 from private.payments p join private.plan_versions v on v.id=p.plan_version_id
      where v.plan_code in ('slot_package_30d','slot_package_90d','slot_package_180d')) then
    raise exception 'slot packages rollback: a package payment exists' using errcode='55000';
  end if;
  if to_regclass('private.slot_package_sales') is not null
      and exists(select 1 from private.slot_package_sales where on_sale) then
    raise exception 'slot packages rollback: packages are on sale; switch sales off first' using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.slot_chain_end(uuid)'),('internal.slot_posts_held(uuid)'),
      ('internal.slot_posts_started(uuid,timestamp with time zone)'),('internal.activate_post(uuid)'),
      ('internal.issue_slot_line_entitlements(uuid)'),('internal.apply_provider_event(jsonb)'),
      ('internal.activate_staff_paid_payment(uuid,text)'),('internal.start_slot_checkout(uuid,integer,bigint,boolean)'),
      ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)'),('internal.run_slot_renewals(integer)'),
      ('internal.manage_plan_member(uuid,text,text)'),('internal.slot_package_guard()'),
      ('internal.slot_package_plan(text)'),('internal.slot_packages_on_sale()'),('internal.slot_chain_paid_end(uuid)'),
      ('internal.slot_package_now(uuid)'),('internal.slot_package_posts(uuid)'),('internal.slot_package_waiting(uuid)'),
      ('internal.slot_package_takeover_end(uuid)'),('internal.slot_package_open(uuid)'),
      ('internal.slot_package_blocks_individual(text,uuid)'),('internal.refresh_package_documents(uuid)'),
      ('internal.start_package_checkout(uuid,integer,bigint,boolean)'),('api.start_package_checkout(uuid,integer,bigint,boolean)'),
      ('internal.get_slot_package_offer()'),('api.get_slot_package_offer()'),('internal.get_my_slot_package()'),
      ('api.get_my_slot_package()')) v(sig)
  loop
    if shape not in (
        'internal.slot_chain_end(uuid) fe36eb29f4128a1eef3c967c9c501c76',
        'internal.slot_posts_held(uuid) 79a8a8cbd5e2a5208cb885bcfce222ef',
        'internal.slot_posts_started(uuid,timestamp with time zone) b4c766fe4de985334272296045f529e8',
        'internal.activate_post(uuid) 2092e9b1814073bb1c3239e03013235e',
        'internal.issue_slot_line_entitlements(uuid) e4041c30d7297bc4b4da74791701627d',
        'internal.apply_provider_event(jsonb) ac38c2c9eceb3bed2df1083fabeeb4e8',
        'internal.activate_staff_paid_payment(uuid,text) c892a45c4769f7f140b59ce6ba8d1a7c',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) cae84c17b05a49fc3937064eaaff38f2',
        'internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) e014633dd37ebb3fa212fc2944dd7ed6',
        'internal.run_slot_renewals(integer) 0fb5f68336aab1f1f43b58c9acafb083',
        'internal.manage_plan_member(uuid,text,text) 285ce1cc4dc56a1e262811362a345da8',
        'internal.slot_package_guard() be264c746997a4b200c3db5ab0a04fca',
        'internal.slot_package_plan(text) 30b630774b28697f96b1b76978083e07',
        'internal.slot_packages_on_sale() 655bac7e53015b7ece5bc23fba1fa3fa',
        'internal.slot_chain_paid_end(uuid) de3528681a1ad52128c6db296e413d12',
        'internal.slot_package_now(uuid) a561555c6a51e7b33dfe29dbc55f32de',
        'internal.slot_package_posts(uuid) 4571c82bda496cfa2ea35058be045d9a',
        'internal.slot_package_waiting(uuid) b3b3d6620c2b570c79220f4ed6decab6',
        'internal.slot_package_takeover_end(uuid) 0a77a9c7ebbf989e9441f7c55586a716',
        'internal.slot_package_open(uuid) caeeac35f9854e2c7c4155e73bf01a5d',
        'internal.slot_package_blocks_individual(text,uuid) aaacd9fa58c26ece264cca8ed0340102',
        'internal.refresh_package_documents(uuid) ceae4e189bc8732a085dcad30f76faab',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) feb6e6f31e0bc1f6a1de41e8c927acb8',
        'api.start_package_checkout(uuid,integer,bigint,boolean) fd80319b7272002223740642d8e6f2e1',
        'internal.get_slot_package_offer() 2e254cb01e76b57f42c0505fc8561867',
        'api.get_slot_package_offer() ea9f10b3de795636e6261df26cd820b1',
        'internal.get_my_slot_package() 94c2adc7b69ccdc80d6ca8adb083143b',
        'api.get_my_slot_package() 484fbb096937f82b0669ed231e0edfef') then
      raise exception 'slot packages rollback: % is not the update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- The eleven earlier bodies (as 20261114093742_renew_slots_early.sql left them).
CREATE OR REPLACE FUNCTION internal.slot_chain_end(p_entitlement uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with recursive run(id, ends_at, chain) as (
    select e.id, e.ends_at, coalesce(e.slot_id, e.id) from private.entitlements e where e.id=p_entitlement
    union all
    select n.id, n.ends_at, run.chain from run join private.entitlements n
      on n.slot_id=run.chain and n.status='active' and n.starts_at<=run.ends_at and n.ends_at>run.ends_at
  )
  select max(run.ends_at) from run;
$function$;
alter function internal.slot_chain_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_end(uuid) from public;

CREATE OR REPLACE FUNCTION internal.slot_posts_held(p_entitlement uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.post_activations a
  where a.released_at is null and a.entitlement_id in (select c.id from private.entitlements t
    join private.entitlements c on c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)
    where t.id = p_entitlement);
$function$;
alter function internal.slot_posts_held(uuid) owner to postgres;
revoke all on function internal.slot_posts_held(uuid) from public;

CREATE OR REPLACE FUNCTION internal.slot_posts_started(p_entitlement uuid, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.post_activations a
  where a.activated_at > p_since and a.release_reason is distinct from 'moderation' and not a.continued
    and a.entitlement_id in (select c.id from private.entitlements t
    join private.entitlements c on c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)
    where t.id = p_entitlement);
$function$;
alter function internal.slot_posts_started(uuid,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_posts_started(uuid,timestamp with time zone) from public;

CREATE OR REPLACE FUNCTION internal.activate_post(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  current_activation private.post_activations;
  ent private.entitlements;
  used integer;
  any_usable boolean := false;
begin
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  select * into current_activation from private.post_activations a where a.post_id = post.id and a.released_at is null;
  if found then
    select * into ent from private.entitlements e where e.id = current_activation.entitlement_id for update;
    if internal.entitlement_for_post_eligible(ent.id,post.id,actor) then
      perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', true);
    end if;
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'entitlement_ended'
      where id = current_activation.id;
  end if;
  for ent in
    select e.* from private.entitlements e
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.area is null or e.area = post.area)
      and (e.owner_id = actor or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
    order by e.ends_at, e.id
    for update
  loop
    -- Cursor predicates may predate a row wait; re-read all authority and wall time.
    continue when not internal.entitlement_for_post_eligible(ent.id,post.id,actor);
    any_usable := true;
    -- A slot's posts over all its periods: a post still in the period that
    -- just ended (waiting to move to this one) fills the slot.
    select count(*) into used from private.post_activations a where a.released_at is null
      and a.entitlement_id in (select c.id from private.entitlements c
        where c.id = coalesce(ent.slot_id, ent.id) or c.slot_id = coalesce(ent.slot_id, ent.id));
    continue when used >= ent.slot_capacity;
    if ent.activations_per_period is not null then
      -- Posts going live in the rolling period, over every period of the
      -- slot (a renewal does not restart the count): a new post and an ended
      -- post brought back each count; a submission that review rejected does
      -- not, nor a post moved on into a renewed period.
      select count(*) into used from private.post_activations a
        where a.entitlement_id in (select c.id from private.entitlements c
            where c.id = coalesce(ent.slot_id, ent.id) or c.slot_id = coalesce(ent.slot_id, ent.id))
          and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days)
          and a.release_reason is distinct from 'moderation' and not a.continued;
      continue when used >= ent.activations_per_period;
    end if;
    insert into private.post_activations (post_id, entitlement_id, owner_id) values (post.id, ent.id, actor)
      returning * into current_activation;
    perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', false);
  end loop;
  if any_usable then
    raise exception 'all posting capacity is in use' using errcode = 'PT409';
  end if;
  raise exception 'no active plan covers this post' using errcode = 'PT402';
end;
$function$;
alter function internal.activate_post(uuid) owner to postgres;
revoke all on function internal.activate_post(uuid) from public;
grant execute on function internal.activate_post(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    if line.renews_entitlement_id is not null then
      select * into target from private.entitlements e where e.id=line.renews_entitlement_id;
      if target.owner_id is distinct from pay.owner_id then
        raise exception 'a renewal must renew a slot of the account that paid' using errcode='23514';
      end if;
      chain := coalesce(target.slot_id, target.id);
      perform 1 from private.entitlements e where e.id=chain or e.slot_id=chain order by e.id for update;
      select * into tail from private.entitlements e where (e.id=chain or e.slot_id=chain) and e.status='active'
        order by e.ends_at desc, e.id desc limit 1;
      if tail.id is not null then
        starts := greatest(tail.ends_at, statement_timestamp());
      end if;
    end if;
    insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
      activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities,
      renews_entitlement_id, slot_id)
    values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, line.id, (snap->>'slot_capacity')::integer,
      (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
      (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, starts,
      starts + make_interval(days => (snap->>'duration_days')::integer),
      array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))),
      case when chain is not null then coalesce(tail.id, target.id) end, chain);
    made := made + 1;
    if chain is not null then
      perform internal.refresh_slot_chain_documents(chain);
    end if;
  end loop;
  return made;
end;
$function$;
alter function internal.issue_slot_line_entitlements(uuid) owner to postgres;
revoke all on function internal.issue_slot_line_entitlements(uuid) from public;

CREATE OR REPLACE FUNCTION internal.apply_provider_event(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  ev jsonb := p_event;
  pay private.payments;
  snap jsonb;
  outcome text;
  window_start timestamptz;
  vat bigint;
  payment_owner uuid;
  prior private.provider_events;
  target private.posts;
  fulfillable boolean;
  line_count integer := 0;
  fingerprint text;
  renewing uuid[];
begin
  if jsonb_typeof(ev) <> 'object' or not (array(select jsonb_object_keys(ev)) <@ array['payload_sha256',
      'merchant_reference', 'provider_request_id', 'provider_transaction_id', 'status', 'amount_cents', 'currency'])
    or ev->>'payload_sha256' !~ '^[a-f0-9]{64}$' or jsonb_typeof(ev->'amount_cents') <> 'number'
    or ev->>'status' not in ('complete', 'cancelled', 'error', 'abandoned', 'pending')
    or nullif(ev->>'merchant_reference', '') is null or nullif(ev->>'provider_request_id', '') is null then
    raise exception 'invalid provider event' using errcode = '22023';
  end if;
  -- Serialize identical payloads, including unknown references. Then acquire
  -- the immutable owner's fence before any payment/post row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('provider_event:'||(ev->>'payload_sha256'),707));
  select * into prior from private.provider_events e where e.provider='ozow' and e.payload_sha256=ev->>'payload_sha256';
  if found then
    return jsonb_build_object('outcome','duplicate_event','original_outcome',prior.outcome,'payment_id',prior.payment_id);
  end if;
  select p.owner_id into payment_owner from private.payments p where p.merchant_reference=ev->>'merchant_reference';
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.merchant_reference = ev->>'merchant_reference' for update;
  if not found then
    outcome := 'unknown_reference';
  elsif pay.provider_request_id is distinct from ev->>'provider_request_id' then
    outcome := 'request_mismatch';
  elsif (ev->>'amount_cents')::bigint is distinct from pay.amount_cents or ev->>'currency' is distinct from pay.currency then
    outcome := 'amount_mismatch';
  elsif pay.status = 'complete' then
    outcome := case when ev->>'status' <> 'complete' then 'late_status_ignored'
      when pay.provider_transaction_id = ev->>'provider_transaction_id' then 'already_complete'
      else 'conflicting_transaction' end;
  elsif pay.status in ('refunded', 'chargeback') then
    outcome := 'reversed_ignored';
  elsif ev->>'status' <> 'complete' then
    -- A late failure never undoes a completion; a pending payment records the final state.
    if pay.status = 'pending' and ev->>'status' in ('cancelled', 'error', 'abandoned') then
      update private.payments set status = case ev->>'status' when 'cancelled' then 'cancelled' else 'failed' end,
        status_changed_at = statement_timestamp() where id = pay.id;
      outcome := 'not_paid';
    else
      outcome := 'no_change';
    end if;
  elsif nullif(ev->>'provider_transaction_id', '') is null then
    outcome := 'missing_transaction';
  elsif exists (select 1 from private.payments p where p.provider_transaction_id = ev->>'provider_transaction_id') then
    outcome := 'transaction_reused';
  else
    -- Failed/expired checkouts may still fulfill on verified late payment.
    -- Explicit cancellation never reactivates benefits: retain receipt and
    -- route it to reconciliation, independently of current target eligibility.
    snap := pay.snapshot;
    -- An invoice attempt whose invoice another payment already paid (or that
    -- was voided) is kept but not delivered: staff refund it.
    fulfillable := pay.status<>'cancelled'
      and exists(select 1 from private.current_account_access u where u.id=pay.owner_id)
      and not internal.customer_invoice_settled_elsewhere(pay.id);
    if pay.product_kind='addon' then
      select * into target from private.posts p where p.id=pay.target_post_id for update;
      fulfillable := fulfillable and found and target.owner_id=pay.owner_id
        and target.owner_id::text=snap->>'target_owner_id'
        and target.kind=snap->>'target_kind' and target.area=snap->>'target_area'
        and (snap->>'addon'='urgent' or target.kind='event')
        and target.published_at<=clock_timestamp() and target.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id=target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp());
      if fulfillable then
        fulfillable:=coalesce((snap->'addon_capabilities') ? (snap->>'addon'),false)
          and internal.addon_purchase_entitlement(pay.owner_id,target.id,snap->>'addon') is not null;
      end if;
    else
      select count(*) into line_count from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
      if line_count > 0 and fulfillable then
        -- Slots are delivered only within the person's limit (every account
        -- of the identity, each slot once); otherwise the money goes to
        -- reconciliation. A renewal of a held slot adds no slot (so it is
        -- delivered even to a person now over their limit), but the slots
        -- renewed ahead stay within the limit.
        fingerprint := internal.individual_slot_identity(pay.owner_id);
        if fingerprint is not null then
          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
        end if;
        renewing := internal.slot_lines_renewing(pay.id);
        fulfillable := (internal.slot_lines_adding(pay.id) = 0
            or (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer
              + internal.slot_lines_adding(pay.id) <= internal.individual_slot_limit(fingerprint))
          and (cardinality(renewing) = 0
            or internal.individual_renewals_allowed(fingerprint, pay.owner_id, pay.id, renewing));
      end if;
    end if;
    fulfillable := coalesce(fulfillable,false);
    update private.payments set status = 'complete', completed_at = statement_timestamp(),
      provider_transaction_id = ev->>'provider_transaction_id', status_changed_at = statement_timestamp(),
      fulfillment_status=case when fulfillable then 'fulfilled' else 'needs_reconciliation' end
    where id = pay.id;
    if not fulfillable then
      -- Receipt of verified funds is a financial fact. Never roll it back just
      -- because the old target/account disappeared or became ineligible.
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('payment_reconciliation_required',pay.id,pay.owner_id,'payment_reconciliation_required:'||pay.id);
    elsif pay.product_kind = 'plan' and line_count > 0 then
      -- One entitlement per slot, each with its own line (and so its own
      -- refund); a renewal starts when its slot's last period ends.
      perform internal.issue_slot_line_entitlements(pay.id);
    elsif pay.product_kind = 'plan' then
      -- A plan payment made before slot lines existed: one entitlement.
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
    else
      -- Stacking: a new window starts when the member's current window of that kind ends.
      select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
      from private.post_addon_windows w
      where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
      insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
      values (pay.target_post_id, snap->>'addon', pay.id, window_start,
        window_start + make_interval(days => (snap->>'days')::integer));
    end if;
    vat := internal.payment_invoice_vat(pay);
    insert into private.invoices (payment_id, invoice_number, amount_ex_vat_cents, vat_cents, total_cents, description)
    values (pay.id, 'INV-' || to_char(statement_timestamp() at time zone 'Africa/Johannesburg', 'YYYYMMDD') || '-'
        || upper(left(replace(pay.id::text, '-', ''), 10)),
      pay.amount_cents - vat, vat, pay.amount_cents,
      coalesce(snap->>'invoice_description', snap->>'label', initcap(snap->>'addon') || ' ' || (snap->>'days') || ' days'));
    insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    values ('payment_completed', pay.id, pay.owner_id, 'payment_completed:' || pay.id);
    outcome := case when fulfillable then 'completed' else 'complete_unfulfillable_target' end;
  end if;
  insert into private.provider_events (provider, payload_sha256, merchant_reference, provider_request_id,
    provider_transaction_id, reported_status, amount_cents, currency, payment_id, outcome)
  values ('ozow', ev->>'payload_sha256', ev->>'merchant_reference', ev->>'provider_request_id',
    nullif(ev->>'provider_transaction_id', ''), ev->>'status', (ev->>'amount_cents')::bigint,
    coalesce(ev->>'currency', ''), pay.id, outcome);
  return jsonb_build_object('outcome', outcome, 'payment_id', pay.id,
    'fulfillment_status',(select p.fulfillment_status from private.payments p where p.id=pay.id));
end;
$function$;
alter function internal.apply_provider_event(jsonb) owner to postgres;
revoke all on function internal.apply_provider_event(jsonb) from public;
grant execute on function internal.apply_provider_event(jsonb) to service_role;

CREATE OR REPLACE FUNCTION internal.activate_staff_paid_payment(p_payment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; pay private.payments; snap jsonb; prior private.payment_activations;
  target private.posts; line_count integer := 0; made integer := 0; window_start timestamptz;
  fingerprint text; commissions integer := 0; has_lines boolean; renewing uuid[];
begin
  actor := internal.staff_actor('payments:refund');
  if p_payment_id is null or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'payment and audit reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payments p where p.id = p_payment_id;
  if buyer is null then raise exception 'payment not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  select * into pay from private.payments p where p.id = p_payment_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  select * into prior from private.payment_activations a where a.payment_id = pay.id;
  if found then
    if prior.actor_id = actor and prior.reason = btrim(p_reason) then
      return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', pay.fulfillment_status,
        'entitlements', prior.entitlements, 'addon_window', prior.addon_window, 'commissions', prior.commissions,
        'repeated', true);
    end if;
    raise exception 'this payment was already activated' using errcode='PT409', detail='payment_already_activated';
  end if;
  if pay.status <> 'complete' or pay.fulfillment_status <> 'needs_reconciliation' then
    raise exception 'only a paid payment that was not delivered can be activated' using errcode='PT409', detail='payment_not_awaiting_activation';
  end if;
  if exists(select 1 from private.payment_refund_requests r where r.payment_id = pay.id and r.status = 'awaiting_approval') then
    raise exception 'a refund of this payment is waiting for approval' using errcode='PT409', detail='refund_awaiting_approval';
  end if;
  if not exists(select 1 from private.current_account_access u where u.id = pay.owner_id) then
    raise exception 'the account that paid cannot use it now; refund instead' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  if internal.customer_invoice_settled_elsewhere(pay.id) then
    raise exception 'another payment already paid this invoice (or it was voided); refund this one instead'
      using errcode='PT409', detail='invoice_paid_elsewhere';
  end if;
  snap := pay.snapshot;
  if pay.product_kind = 'addon' then
    select * into target from private.posts p where p.id = pay.target_post_id for update;
    if not (found and target.owner_id = pay.owner_id
        and target.owner_id::text = snap->>'target_owner_id'
        and target.kind = snap->>'target_kind' and target.area = snap->>'target_area'
        and (snap->>'addon' = 'urgent' or target.kind = 'event')
        and target.published_at <= clock_timestamp() and target.visible_until > clock_timestamp()
        and exists(select 1 from private.public_eligible_posts p where p.id = target.id)
        and exists(select 1 from internal.post_funding(target.id) f where f.funded_until > clock_timestamp())
        and coalesce((snap->'addon_capabilities') ? (snap->>'addon'), false)
        and internal.addon_purchase_entitlement(pay.owner_id, target.id, snap->>'addon') is not null) then
      raise exception 'the post can no longer carry this add-on; refund instead' using errcode='PT409', detail='addon_target_ineligible';
    end if;
    select greatest(statement_timestamp(), coalesce(max(w.ends_at), statement_timestamp())) into window_start
    from private.post_addon_windows w
    where w.post_id = pay.target_post_id and w.kind = snap->>'addon' and w.revoked_at is null;
    insert into private.post_addon_windows (post_id, kind, payment_id, starts_at, ends_at)
    values (pay.target_post_id, snap->>'addon', pay.id, window_start,
      window_start + make_interval(days => (snap->>'days')::integer));
  else
    has_lines := exists(select 1 from private.payment_lines l where l.payment_id = pay.id);
    if exists(select 1 from private.entitlements e where e.payment_id = pay.id) then
      raise exception 'this payment already has a slot; check it before activating' using errcode='PT409', detail='payment_slot_exists';
    end if;
    if has_lines then
      select count(*) into line_count from private.payment_lines l where l.payment_id = pay.id and l.status = 'open';
      if line_count = 0 then
        raise exception 'every slot of this payment was refunded' using errcode='PT409', detail='payment_slots_refunded';
      end if;
      -- Within the person's Individual slot limit (every account of the
      -- identity, each slot once; a renewal of a held slot adds none, and
      -- the slots renewed ahead stay within the limit).
      fingerprint := internal.individual_slot_identity(pay.owner_id);
      if fingerprint is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
      end if;
      renewing := internal.slot_lines_renewing(pay.id);
      if (internal.slot_lines_adding(pay.id) > 0
          and (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer
            + internal.slot_lines_adding(pay.id) > internal.individual_slot_limit(fingerprint))
        or (cardinality(renewing) > 0
          and not internal.individual_renewals_allowed(fingerprint, pay.owner_id, pay.id, renewing)) then
        raise exception 'more slots than the person''s limit; raise the limit or refund' using errcode='PT429', detail='slot_limit_reached';
      end if;
      made := internal.issue_slot_line_entitlements(pay.id);
    else
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
      get diagnostics made = row_count;
    end if;
  end if;
  -- The status stays complete, so the commission trigger does not fire: the
  -- delivered purchase earns its commission here.
  update private.payments set fulfillment_status = 'fulfilled' where id = pay.id;
  commissions := internal.payment_delivery_commission(pay.id);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  insert into private.payment_activations (payment_id, actor_id, reason, entitlements, addon_window, commissions)
    values (pay.id, actor, btrim(p_reason), made, pay.product_kind = 'addon', commissions);
  return jsonb_build_object('payment_id', pay.id, 'fulfillment_status', 'fulfilled', 'entitlements', made,
    'addon_window', pay.product_kind = 'addon', 'commissions', commissions, 'repeated', false);
end;
$function$;
alter function internal.activate_staff_paid_payment(uuid,text) owner to postgres;
revoke all on function internal.activate_staff_paid_payment(uuid,text) from public;
grant execute on function internal.activate_staff_paid_payment(uuid,text) to authenticated;

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
  total := plan.price_cents * p_slots;
  if total > 1000000 then
    raise exception 'orders above R10,000 are paid by invoice' using errcode='PT413';
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

CREATE OR REPLACE FUNCTION internal.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_moved integer := 0; n_reminders integer := 0; r record; post private.posts; next_grant private.entitlements;
  activation private.post_activations; used integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023';
  end if;
  -- 1. Hand-over (housekeeping only: posts are funded through their slot at
  -- read time). A post whose period has ended moves to the slot's period that
  -- follows on from it without a break and covers now. Only posts that can
  -- move are picked (the next period may carry the post and has room), so
  -- posts that cannot move (an owner who lost access, for example) never
  -- crowd out the rest. Read from the renewals that have not ended
  -- (entitlements_renewals_current_idx, against the statement's time) and
  -- the posts still in an earlier period of their slot; the checks that call
  -- functions run only on those. Candidates are unlocked: take the owner's
  -- fence, then lock and recheck.
  for r in
    select w.activation_id, w.post_id, w.owner_id, w.next_id from (
      select a.id as activation_id, a.post_id, a.owner_id, n.id as next_id, n.ends_at as next_ends,
        n.slot_id as next_slot, n.slot_capacity as next_capacity, g.id as grant_id, g.ends_at as grant_ends
      from private.entitlements n
        join private.entitlements g on (g.id=n.slot_id or g.slot_id=n.slot_id) and g.id<>n.id
        join private.post_activations a on a.entitlement_id=g.id and a.released_at is null
      where n.slot_id is not null and n.status='active' and n.ends_at>statement_timestamp()
        and n.starts_at<=statement_timestamp() and a.post_id is not null and g.status='active'
        and g.ends_at<=statement_timestamp() and n.starts_at>g.starts_at
      offset 0
    ) w
    where w.next_ends<=internal.slot_chain_end(w.grant_id)
      and internal.entitlement_for_post_eligible(w.next_id, w.post_id, w.owner_id)
      and (select count(*) from private.post_activations o where o.released_at is null and o.id<>w.activation_id
        and o.entitlement_id in (select c.id from private.entitlements c
          where c.id=w.next_slot or c.slot_id=w.next_slot)) < w.next_capacity
    order by w.grant_ends, w.activation_id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.post_id for update skip locked;
    if not found then continue; end if;
    select * into activation from private.post_activations a where a.id=r.activation_id and a.released_at is null
      and a.post_id=post.id;
    if not found then continue; end if;
    select * into next_grant from private.entitlements e where e.id=r.next_id for update;
    -- Recheck under the locks: the next period still follows on, covers now,
    -- may carry this post and has room for it.
    continue when next_grant.status<>'active' or next_grant.starts_at>clock_timestamp()
      or next_grant.ends_at<=clock_timestamp()
      or next_grant.ends_at>internal.slot_chain_end(activation.entitlement_id)
      or not internal.entitlement_for_post_eligible(next_grant.id, post.id, post.owner_id);
    select count(*) into used from private.post_activations a where a.released_at is null and a.id<>activation.id
      and a.entitlement_id in (select c.id from private.entitlements c
        where c.id=coalesce(next_grant.slot_id, next_grant.id) or c.slot_id=coalesce(next_grant.slot_id, next_grant.id));
    continue when used + 1 > next_grant.slot_capacity;
    update private.post_activations set released_at=clock_timestamp(), release_reason='entitlement_ended'
      where id=activation.id;
    insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
      values (post.id, next_grant.id, post.owner_id, clock_timestamp(), true);
    n_moved := n_moved + 1;
  end loop;
  -- 2. Reminders: one per grant (so one per slot end, whatever the retries),
  -- for an Individual slot ending within 3 days with no renewal following it.
  with due as (
    select g.id, g.owner_id from private.entitlements g
      join private.payment_lines l on l.id=g.payment_line_id
      join private.plan_versions v on v.id=l.plan_version_id
    where g.source='retail_paid' and g.status='active' and internal.individual_slot_plan(v.plan_code)
      and g.ends_at>statement_timestamp() and g.ends_at<=statement_timestamp()+interval '3 days'
      and internal.slot_renewal_due(g.id, g.owner_id)
      and not exists(select 1 from private.outbox_events o where o.dedupe_key='slot_renewal_reminder:'||g.id)
    order by g.ends_at, g.id limit p_limit
  )
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    select 'slot_renewal_reminder', d.id, d.owner_id, 'slot_renewal_reminder:'||d.id from due d
    on conflict (dedupe_key) do nothing;
  get diagnostics n_reminders = row_count;
  return jsonb_build_object('moved', n_moved, 'reminders', n_reminders);
end;
$function$;
alter function internal.run_slot_renewals(integer) owner to postgres;
revoke all on function internal.run_slot_renewals(integer) from public;
grant execute on function internal.run_slot_renewals(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.manage_plan_member(p_entitlement_id uuid, p_action text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); ent private.entitlements; target uuid;
begin
  if p_action not in ('add','remove') or length(btrim(coalesce(p_email,''))) not between 3 and 254 then
    raise exception 'invalid member command' using errcode='22023'; end if;
  select * into ent from private.entitlements e where e.id=p_entitlement_id and e.owner_id=actor for update;
  if not found or ent.slot_capacity<2 or ent.source<>'retail_paid' or ent.status<>'active' or ent.ends_at<=clock_timestamp()
    or internal.current_verified_identity(actor) is null then raise exception 'shared plan unavailable' using errcode='42501'; end if;
  select u.id into target from auth.users u where lower(u.email)=lower(btrim(p_email))
    and u.email_confirmed_at is not null and u.id<>actor
    and exists(select 1 from private.current_account_access a where a.id=u.id)
    and internal.current_verified_identity(u.id) is not null;
  if target is null then raise exception 'verified member unavailable' using errcode='22023'; end if;
  if p_action='remove' then delete from private.entitlement_members where entitlement_id=ent.id and member_id=target;
  else
    if not exists(select 1 from private.entitlement_members where entitlement_id=ent.id and member_id=target)
      and exists(select 1 from private.entitlement_members where entitlement_id=ent.id) then
      raise exception 'shared plan member limit reached' using errcode='PT409'; end if;
    insert into private.entitlement_members(entitlement_id,member_id,added_by) values(ent.id,target,actor) on conflict do nothing;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('success',true);
end;
$function$;
alter function internal.manage_plan_member(uuid,text,text) owner to postgres;
revoke all on function internal.manage_plan_member(uuid,text,text) from public;
grant execute on function internal.manage_plan_member(uuid,text,text) to authenticated;
-- The update's commands and helpers.
drop function api.get_my_slot_package();
drop function internal.get_my_slot_package();
drop function api.get_slot_package_offer();
drop function internal.get_slot_package_offer();
drop function api.start_package_checkout(uuid,integer,bigint,boolean);
drop function internal.start_package_checkout(uuid,integer,bigint,boolean);
drop function internal.refresh_package_documents(uuid);
drop function internal.slot_package_blocks_individual(text,uuid);
drop function internal.slot_package_open(uuid);
drop function internal.slot_package_takeover_end(uuid);
drop function internal.slot_package_waiting(uuid);
drop function internal.slot_package_posts(uuid);
drop function internal.slot_package_now(uuid);
drop function internal.slot_chain_paid_end(uuid);
drop function internal.slot_packages_on_sale();
drop function internal.slot_package_plan(text);
drop trigger slot_packages_immutable on private.slot_packages;
drop function internal.slot_package_guard();

-- Indexes, constraints, columns and tables.
drop index private.post_activations_owner_held_idx;
drop index private.entitlements_package_ends_idx;
drop index private.entitlements_package_idx;
alter table private.entitlements drop constraint entitlements_package_grant;
alter table private.entitlements drop constraint entitlements_package_id_fkey;
alter table private.entitlements drop column package_id;
alter table private.payment_lines drop constraint payment_lines_slot_count_check;
alter table private.payment_lines drop column slot_count;
drop table private.slot_packages;
drop table private.slot_package_sales;

commit;
