-- Reviewed rollback for updates/20261120045404_package_add_slots.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix. Revert and deploy the website
-- release first: the rollback removes api.get_my_package_add_offer,
-- api.start_package_add_checkout and api.request_package_add_invoice, which
-- that release's "Add slots" page calls.
--
-- It refuses (55000) unless the fifteen added functions and the seventeen
-- replaced ones have this update's bodies (a later update changed one: undo
-- that update first), while any other function refers to an added function
-- (undo that update first), once an added-slots invoice request or an
-- added-slots payment exists (slots were added: a forward fix keeps their
-- record), once an invoice was voided by the database, or while
-- private.package_invoice_requests lacks the update's columns. Otherwise it puts back the earlier bodies of
-- internal.issue_slot_line_entitlements, internal.apply_provider_event,
-- internal.activate_staff_paid_payment, internal.claim_checkout_request,
-- internal.slot_package_grant_revoked, internal.package_invoice_request_guard,
-- internal.package_invoice_request_dto, internal.package_invoice_issue_check,
-- internal.issue_package_customer_invoice, internal.start_invoice_payment,
-- internal.record_staff_invoice_transfer and
-- internal.confirm_staff_invoice_payment, internal.customer_invoice_dto,
-- internal.request_package_invoice, internal.get_my_package_invoice_request,
-- internal.start_package_checkout and internal.frontend_privacy_export_data
-- byte for byte, drops the added functions, gives
-- private.package_invoice_requests back its earlier slots rule (5 to 250)
-- without the columns kind, package_id, days_left and invoiced_days (every row
-- is then a new-package request, as before) and private.customer_invoices its
-- earlier void rule. No other row is changed.
begin;
set local lock_timeout='5s';

