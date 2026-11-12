-- Reviewed rollback for updates/20261112174600_individual_slots_r69.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Run it BEFORE reverting the
-- website release that uses the update: with the slots off sale that release
-- shows paid slots as paused (its checkout page and route refuse with the
-- paused message, and "My slots" says the slots cannot be shown right now),
-- whereas the release before it would link to slots its checkout cannot sell
-- (internal.start_checkout refuses them). Then revert that release. Roll back
-- 20261112173841_switch_posting_terms_v4.sql only after this rollback.
--
-- It works only before anyone ordered a slot: it refuses (55000) once a
-- payment line or a staff-raised limit exists, because those are payment and
-- audit records. After that, stop slot sales with a new reviewed update that
-- retires the three Individual slot plans, and fix forward.
--
-- It takes the three Individual slot plans off sale (retired_at; the rows stay
-- as history, as for every earlier plan), restores the previous bodies of
-- internal.start_checkout, internal.apply_provider_event, internal.activate_post,
-- internal.reverse_payment, internal.payment_partner_commission,
-- internal.partner_commission_guard and
-- internal.record_frontend_staff_payment_reversal, drops the update's commands, helpers,
-- triggers, tables, columns and indexes, puts back the one-entitlement and
-- one-commission-per-payment unique constraints and removes the
-- slots:raise_limit capability. Nothing is then on sale, as after
-- 20261112173841_switch_posting_terms_v4.sql. Applying the update again after
-- this rollback is refused while the retired plan rows exist: a new update
-- must publish new plan versions.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.payment_lines') is not null then
    lock table private.payment_lines in exclusive mode;
  end if;
  if to_regclass('private.individual_slot_limits') is not null then
    lock table private.individual_slot_limits in exclusive mode;
  end if;
end$$;

do $$
declare lines bigint; limits bigint;
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.start_checkout(uuid,uuid)')) is distinct from '730791aa633108ff890a12d76eb8149c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.apply_provider_event(jsonb)')) is distinct from '8a226003da741381225c11dfd1e44308'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.activate_post(uuid)')) is distinct from 'd9dd75c96dd1cce5b490eaafffe308be'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.reverse_payment(uuid,text,text)')) is distinct from '66005adb9e06b17e689dbac47ce93d5a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_partner_commission()')) is distinct from 'e99f071fae090328566a61186843c6e2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.partner_commission_guard()')) is distinct from 'ddab4845789fef80739183deeaf75e4d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_line_guard()')) is distinct from 'b15e1db8b48ae9de6b4372ecef62ceed'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_limit_guard()')) is distinct from '1af83fc4a5bd4555a8b99412f8acc5f1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_plan(text)')) is distinct from 'c0c1d06dc52122641d02db6b1364be75'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_identity(uuid)')) is distinct from '4e4552c83cb629e96f1300060eeff16b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_limit(text)')) is distinct from '90ecd5c02572cc9831468458f3ae0e2d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slots_counted(text,uuid,uuid)')) is distinct from 'e3ec1bf332a4d2e93760d1a3d68f966b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_business_checked(uuid)')) is distinct from 'e4f858e82e99bf3d1a62ea0b0c2d2820'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.start_slot_checkout(uuid,integer,bigint,boolean)')) is distinct from 'dcbb5be85829b017a483c21b91c95602'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.start_slot_checkout(uuid,integer,bigint,boolean)')) is distinct from 'b9089234d615e837ba75d31f42b8f7bf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)')) is distinct from '44758ca0c94c7fedf9bcbeb0fa5a7736'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_slot_reversal(uuid,text,text)')) is distinct from '2a52fbde1bcd5076472a92751af0bedb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text)')) is distinct from '1a10c7ba7f8c2c85674fb3c9a0b1026e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text)')) is distinct from '92da468af327632f8d1f4cba716642c9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_my_slots()')) is distinct from '6e3a3149cf2576ae2d66ab085cc8da58'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_my_slots()')) is distinct from '0f06e8bc211c4506dae9744479d4dbdf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_frontend_staff_payment_reversal(uuid,text,text)')) is distinct from 'd48c969a572d66b0166fd63f92f68fa3'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.same_identity(uuid,uuid)')) is distinct from '535e5c87d944edd45bd2b3dce28f98b6'
    or to_regclass('private.payment_lines') is null
    or to_regclass('private.individual_slot_limits') is null then
    raise exception 'rollback precondition: the individual slots update is not applied' using errcode='55000';
  end if;
  select count(*) into lines from private.payment_lines;
  select count(*) into limits from private.individual_slot_limits;
  if lines > 0 or limits > 0 then
    raise exception 'rollback precondition: slots were already ordered (% payment lines, % raised limits); fix forward with a new update',
      lines, limits using errcode='55000';
  end if;