do $$
declare shape text; dependants text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.customer_invoice_system_void_guard()'),
      ('api.void_ended_package_add_invoices(integer)'),
      ('internal.void_ended_package_add_invoices(integer)'),
      ('internal.package_invoice_blocking(uuid,uuid)'),
      ('api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)'),
      ('api.start_package_add_checkout(uuid,integer,bigint,boolean)'),
      ('api.get_my_package_add_offer()'),
      ('internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)'),
      ('internal.start_package_add_checkout(uuid,integer,bigint,boolean)'),
      ('internal.get_my_package_add_offer()'),
      ('internal.slot_package_keep_posts(uuid)'),
      ('internal.package_add_invoice_package(uuid)'),
      ('internal.slot_package_add_ok(uuid,uuid,integer)'),
      ('internal.slot_package_add_quote(uuid)'),
      ('internal.slot_package_term_plan(integer)'),
      ('internal.issue_slot_line_entitlements(uuid)'),
      ('internal.apply_provider_event(jsonb)'),
      ('internal.activate_staff_paid_payment(uuid,text)'),
      ('internal.claim_checkout_request(uuid,uuid)'),
      ('internal.slot_package_grant_revoked()'),
      ('internal.package_invoice_request_guard()'),
      ('internal.package_invoice_request_dto(private.package_invoice_requests,uuid)'),
      ('internal.package_invoice_issue_check(private.package_invoice_requests)'),
      ('internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)'),
      ('internal.start_invoice_payment(text,bigint,boolean)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.confirm_staff_invoice_payment(uuid)'),
      ('internal.customer_invoice_dto(private.customer_invoices,uuid)'),
      ('internal.request_package_invoice(uuid,integer,bigint,boolean,uuid)'),
      ('internal.get_my_package_invoice_request()'),
      ('internal.start_package_checkout(uuid,integer,bigint,boolean)'),
      ('internal.frontend_privacy_export_data(uuid)')) v(sig)
  loop
    if shape not in (
        -- each: this update's body
        'internal.slot_package_term_plan(integer) 0d8726c18c52a84d92c5badfddc10482',
        'internal.slot_package_add_quote(uuid) 233e14908c1d2b21b17a9205da371a77',
        'internal.slot_package_add_ok(uuid,uuid,integer) 27fc89e79b7b625096fe2219fd567aaa',
        'internal.package_add_invoice_package(uuid) 1c6cab90a756caa366bb753b0af5b18e',
        'internal.slot_package_keep_posts(uuid) 3618e3c5cd90a9c5bc5c081432c4333b',
        'internal.get_my_package_add_offer() 9ae9f7cb7a1c18ec5a1b769e85c83eac',
        'internal.start_package_add_checkout(uuid,integer,bigint,boolean) 2c803b109be23131c9b0cd2b1d05cba7',
        'internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) 3e7bd289c5fd516312b752920d4237b8',
        'api.get_my_package_add_offer() 4b7a12f241f9fdc5ec61545eaac6fa2b',
        'api.start_package_add_checkout(uuid,integer,bigint,boolean) 3be278362296fc2ec9cc5fdfbb256593',
        'api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) 6a61e0b25fc1600829ac3c13f1d22a67',
        'internal.package_invoice_blocking(uuid,uuid) 460577dbfc512edb1f9a6576dc8b2d73',
        'internal.void_ended_package_add_invoices(integer) 01d78539331e4875d06cd138089531e7',
        'api.void_ended_package_add_invoices(integer) ff2882aa42979545ada32c671ff1a408',
        'internal.customer_invoice_system_void_guard() a1d39d5a6c7b1d3eb7ca85bdf8b9533b',
        'internal.issue_slot_line_entitlements(uuid) b81aadc5fd06b47c33fc96b81d49b586',
        'internal.apply_provider_event(jsonb) 3a7487b374df1d1334d007111fd1d97f',
        'internal.activate_staff_paid_payment(uuid,text) 369ef2cc3b3a3139cfe83a3e7edb74eb',
        'internal.claim_checkout_request(uuid,uuid) 9d136593beb5f0e4aef35cb1f5fd5c75',
        'internal.slot_package_grant_revoked() 0f5b47f62caf51472e9da4987958ec28',
        'internal.package_invoice_request_guard() 6278c187470a7908134ebed5ec72939f',
        'internal.package_invoice_request_dto(private.package_invoice_requests,uuid) 7de219f93bdf5de34c73c1c10642129a',
        'internal.package_invoice_issue_check(private.package_invoice_requests) 28d36c25e3b05d045286b1584a8d529c',
        'internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) cc5a02870820c4b28ab8af83baf1654c',
        'internal.start_invoice_payment(text,bigint,boolean) 3637cefdf51809d67891104e041d71da',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 0f3f117b8bed207a401030c3bfb429df',
        'internal.confirm_staff_invoice_payment(uuid) ff40d1c2cf36149d535a4fdb7d99f1bf',
        'internal.customer_invoice_dto(private.customer_invoices,uuid) b322c8309ff009f5ef969862b4b77d89',
        'internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) f64d310d8ca3a549840db98df6f083f9',
        'internal.get_my_package_invoice_request() d3f564bbfb6271560c72f0aaf1af047a',
        'internal.start_package_checkout(uuid,integer,bigint,boolean) d59ca8b68dabb4c35d04d5945a90cd1b',
        'internal.frontend_privacy_export_data(uuid) e543b105fe264d5a683b5c570bf68cb5'
        ) then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'private.package_invoice_requests'::regclass and a.attname = 'kind' and not a.attisdropped) then
    raise exception 'rollback precondition: private.package_invoice_requests has no column kind' using errcode='55000';
  end if;
  if exists(select 1 from private.package_invoice_requests r where r.kind = 'add') then
    raise exception 'rollback precondition: an added-slots invoice request exists; prefer a forward fix'
      using errcode='55000';
  end if;
  if exists(select 1 from private.customer_invoices i where i.status = 'void' and i.voided_by is null) then
    raise exception 'rollback precondition: an invoice was voided by the database; prefer a forward fix'
      using errcode='55000';
  end if;
  if exists(select 1 from private.payments p where p.snapshot->>'category' = 'slot_package_add') then
    raise exception 'rollback precondition: an added-slots payment exists; prefer a forward fix'
      using errcode='55000';
  end if;
  -- A later function that calls an added function would break silently once
  -- they are dropped: undo that update first.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into dependants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'internal', 'private', 'public')
    and p.oid not in (select to_regprocedure(s) from unnest(array[
      'internal.customer_invoice_system_void_guard()',
      'api.void_ended_package_add_invoices(integer)',
      'internal.void_ended_package_add_invoices(integer)',
      'internal.package_invoice_blocking(uuid,uuid)',
      'api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)',
      'api.start_package_add_checkout(uuid,integer,bigint,boolean)',
      'api.get_my_package_add_offer()',
      'internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)',
      'internal.start_package_add_checkout(uuid,integer,bigint,boolean)',
      'internal.get_my_package_add_offer()',
      'internal.slot_package_keep_posts(uuid)',
      'internal.package_add_invoice_package(uuid)',
      'internal.slot_package_add_ok(uuid,uuid,integer)',
      'internal.slot_package_add_quote(uuid)',
      'internal.slot_package_term_plan(integer)',
      'internal.issue_slot_line_entitlements(uuid)',
      'internal.apply_provider_event(jsonb)',
      'internal.activate_staff_paid_payment(uuid,text)',
      'internal.claim_checkout_request(uuid,uuid)',
      'internal.slot_package_grant_revoked()',
      'internal.package_invoice_request_guard()',
      'internal.package_invoice_request_dto(private.package_invoice_requests,uuid)',
      'internal.package_invoice_issue_check(private.package_invoice_requests)',
      'internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text)',
      'internal.start_invoice_payment(text,bigint,boolean)',
      'internal.record_staff_invoice_transfer(text,text,text,boolean,text)',
      'internal.confirm_staff_invoice_payment(uuid)',
      'internal.customer_invoice_dto(private.customer_invoices,uuid)',
      'internal.request_package_invoice(uuid,integer,bigint,boolean,uuid)',
      'internal.get_my_package_invoice_request()',
      'internal.start_package_checkout(uuid,integer,bigint,boolean)',
      'internal.frontend_privacy_export_data(uuid)']) s)
    and (p.prosrc ilike '%slot_package_term_plan%' or p.prosrc ilike '%slot_package_add_quote%'
      or p.prosrc ilike '%slot_package_add_ok%' or p.prosrc ilike '%package_add_invoice_package%'
      or p.prosrc ilike '%slot_package_keep_posts%' or p.prosrc ilike '%get_my_package_add_offer%'
      or p.prosrc ilike '%start_package_add_checkout%' or p.prosrc ilike '%request_package_add_invoice%'
      or p.prosrc ilike '%package_invoice_blocking%' or p.prosrc ilike '%void_ended_package_add_invoices%'
      or p.prosrc ilike '%customer_invoice_system_void_guard%');
  if dependants is not null then
    raise exception 'rollback precondition: % refer to this update''s functions; undo that update first', dependants
      using errcode='55000';
  end if;
end$$;

-- The earlier bodies, byte for byte.

CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0; pkg uuid;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    pkg := null;
    if exists(select 1 from private.plan_versions v where v.id=line.plan_version_id
        and internal.slot_package_plan(v.plan_code)) then
      -- A Multi-listing package (20261114154823): its one line holds every
      -- slot it was sold with and opens the package; its grant carries them
      -- all (and 4 posts going live per slot per 30 days).
      if line.slot_count is distinct from (snap->>'slot_capacity')::integer then
        raise exception 'a package line holds the slots it was sold with' using errcode='23514';
      end if;
      insert into private.slot_packages (owner_id, term_days, slot_count)
        values (pay.owner_id, (snap->>'duration_days')::integer, line.slot_count)
        returning id into pkg;
    elsif line.renews_entitlement_id is not null then
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
      renews_entitlement_id, slot_id, package_id)
    values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, line.id, (snap->>'slot_capacity')::integer,
      (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
      (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, starts,
      starts + make_interval(days => (snap->>'duration_days')::integer),
      array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))),
      case when chain is not null then coalesce(tail.id, target.id) end, chain, pkg);
    made := made + 1;
    if chain is not null then
      perform internal.refresh_slot_chain_documents(chain);
    end if;
    -- A package touches no post here (no post check may stop a payment being
    -- recorded): the minute sweep moves the search documents of the posts it
    -- takes (internal.refresh_package_documents).
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
      if line_count > 0 and fulfillable and exists(select 1 from private.plan_versions v
          where v.id = pay.plan_version_id and internal.slot_package_plan(v.plan_code)) then
        -- A Multi-listing package (20261114154823): one package per account at
        -- a time, only while packages are on sale and the member's ID review
        -- is still accepted. Otherwise the money goes to reconciliation:
        -- staff refund it (or activate it once it can be delivered).
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707));
        fulfillable := not internal.slot_package_open(pay.owner_id) and internal.slot_packages_on_sale()
          and internal.current_verified_identity(pay.owner_id) is not null;
      elsif line_count > 0 and fulfillable then
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
            or internal.individual_renewals_allowed(fingerprint, pay.owner_id, pay.id, renewing))
          -- E3 (20261114154823): no Individual slot or renewal is delivered
          -- while the person's package runs (until its last 7 days), even
          -- from a checkout opened before it: reconciliation, then a refund.
          and not internal.slot_package_blocks_individual(fingerprint, pay.owner_id);
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
      if exists(select 1 from private.plan_versions v
          where v.id = pay.plan_version_id and internal.slot_package_plan(v.plan_code)) then
        -- A Multi-listing package (20261114154823): one package per account
        -- at a time.
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707));
        if internal.slot_package_open(pay.owner_id) then
          raise exception 'the account already has a package; refund this payment, or activate it once that package has ended'
            using errcode='PT409', detail='package_active';
        end if;
        if not internal.slot_packages_on_sale() then
          raise exception 'Multi-listing packages are not on sale; refund this payment' using errcode='PT403',
            detail='packages_not_on_sale';
        end if;
        if internal.current_verified_identity(pay.owner_id) is null then
          raise exception 'the member''s ID review is not accepted; refund this payment' using errcode='PT412';
        end if;
      else
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
        -- E3: never while the person's package runs (until its last 7 days).
        if internal.slot_package_blocks_individual(fingerprint, pay.owner_id) then
          raise exception 'the person''s Multi-listing package runs; refund this payment' using errcode='PT409',
            detail='package_active';
        end if;
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
  -- are on sale and the member's ID review is still accepted; and
  -- (20261119151152) never while the account has a package that has not
  -- ended, or a package invoice that is unpaid and that this payment is not
  -- an attempt of: a checkout started before that invoice was paid by bank
  -- transfer could otherwise be paid beside the package. The checks run under
  -- the account's package lock, which a bank transfer's confirmation, Pay now
  -- and a package delivery hold while they work, taken without waiting (this
  -- already holds the payment, which a delivery locks before that lock): while
  -- one of them runs, the member is asked to try again in a moment. These
  -- three apply only to a payment not sent to Ozow yet: one already open there
  -- keeps the member's choice to continue, check or cancel it.
  if exists(select 1 from private.plan_versions v where v.id=pay.plan_version_id
      and internal.slot_package_plan(v.plan_code)) then
    if pay.checkout_url is null and not pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707)) then
      raise exception 'your package is being updated; try again in a moment' using errcode='PT409', detail='package_busy';
    end if;
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.current_verified_identity(pay.owner_id) is null then
      raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
    end if;
    if pay.checkout_url is null and internal.slot_package_open(pay.owner_id) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
    if pay.checkout_url is null and exists(select 1 from private.customer_invoices i
        join private.plan_versions v on v.id=i.plan_version_id
        where i.account_id=pay.owner_id and i.status='issued' and internal.slot_package_plan(v.plan_code)
          and not exists(select 1 from private.customer_invoice_payments l where l.invoice_id=i.id and l.payment_id=pay.id)) then
      raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
        using errcode='PT409', detail='package_invoice_unpaid';
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