end$$;

lock table private.plan_versions in share row exclusive mode;
update private.plan_versions set retired_at=statement_timestamp()
  where plan_code in ('individual_30d','individual_90d','individual_180d') and retired_at is null;


-- The previous bodies (as in database/foundation/current/ before this update).
CREATE OR REPLACE FUNCTION internal.start_checkout(p_product_id uuid, p_target_post uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  plan private.plan_versions;
  addon private.addon_versions;
  pay private.payments;
  target private.posts;
  purchase_entitlement uuid;
begin
  if p_product_id is null then raise exception 'product required' using errcode = '22023'; end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  select * into plan from private.plan_versions v where v.id = p_product_id and v.retired_at is null and v.is_public;
  if not found then
    select * into addon from private.addon_versions v where v.id = p_product_id and v.retired_at is null;
    if not found then raise exception 'product not available' using errcode = '22023'; end if;
    select * into target from private.posts p where p.id=p_target_post and p.owner_id=actor for update;
    if not found or target.status <> 'live' then
      raise exception 'add-ons apply to your own live post' using errcode = '22023';
    end if;
    if addon.kind in ('boost','featured') and target.kind <> 'event' then
      raise exception 'Boost and Featured are offered only for events' using errcode='22023';
    end if;
    if not exists(select 1 from private.public_eligible_posts p where p.id=target.id)
      or target.published_at>clock_timestamp() or target.visible_until<=clock_timestamp()
      or not exists(select 1 from internal.post_funding(target.id) f where f.funded_until>clock_timestamp()) then
      raise exception 'add-on target is no longer publicly eligible' using errcode='PT409';
    end if;
    purchase_entitlement:=internal.addon_purchase_entitlement(actor,target.id,addon.kind);
    if purchase_entitlement is null then
      raise exception 'an eligible paid capability for this area and converted content is required' using errcode='PT403';
    end if;
  elsif p_target_post is not null then
    raise exception 'plans do not take a target post' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id = actor and p.status = 'pending'
      and coalesce(p.plan_version_id, p.addon_version_id) = p_product_id
      and p.target_post_id is not distinct from p_target_post;
  if not found then
    insert into private.payments (owner_id, product_kind, plan_version_id, addon_version_id, target_post_id,
      amount_cents, currency, snapshot)
    values (actor, case when plan.id is not null then 'plan' else 'addon' end, plan.id, addon.id, p_target_post,
      coalesce(plan.price_cents, addon.price_cents), coalesce(plan.currency, addon.currency),
      case when plan.id is not null then jsonb_build_object('kind', 'plan', 'code', plan.plan_code,
          'version', plan.version, 'label', plan.label, 'area', plan.area, 'price_cents', plan.price_cents,
          'duration_days', plan.duration_days, 'slot_capacity', plan.slot_capacity,
          'activations_per_period', plan.activations_per_period, 'activation_period_days', plan.activation_period_days,
          'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
          'addon_capabilities',to_jsonb(plan.addon_capabilities))
        else jsonb_build_object('kind', 'addon', 'addon', addon.kind, 'version', addon.version,
          'days', addon.days, 'price_cents', addon.price_cents, 'target_kind',target.kind,
          'target_area',target.area,'target_owner_id',target.owner_id,
          'purchase_entitlement_id',purchase_entitlement,
          'addon_capabilities',(select to_jsonb(e.addon_capabilities) from private.entitlements e where e.id=purchase_entitlement)) end)
    returning * into pay;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
    'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
    'reused', pay.created_at < statement_timestamp());