CREATE OR REPLACE FUNCTION internal.slot_package_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  begin
    perform internal.slot_package_release_dates(new.owner_id);
  exception when others then
    raise warning 'slot package search documents left to the sweep (%)', sqlstate;
  end;
  begin
    perform internal.slot_package_release_paused(new.owner_id);
  exception when others then
    raise warning 'slot package paused posts left to the sweep (%)', sqlstate;
  end;
  return null;
end;
$function$;
alter function internal.slot_package_grant_revoked() owner to postgres;
revoke all on function internal.slot_package_grant_revoked() from public;


CREATE OR REPLACE FUNCTION internal.package_invoice_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' or new.prepared_by is not null or new.approved_by is not null
        or new.invoice_id is not null or new.closed_at is not null then
      raise exception 'a package invoice request starts as requested' using errcode='23514';
    end if;
    return new;
  end if;
  -- An erasure unlinks the erased account from this kept record
  -- (internal.erase_closed_account); nothing else may change with it.
  if coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> ''
      and internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
    return new;
  end if;
  -- What the member asked for never changes; staff details are written once.
  if (new.id, new.account_id, new.member_request_id, new.plan_version_id, new.term_days, new.slots,
      new.unit_price_cents, new.total_cents, new.requested_at, new.consent_at, new.consent_version,
      new.consent_terms_version)
    is distinct from (old.id, old.account_id, old.member_request_id, old.plan_version_id, old.term_days, old.slots,
      old.unit_price_cents, old.total_cents, old.requested_at, old.consent_at, old.consent_version,
      old.consent_terms_version)
    or (old.prepared_by is not null and (new.prepared_by, new.prepared_at, new.due_days, new.staff_reason)
      is distinct from (old.prepared_by, old.prepared_at, old.due_days, old.staff_reason)) then
    raise exception 'a package invoice request keeps what was asked and prepared' using errcode='23514';
  end if;
  -- requested -> awaiting_approval, issued, declined or withdrawn;
  -- awaiting_approval -> issued, declined or withdrawn (the account closed);
  -- nothing after that.
  if not ((old.status = 'requested' and new.status in ('awaiting_approval', 'issued', 'declined', 'withdrawn'))
      or (old.status = 'awaiting_approval' and new.status in ('issued', 'declined', 'withdrawn'))) then
    raise exception 'a package invoice request moves on once, from requested or awaiting approval'
      using errcode='23514';
  end if;
  if new.status = 'issued' then
    select * into inv from private.customer_invoices i where i.id = new.invoice_id;
    if not found or inv.account_id <> new.account_id or inv.plan_version_id <> new.plan_version_id
        or inv.slots <> new.slots or inv.unit_price_cents <> new.unit_price_cents
        or inv.total_cents <> new.total_cents or inv.request_id <> new.id or inv.issued_by <> new.prepared_by
        or inv.status <> 'issued' then
      raise exception 'an issued request names its own invoice of that order' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
alter function internal.package_invoice_request_guard() owner to postgres;
revoke all on function internal.package_invoice_request_guard() from public;


CREATE OR REPLACE FUNCTION internal.package_invoice_request_dto(r private.package_invoice_requests, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', r.id, 'status', r.status, 'term_days', r.term_days, 'slots', r.slots,
    'unit_price_cents', r.unit_price_cents, 'total_cents', r.total_cents, 'requested_at', r.requested_at,
    'invoice_number', (select i.invoice_number from private.customer_invoices i where i.id = r.invoice_id),
    'closed_at', r.closed_at)
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', r.account_id,
    'customer_email', (select u.email from auth.users u where u.id = r.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.account_id)),
    'identity_accepted', internal.current_verified_identity(r.account_id) is not null,
    'package_open', internal.slot_package_open(r.account_id),
    'needs_approval', r.total_cents > internal.package_invoice_approval_above_cents(),
    'due_days', r.due_days, 'staff_reason', r.staff_reason, 'prepared_at', r.prepared_at,
    'prepared_by_me', coalesce(internal.same_identity(r.prepared_by, p_staff), false),
    'prepared_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = r.prepared_by)),
    'close_reason', r.close_reason) end;
$function$;
alter function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) owner to postgres;
revoke all on function internal.package_invoice_request_dto(private.package_invoice_requests,uuid) from public;


CREATE OR REPLACE FUNCTION internal.package_invoice_issue_check(r private.package_invoice_requests)
 RETURNS private.plan_versions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare plan private.plan_versions; unpaid text;
begin
  if not exists(select 1 from private.current_account_access a where a.id = r.account_id) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  if internal.current_verified_identity(r.account_id) is null then
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v where v.id = r.plan_version_id and v.retired_at is null
    and internal.slot_package_plan(v.plan_code) and v.price_cents = r.unit_price_cents;
  if not found then
    raise exception 'this package term is no longer sold at the price asked for; decline the request'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  if internal.slot_package_open(r.account_id) then
    raise exception 'the customer already has a Multi-listing package; decline the request'
      using errcode='PT409', detail='package_active';
  end if;
  -- A package payment of the account open at Ozow could still be paid and
  -- open a package: it is finished or cancelled first.
  if exists(select 1 from private.payments p join private.plan_versions v on v.id = p.plan_version_id
      where p.owner_id = r.account_id and p.status = 'pending' and p.target_post_id is null
        and internal.slot_package_plan(v.plan_code)
        and (p.checkout_url is not null or p.checkout_claim_until > pg_catalog.clock_timestamp())) then
    raise exception 'the customer has a package payment open at Ozow; try again when it has closed'
      using errcode='PT409', detail='invoice_checkout_open';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = r.account_id and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'the customer''s package invoice % is not paid yet; void it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  return plan;
end;
$function$;
alter function internal.package_invoice_issue_check(private.package_invoice_requests) owner to postgres;
revoke all on function internal.package_invoice_issue_check(private.package_invoice_requests) from public;


CREATE OR REPLACE FUNCTION internal.issue_package_customer_invoice(r private.package_invoice_requests, p_plan private.plan_versions, p_issuer uuid, p_due_days integer, p_reason text)
 RETURNS private.customer_invoices
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare issued_on date; year_number integer; next_number integer; made private.customer_invoices;
begin
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, r.account_id,
      p_plan.id, r.slots, p_plan.price_cents, p_plan.price_cents * r.slots,
      'Multi-listing package: ' || r.slots::text || ' slots × ' || p_plan.duration_days::text || ' days',
      issued_on + p_due_days, p_issuer, p_reason, r.id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  return made;
end;
$function$;
alter function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) owner to postgres;
revoke all on function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) from public;


CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent(); is_package boolean;
begin
  if p_expected_total_cents is null then
    raise exception 'invoice total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023', detail='invoice_consent_required';
  end if;
  inv := internal.lock_my_issued_invoice(actor, p_invoice_number);
  if exists(select 1 from private.invoice_transfers t where t.customer_invoice_id = inv.id
      and internal.invoice_transfer_waiting(t)) then
    raise exception 'your bank transfer to this invoice is being checked; you do not need to pay again'
      using errcode='PT409', detail='invoice_transfer_waiting';
  end if;
  if inv.buyer_name is null then
    raise exception 'add your billing details before paying' using errcode='PT409', detail='invoice_billing_required';
  end if;
  if inv.total_cents <> p_expected_total_cents then
    raise exception 'the invoice total is % cents', inv.total_cents using errcode='PT428', detail='invoice_amount_mismatch';
  end if;
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice: the
  -- term must still be sold at the invoice's price.
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id and v.retired_at is null
    and ((v.is_public and internal.individual_slot_plan(v.plan_code)) or internal.slot_package_plan(v.plan_code))
    and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice can no longer be paid online; ask for a new one'
      using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  is_package := internal.slot_package_plan(plan.plan_code);
  fingerprint := internal.current_verified_identity(actor);
  if fingerprint is null then
    raise exception 'your ID review must be accepted before you pay' using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if is_package then
    -- A package is sold only while packages are on sale, and to an account
    -- with no package that has not ended (as the package checkout); this
    -- account, then its package, as the package checkout locks them.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
    if internal.slot_package_open(actor) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
  else
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
  end if;
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
    if is_package then
      -- Another package payment open (any term: one package order at a time,
      -- as the package checkout keeps it).
      for other in select p.* from private.payments p join private.plan_versions v on v.id = p.plan_version_id
          where p.owner_id = actor and p.status = 'pending' and p.target_post_id is null
            and internal.slot_package_plan(v.plan_code)
          order by p.created_at, p.id
          for update of p loop
        if other.checkout_url is not null or other.checkout_claim_until > pg_catalog.clock_timestamp() then
          raise exception 'finish or cancel your other open package payment first'
            using errcode='PT409', detail='invoice_checkout_open';
        end if;
        -- Never sent to Ozow, so it can never be paid: closed.
        update private.payments set status = 'cancelled', status_changed_at = pg_catalog.clock_timestamp()
          where id = other.id;
      end loop;
    else
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
  end if;
  -- A package is not counted in the Individual slot limit.
  if not is_package then
    counted := internal.individual_slots_counted(fingerprint, actor, latest.id);
    if (counted->>'held')::integer + (counted->>'pending')::integer + inv.slots > internal.individual_slot_limit(fingerprint) then
      raise exception 'you can hold at most % Individual slots at a time', internal.individual_slot_limit(fingerprint)
        using errcode='PT429', detail='slot_limit_reached';
    end if;
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
  if is_package then
    -- One payment line holding every slot of the package (as the package
    -- checkout), so the Ozow notice delivers it as a package.
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot, merchant_reference)
      values (actor, 'plan', plan.id, inv.total_cents, plan.currency, jsonb_build_object('kind', 'plan',
          'category', 'slot_package', 'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
          'price_cents', plan.price_cents, 'slots', inv.slots, 'total_cents', inv.total_cents,
          'duration_days', plan.duration_days, 'slot_capacity', inv.slots,
          'activations_per_period', plan.activations_per_period * inv.slots,
          'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities', to_jsonb(plan.addon_capabilities),
          'invoice_description', inv.description,
          'customer_invoice_id', inv.id, 'customer_invoice_number', inv.invoice_number, 'attempt', attempts + 1,
          'cooling_off_consent', jsonb_build_object('method', 'invoice', 'accepted_at', inv.cooling_off_consent_at,
            'version', inv.cooling_off_consent_version, 'wording', consent->>'wording',
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton))),
        case when attempts = 0 then inv.invoice_number else inv.invoice_number || '-' || (attempts + 1)::text end)
      returning * into pay;
    insert into private.payment_lines (payment_id, line_number, plan_version_id, amount_cents, slot_count)
      values (pay.id, 1, plan.id, inv.total_cents, inv.slots);
  else
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
  end if;
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
  -- More than 90 days ago only to record again exactly the bank credit of an
  -- expired transfer (checked below, under the locks).
  if cleared > today then
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
  -- 20261118044440_bank_transfer_expiry.sql: a waiting record of this bank
  -- credit or of this invoice that has waited 14 days is marked expired first, so it
  -- no longer holds them; the unique indexes still allow one open record. A
  -- credit that cleared more than 90 days ago is accepted only to record again
  -- exactly the credit of an expired transfer of the same account (and of the
  -- same invoice, when that transfer named one).
  perform internal.expire_invoice_transfer(t.id) from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and (t.customer_invoice_id = inv.id or (t.amount_received_cents = inv.total_cents and t.cleared_on = cleared
        and upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key));
  if cleared < today - 90 and not internal.invoice_transfer_credit_expired(reference_key, inv.total_cents, cleared,
      inv.account_id, inv.id) then
    raise exception 'the money must have cleared today or in the last 90 days' using errcode='22023', detail='cleared_date_invalid';
  end if;
  -- The same bank credit waiting or confirmed: the same request again by the
  -- same staff member returns it; anything else is refused. A declined or
  -- expired record does not count.
  select * into prior from private.invoice_transfers t
    where upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')) = reference_key
      and t.amount_received_cents = inv.total_cents and t.cleared_on = cleared
      and t.status not in ('declined', 'expired');
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
      and internal.invoice_transfer_waiting(t)) then
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
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice.
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and (internal.individual_slot_plan(v.plan_code) or internal.slot_package_plan(v.plan_code))
    and v.price_cents = inv.unit_price_cents;
  if not found then
    raise exception 'this invoice''s slot is no longer sold at its price' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(inv.account_id);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before slots are recorded'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  if internal.slot_package_plan(plan.plan_code) then
    -- An early check of the package rules; confirmation checks them again.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.slot_package_open(inv.account_id) then
      raise exception 'the customer already has a Multi-listing package; void this invoice'
        using errcode='PT409', detail='package_active';
    end if;
  else
    -- E3 (20261114154823): while the person's Multi-listing package runs (until
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid;
    -- except (D6, 20261119151152) a bank transfer to an invoice issued before
    -- the package started: its slots run beside the package to their own end.
    if internal.slot_package_blocks_invoice(fingerprint, inv.account_id, inv.issued_at) then
      raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
        using errcode='PT409', detail='package_active';
    end if;
    -- An early check of the slot limit; confirmation checks it again.
    if (internal.individual_slots_counted(fingerprint, inv.account_id, null)->>'held')::integer + inv.slots
        > internal.individual_slot_limit(fingerprint) then
      raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
    end if;
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


CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint; inv private.customer_invoices;
  is_package boolean;
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
  if is_package then
    -- One package per account at a time, only while packages are on sale (as
    -- an Ozow payment of a package is delivered).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||t.account_id::text, 707));
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale; decline this transfer and return the money'
        using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.slot_package_open(t.account_id) then
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
    if plan.price_cents * t.slots <> t.amount_received_cents then
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
            'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately')),
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
    'slots_started', made, 'ends_at', statement_timestamp() + make_interval(days => plan.duration_days),
    'repeated', false);
end;
$function$;
alter function internal.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function internal.confirm_staff_invoice_payment(uuid) from public;
grant execute on function internal.confirm_staff_invoice_payment(uuid) to authenticated;


CREATE OR REPLACE FUNCTION internal.customer_invoice_dto(i private.customer_invoices, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issued_at', i.issued_at, 'due_on', to_char(i.due_on::timestamp, 'YYYY-MM-DD'),
    'seller', i.seller,
    'buyer', case when i.buyer_name is null then null else jsonb_build_object('name', i.buyer_name,
      'address', i.buyer_address, 'registration_number', i.buyer_registration_number) end,
    'revision', i.revision, 'term_days', (select v.duration_days from private.plan_versions v where v.id = i.plan_version_id),
    'slots', i.slots, 'unit_price_cents', i.unit_price_cents, 'total_cents', i.total_cents,
    'description', i.description, 'currency', 'ZAR', 'payment_reference', i.invoice_number,
    'cooling_off_consent_at', i.cooling_off_consent_at, 'cooling_off_consent_version', i.cooling_off_consent_version,
    'consent', internal.customer_invoice_consent(),
    'paid_at', i.paid_at, 'payment_id', i.payment_id,
    'payment_status', (select p.status from private.payments p where p.id = i.payment_id),
    'voided_at', i.voided_at,
    'transfer_waiting', exists(select 1 from private.invoice_transfers t
      where t.customer_invoice_id = i.id and internal.invoice_transfer_waiting(t)),
    'latest_attempt', (select jsonb_build_object('payment_id', p.id, 'attempt', l.attempt, 'status', p.status,
        'checkout_open', p.status = 'pending' and p.checkout_url is not null
          and p.checkout_expires_at > pg_catalog.clock_timestamp())
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id order by l.attempt desc limit 1))
  || case when p_staff is null then '{}'::jsonb else jsonb_build_object('account_id', i.account_id,
    'customer_email', (select u.email from auth.users u where u.id = i.account_id),
    'customer_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.account_id)),
    'issued_by_me', internal.same_identity(i.issued_by, p_staff),
    'issued_by_name', internal.profile_public_name((select f.display_name from private.profiles f where f.account_id = i.issued_by)),
    'issue_reason', i.issue_reason, 'void_reason', i.void_reason,
    'attempts', (select count(*) from private.customer_invoice_payments l where l.invoice_id = i.id),
    'extra_payments', coalesce((select jsonb_agg(p.id order by p.completed_at, p.id)
      from private.customer_invoice_payments l join private.payments p on p.id = l.payment_id
      where l.invoice_id = i.id and p.completed_at is not null and p.id is distinct from i.payment_id), '[]'::jsonb)) end;
$function$;
alter function internal.customer_invoice_dto(private.customer_invoices,uuid) owner to postgres;
revoke all on function internal.customer_invoice_dto(private.customer_invoices,uuid) from public;


CREATE OR REPLACE FUNCTION internal.request_package_invoice(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); plan private.plan_versions; total bigint; unpaid text;
  prior private.package_invoice_requests; waiting private.package_invoice_requests; made private.package_invoice_requests;
  consent jsonb := internal.customer_invoice_consent();