end;
$function$;
alter function internal.start_checkout(uuid,uuid) owner to postgres;
revoke all on function internal.start_checkout(uuid,uuid) from public;
grant execute on function internal.start_checkout(uuid,uuid) to authenticated;

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
  ent uuid;
  payment_owner uuid;
  prior private.provider_events;
  target private.posts;
  fulfillable boolean;
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
    fulfillable := pay.status<>'cancelled'
      and exists(select 1 from private.current_account_access u where u.id=pay.owner_id);
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
    elsif pay.product_kind = 'plan' then
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))))
      returning id into ent;
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
      pay.amount_cents - vat, vat, pay.amount_cents, coalesce(snap->>'label', initcap(snap->>'addon') || ' ' || (snap->>'days') || ' days'));
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
    select count(*) into used from private.post_activations a where a.entitlement_id = ent.id and a.released_at is null;
    continue when used >= ent.slot_capacity;
    if ent.activations_per_period is not null then
      select count(*) into used from private.post_activations a where a.entitlement_id = ent.id
        and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days);
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

CREATE OR REPLACE FUNCTION internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; released integer := 0; v_post_ids uuid[]; payment_owner uuid;
begin
  if p_kind not in ('refunded', 'chargeback') or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reversal kind and audit reason required' using errcode = '22023';
  end if;
  select p.owner_id into payment_owner from private.payments p where p.id=p_payment_id;
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.id = p_payment_id for update;
  if not found or pay.status <> 'complete' then
    raise exception 'only completed payments can be reversed' using errcode = '22023';
  end if;
  begin
    perform e.id from private.entitlements e where e.payment_id=pay.id order by e.id for update nowait;
    perform p.id from private.posts p where p.id=pay.target_post_id or p.id in
      (select a.post_id from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where e.payment_id=pay.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payments set status = p_kind, fulfillment_status='reversed', status_changed_at = statement_timestamp() where id = pay.id;
  update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind where payment_id = pay.id;
  with released_rows as (
    update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
    from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null
    returning a.post_id
  )
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released_rows;
  released := cardinality(v_post_ids);
  update private.posts p set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
    where p.id = any (v_post_ids) and (p.status in ('live', 'pending_moderation')
      or (p.status = 'paused' and not exists (select 1 from private.frontend_content_holds h
        where h.post_id = p.id and h.released_at is null)));
  update private.post_search_documents set is_visible = false where post_id = any (v_post_ids);
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$function$;
alter function internal.reverse_payment(uuid,text,text) owner to postgres;
revoke all on function internal.reverse_payment(uuid,text,text) from public;
grant execute on function internal.reverse_payment(uuid,text,text) to service_role;

CREATE OR REPLACE FUNCTION internal.payment_partner_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare acq private.account_acquisitions; partner private.partners; c record;
begin
  if new.status in('refunded','chargeback') then
    for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
        where x.payment_id=new.id and x.status<>'reversed' for update of x loop
      update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
        reversal_reason='Payment '||new.status where id=c.id;
      perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
    end loop;
    return null;
  end if;
  if new.status<>'complete' then return null; end if;
  select * into acq from private.account_acquisitions a where a.account_id=new.owner_id;
  if acq.partner_id is null then return null; end if;
  select * into partner from private.partners p where p.id=acq.partner_id;
  if partner.status<>'active' or partner.account_id=new.owner_id then return null; end if;
  insert into private.partner_commissions(partner_id,payment_id,referred_account_id,base_cents,rate_bps,amount_cents,
      eligible_at)
    values(partner.id,new.id,new.owner_id,new.amount_cents,coalesce(partner.commission_bps,2000),
      floor(new.amount_cents::numeric*coalesce(partner.commission_bps,2000)/10000),
      statement_timestamp()+interval '30 days')
    on conflict(payment_id) do nothing;
  return null;
end;
$function$;
alter function internal.payment_partner_commission() owner to postgres;
revoke all on function internal.payment_partner_commission() from public;

CREATE OR REPLACE FUNCTION internal.partner_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.partner_id,new.payment_id,new.referred_account_id,new.base_cents,new.rate_bps,new.amount_cents,
      new.eligible_at,new.created_at) is distinct from (old.id,old.partner_id,old.payment_id,old.referred_account_id,
      old.base_cents,old.rate_bps,old.amount_cents,old.eligible_at,old.created_at)
    or old.status='reversed'
    or (old.status,new.status) not in(('pending','pending'),('pending','approved'),('pending','reversed'),
      ('approved','approved'),('approved','paid'),('approved','reversed'),('paid','paid'),('paid','reversed')) then
    raise exception 'commission history is immutable' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.partner_commission_guard() owner to postgres;
revoke all on function internal.partner_commission_guard() from public;

CREATE OR REPLACE FUNCTION internal.record_frontend_staff_payment_reversal(p_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;owner uuid;prior private.frontend_payment_reversals;result jsonb;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false)
    then raise exception 'valid reversal and reason required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_id::text,0));
  perform internal.staff_actor('payments:refund');
  select * into prior from private.frontend_payment_reversals where payment_id=p_id;
  if found then
    if prior.actor_id=actor and prior.kind=p_kind and prior.reason=p_reason then
      return jsonb_build_object('status',prior.kind,'released_activations',prior.released_activations);
    end if;
    raise exception 'payment already reversed' using errcode='PT409';
  end if;
  select owner_id into owner from private.payments where id=p_id;
  if owner=actor then raise exception 'a different staff member must record this reversal' using errcode='42501';end if;
  result:=internal.reverse_payment(p_id,p_kind,p_reason);
  perform internal.staff_actor('payments:refund');
  insert into private.frontend_payment_reversals(payment_id,actor_id,kind,reason,released_activations)
    values(p_id,actor,p_kind,p_reason,(result->>'released_activations')::integer);
  return result;
end$function$;
alter function internal.record_frontend_staff_payment_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_frontend_staff_payment_reversal(uuid,text,text) from public;
grant execute on function internal.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;

drop function api.start_slot_checkout(uuid,integer,bigint,boolean);
drop function api.record_staff_slot_reversal(uuid,text,text);
drop function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text);
drop function api.get_my_slots();
drop function internal.start_slot_checkout(uuid,integer,bigint,boolean);
drop function internal.record_staff_slot_reversal(uuid,text,text);
drop function internal.get_my_slots();
drop function internal.same_identity(uuid,uuid);

alter table private.entitlements drop constraint entitlements_payment_line_source;
drop index private.entitlements_payment_line_idx;
drop index private.entitlements_payment_unlined_idx;
drop index private.entitlements_payment_id_idx;
alter table private.entitlements drop column payment_line_id;
alter table private.entitlements add constraint entitlements_payment_id_key unique (payment_id);
drop index private.partner_commissions_payment_line_idx;
drop index private.partner_commissions_payment_unlined_idx;
drop index private.partner_commissions_payment_id_idx;
alter table private.partner_commissions drop column payment_line_id;
alter table private.partner_commissions add constraint partner_commissions_payment_id_key unique (payment_id);
drop index private.accepted_identity_facts_identity_idx;
drop table private.payment_lines;
drop table private.individual_slot_limits;
drop function internal.payment_line_guard();
drop function internal.individual_slot_limit_guard();
drop function internal.individual_slot_plan(text);
drop function internal.individual_slot_identity(uuid);
drop function internal.individual_slot_limit(text);
drop function internal.individual_slots_counted(text,uuid,uuid);
drop function internal.individual_slot_business_checked(uuid);
drop function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text);
delete from private.staff_capabilities where role='admin' and capability='slots:raise_limit';

do $$begin
  if exists(select 1 from private.plan_versions v where v.is_public and v.retired_at is null) then
    raise exception 'a plan is still on sale after the rollback';
  end if;
end$$;
commit;