begin
  if p_plan_id is null or p_slots is null or p_expected_total_cents is null or p_request_id is null then
    raise exception 'package term, number of slots, total and request id required' using errcode='22023';
  end if;
  -- Paid by bank transfer, the slots start without the 7-day cooling-off: the
  -- member confirms it when asking (posting-v5), in the invoice's own words.
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before asking for an invoice'
      using errcode='22023', detail='invoice_consent_required';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  select * into plan from private.plan_versions v
    where v.id = p_plan_id and v.retired_at is null and internal.slot_package_plan(v.plan_code);
  if not found then raise exception 'this package term is not on sale' using errcode='22023'; end if;
  -- The package checkout's numbers: 5 to 250 slots; an invoice at any amount.
  if p_slots < 5 or p_slots > 250 then
    raise exception 'a package has 5 to 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you ask for a package invoice' using errcode='PT412';
  end if;
  total := plan.price_cents * p_slots;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  -- The same request again (a retried submission) returns the first answer.
  select * into prior from private.package_invoice_requests r
    where r.account_id = actor and r.member_request_id = p_request_id;
  if found then
    if prior.plan_version_id = plan.id and prior.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(prior, null) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already asked for another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  if internal.slot_package_open(actor) then
    raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
  end if;
  select i.invoice_number into unpaid from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
    where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)
    order by i.issued_at limit 1;
  if unpaid is not null then
    raise exception 'your package invoice % is not paid yet; pay it, or ask us to cancel it first', unpaid
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  -- One request open at a time. The same order again: the waiting request
  -- stands. Another order replaces it while no staff member has prepared it.
  select * into waiting from private.package_invoice_requests r
    where r.account_id = actor and r.status in ('requested', 'awaiting_approval')
    for update;
  if found then
    if waiting.status = 'awaiting_approval' then
      raise exception 'your invoice is being prepared; ask us to cancel it before asking for another'
        using errcode='PT409', detail='package_invoice_request_open';
    end if;
    if waiting.plan_version_id = plan.id and waiting.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(waiting, null) || jsonb_build_object('repeated', true);
    end if;
  end if;
  -- At most 10 new requests per account in 24 hours (each other order is a
  -- new request), so the staff queue cannot be flooded.
  if (select count(*) from private.package_invoice_requests r
      where r.account_id = actor and r.requested_at > statement_timestamp() - interval '24 hours') >= 10 then
    raise exception 'too many invoice requests today; try again tomorrow or contact us'
      using errcode='PT429', detail='package_invoice_requests_limit';
  end if;
  if waiting.id is not null then
    update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
      where id = waiting.id;
  end if;
  insert into private.package_invoice_requests (account_id, member_request_id, plan_version_id, term_days, slots,
      unit_price_cents, total_cents, consent_at, consent_version, consent_terms_version)
    values (actor, p_request_id, plan.id, plan.duration_days, p_slots, plan.price_cents, total, statement_timestamp(),
      consent->>'version', (select c.version from private.posting_terms_current c where c.singleton))
    returning * into made;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.package_invoice_request_dto(made, null) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function internal.request_package_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;


CREATE OR REPLACE FUNCTION internal.get_my_package_invoice_request()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); latest private.package_invoice_requests;
begin
  select * into latest from private.package_invoice_requests r where r.account_id = actor
    order by r.requested_at desc, r.id desc limit 1;
  perform internal.price_draft_actor();
  return jsonb_build_object('request', case when latest.id is null then null
    else internal.package_invoice_request_dto(latest, null) end);
end;
$function$;
alter function internal.get_my_package_invoice_request() owner to postgres;
revoke all on function internal.get_my_package_invoice_request() from public;
grant execute on function internal.get_my_package_invoice_request() to authenticated;


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
  -- 20261119025106: while a package invoice of the account is unpaid, it is
  -- paid (or cancelled) first, so no second package is bought beside it.
  if exists(select 1 from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
      where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)) then
    raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
      using errcode='PT409', detail='package_invoice_unpaid';
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
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('house_slot_events',$q$select h.entitlement_id,h.action,h.ends_at,h.recorded_at from private.house_slot_events h
      join private.entitlements e on e.id=h.entitlement_id where e.owner_id=$1 order by h.recorded_at,h.id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
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
    ('post_likes',$q$select l.post_id,l.created_at from (select post_id,created_at,id from private.post_likes
      where account_id=$1 order by created_at desc,id limit 2000) l$q$),
    ('post_likes_summary',$q$select count(*) total,min(created_at) first_at,max(created_at) last_at
      from private.post_likes where account_id=$1$q$),
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
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

-- The added trigger and functions.
drop trigger customer_invoices_system_void on private.customer_invoices;
drop function internal.customer_invoice_system_void_guard();
drop function api.void_ended_package_add_invoices(integer);
drop function internal.void_ended_package_add_invoices(integer);
drop function internal.package_invoice_blocking(uuid,uuid);
drop function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid);
drop function api.start_package_add_checkout(uuid,integer,bigint,boolean);
drop function api.get_my_package_add_offer();
drop function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid);
drop function internal.start_package_add_checkout(uuid,integer,bigint,boolean);
drop function internal.get_my_package_add_offer();
drop function internal.slot_package_keep_posts(uuid);
drop function internal.package_add_invoice_package(uuid);
drop function internal.slot_package_add_ok(uuid,uuid,integer);
drop function internal.slot_package_add_quote(uuid);
drop function internal.slot_package_term_plan(integer);

-- The tables as before.
alter table private.customer_invoices drop constraint customer_invoices_void;
alter table private.customer_invoices add constraint customer_invoices_void
  check ((status = 'void') = (voided_by is not null and voided_at is not null and void_reason is not null));
drop index private.package_invoice_requests_package_idx;
alter table private.package_invoice_requests drop constraint package_invoice_requests_package_id_fkey;
alter table private.package_invoice_requests drop constraint package_invoice_requests_slots_check;
alter table private.package_invoice_requests drop constraint package_invoice_requests_add;
alter table private.package_invoice_requests drop constraint package_invoice_requests_kind_check;
alter table private.package_invoice_requests drop column invoiced_days;
alter table private.package_invoice_requests drop column days_left;
alter table private.package_invoice_requests drop column package_id;
alter table private.package_invoice_requests drop column kind;
alter table private.package_invoice_requests add constraint package_invoice_requests_slots_check
  check (slots >= 5 and slots <= 250);

notify pgrst,'reload schema';
commit;
