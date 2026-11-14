-- Reviewed rollback for updates/20261114093742_renew_slots_early.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert and deploy the website
-- release that uses the update FIRST: this rollback removes the commands that
-- release calls (the renewal checkout, the renewal sweep and My slots v2).
--
-- It works only while nobody renewed a slot and no reminder was queued: it
-- refuses (55000) once a payment line names a slot it renews, a grant belongs
-- to a renewed slot, an activation was moved into a renewed period or a
-- renewal reminder is in the outbox, because those records would lose their
-- meaning. After that, fix forward.
--
-- It puts back the thirteen function bodies the update replaced (slot
-- counting, the new-slot checkout, the Ozow settlement and the staff
-- activation of 20261114041000, post activation, post funding and its
-- eligibility, the post lifecycle job, the hold release, the media allowance,
-- the mail claim, the retention job and the privacy export) and the two post
-- funding views, restores the outbox kinds, and drops the update's functions,
-- trigger, indexes, constraints and columns. Payments, slots, posts and
-- commissions are untouched.
begin;
set local lock_timeout='5s';

lock table private.payment_lines, private.entitlements, private.post_activations, private.outbox_events
  in share row exclusive mode;

do $$
declare renewing bigint;
begin
  if not exists(select 1 from pg_attribute a where a.attrelid='private.entitlements'::regclass and a.attname='slot_id'
      and not a.attisdropped)
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slots_counted(text,uuid,uuid)')) is distinct from '4213e64e4b2fb9f8062fe02277a28e69'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.start_slot_checkout(uuid,integer,bigint,boolean)')) is distinct from '4ce514eae4c2fb3fd9b0a0ecc40ac498'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.apply_provider_event(jsonb)')) is distinct from '19d5c2eb7e1a75210bc2b77d2cbb961b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.activate_staff_paid_payment(uuid,text)')) is distinct from '03c8a3314cd99f02fb465a391ca2942f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.activate_post(uuid)')) is distinct from 'bc99d728b6a6e4465b87b0fd607aeb08'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.post_funding(uuid)')) is distinct from '16c30a8438ae9d43796f5f78f4144ad0'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_supported_notification_outbox(text[],integer)')) is distinct from 'c7206aab3ac04b1f9d9b6ce2dc47bd0f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.retention_commerce(integer)')) is distinct from '06d7529db4898b7bb3b158d38a1d5929'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.entitlement_for_post_eligible(uuid,uuid,uuid)')) is distinct from 'd3861dfcebe2d7e1d6955a0c549b2db3'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.run_post_lifecycle(integer)')) is distinct from 'cb178dd0e47f84cbb277a87abd31b140'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.release_frontend_content_hold(uuid,integer,text)')) is distinct from 'c975e7b75ad113c28018d36477c953f7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.set_post_media(uuid,integer,jsonb)')) is distinct from 'cd3c1062f03370a6a9346ed935eff0fc'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.frontend_privacy_export_data(uuid)')) is distinct from '03c73dba3ba38c4866186a8b84b4a521'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_my_slots_v2()')) is distinct from '94a9406f69aba4f4abdf419809498258'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_my_slots_v2()')) is distinct from 'ccd8613df13112af02b3d062cc0ea486'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.run_slot_renewals(integer)')) is distinct from 'b4e29cfe085196212c3e710c09631de2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.run_slot_renewals(integer)')) is distinct from 'dc2fa45bd9d0502e6f3dafbfd75984d4'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)')) is distinct from 'ee9fe432c0390ba2fecdcebff294e775'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)')) is distinct from '94de32ca80099d59db23aed33c6e7ee2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.issue_slot_line_entitlements(uuid)')) is distinct from '85ae00308b9abb35c6c13bc67821d39d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_grant_revoked()')) is distinct from '00f9bfbdb6f79cc4496f5747b85cdd17'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.refresh_slot_chain_documents(uuid)')) is distinct from '8654d4f1d0886ad9e877835077a2ad3d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone)')) is distinct from 'b43abb8cb82c15c1a3f240680d3710ac'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_renewals_allowed(text,uuid,uuid,uuid[])')) is distinct from '0012cbcef8b31da4ed93ee267ca13afd'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_lines_renewing(uuid)')) is distinct from '9ce02eccc93128dff9142cb06db0efe6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_lines_adding(uuid)')) is distinct from '74fe04e6cff80dece687c24e05c18fb7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slots_extended(text,uuid,uuid,uuid[],timestamp with time zone)')) is distinct from 'fa0c223b351aa2fb07c4d1d1c42a9f24'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_renewal_due(uuid,uuid)')) is distinct from 'f0eb3360c8456cc4b191c315c61c482e'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_chain_end(uuid)')) is distinct from 'de3528681a1ad52128c6db296e413d12'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_chain_held(uuid)')) is distinct from '23b8b9c552d561b4f2d818e9d5056f61'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_chain_last_end(uuid)')) is distinct from 'b1751aee92ddb5d65ed0c95a0bc1b8ea'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.slot_renewal_window()')) is distinct from 'c238f2c972a2f767c6a70d939d552000'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.individual_slot_owners(text,uuid)')) is distinct from '49c59acc8f02fcb09e757c0584b7de51' then
    raise exception 'renew slots early rollback: the update is not applied as reviewed' using errcode='55000';
  end if;
  select (select count(*) from private.payment_lines where renews_entitlement_id is not null)
    + (select count(*) from private.entitlements where slot_id is not null)
    + (select count(*) from private.post_activations where continued)
    + (select count(*) from private.outbox_events where kind='slot_renewal_reminder') into renewing;
  if renewing > 0 then
    raise exception 'renew slots early rollback: slots were already renewed or reminders queued; fix forward'
      using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.individual_slots_counted(p_identity text, p_owner uuid, p_exclude uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with owners as (
    select o.id from (
      select p_owner as id
      union
      select f.owner_id from private.accepted_identity_facts f where p_identity is not null and f.identity_hmac=p_identity
    ) o
    -- Slots of an account that lost access for good (closed, deleted, or under
    -- an approved permanent ban that was not lifted) never block the person,
    -- for example after an impostor's account is banned. An account blocked for
    -- a while (an Auth ban with an end, a suspension, an emergency restriction)
    -- keeps counting: its slots come back when the block ends.
    where exists(select 1 from auth.users u where u.id=o.id and u.deleted_at is null)
      and not exists(select 1 from private.account_closures c where c.user_id=o.id)
      and not exists(select 1 from private.decisions d
        join private.evidence_cases c on c.id=d.case_id
        left join private.frontend_account_restrictions x on x.decision_id=d.id and not x.emergency
        where c.subject_id=o.id and d.status='approved' and d.action='restrict_account'
          and d.scope_kind in ('native','report_ban') and x.lifted_at is null)
  )
  select jsonb_build_object(
    'held', (select count(*) from private.entitlements e
        join private.payment_lines l on l.id=e.payment_line_id
        join private.plan_versions v on v.id=l.plan_version_id
      where e.owner_id in (select id from owners) and e.source='retail_paid' and e.status='active'
        and e.ends_at>clock_timestamp() and internal.individual_slot_plan(v.plan_code)),
    'pending', (select count(*) from private.payment_lines l
        join private.payments p on p.id=l.payment_id
        join private.plan_versions v on v.id=l.plan_version_id
      where p.owner_id in (select id from owners) and p.status='pending' and p.id is distinct from p_exclude
        and internal.individual_slot_plan(v.plan_code)
        and (p.checkout_expires_at>clock_timestamp() or p.checkout_claim_until>clock_timestamp()
          or (p.checkout_url is null and p.created_at>clock_timestamp()-interval '30 minutes'))));
$function$;
alter function internal.individual_slots_counted(text,uuid,uuid) owner to postgres;
revoke all on function internal.individual_slots_counted(text,uuid,uuid) from public;

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
    if lines <> p_slots then
      if pay.checkout_url is not null then
        -- Open at Ozow for another number of slots: the member continues,
        -- checks or cancels it first.
        perform internal.price_draft_actor();
        return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
          'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
          'slots', lines, 'reused', true);
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
        -- of the identity); otherwise the money goes to reconciliation.
        fingerprint := internal.individual_slot_identity(pay.owner_id);
        if fingerprint is not null then
          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
        end if;
        fulfillable := (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer
          + line_count <= internal.individual_slot_limit(fingerprint);
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
      -- One entitlement per slot, each with its own line (and so its own refund).
      insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
        activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      select pay.owner_id, 'retail_paid', snap->>'area', pay.id, l.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb)))
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number;
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
  fingerprint text; commissions integer := 0; has_lines boolean;
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
      -- Within the person's Individual slot limit (every account of the identity).
      fingerprint := internal.individual_slot_identity(pay.owner_id);
      if fingerprint is not null then
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
      end if;
      if (internal.individual_slots_counted(fingerprint, pay.owner_id, pay.id)->>'held')::integer + line_count
          > internal.individual_slot_limit(fingerprint) then
        raise exception 'more slots than the person''s limit; raise the limit or refund' using errcode='PT429', detail='slot_limit_reached';
      end if;
      insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
        activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      select pay.owner_id, 'retail_paid', snap->>'area', pay.id, l.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb)))
      from private.payment_lines l where l.payment_id = pay.id and l.status = 'open' order by l.line_number;
    else
      insert into private.entitlements (owner_id, source, area, payment_id, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, (snap->>'slot_capacity')::integer,
        (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
        (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, statement_timestamp(),
        statement_timestamp() + make_interval(days => (snap->>'duration_days')::integer),
        array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))));
    end if;
    get diagnostics made = row_count;
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
      -- Posts going live in the period: a new post and an ended post brought
      -- back each count; a submission that review rejected does not.
      select count(*) into used from private.post_activations a where a.entitlement_id = ent.id
        and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days)
        and a.release_reason is distinct from 'moderation';
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

CREATE OR REPLACE FUNCTION internal.post_funding(p_post_id uuid)
 RETURNS TABLE(funded_until timestamp with time zone, max_photos integer, max_videos integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select e.ends_at, 10, 1
  from private.posts p join private.event_details e on e.post_id = p.id
  where p.id = p_post_id and p.kind = 'event'
  union all
  select e.ends_at, e.max_photos, e.max_videos
  from private.posts p
  join private.post_activations a on a.post_id = p.id and a.released_at is null and a.owner_id = p.owner_id
  join private.entitlements e on e.id = a.entitlement_id
  where p.id = p_post_id and p.kind <> 'event'
    and internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.area is null or e.area = p.area)
    and (e.owner_id = p.owner_id or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p.owner_id))
    and exists (select 1 from private.current_account_access u where u.id = e.owner_id)
    and (e.source <> 'retail_paid' or exists (select 1 from private.payments pay
      where pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'));
$function$;
alter function internal.post_funding(uuid) owner to postgres;
revoke all on function internal.post_funding(uuid) from public;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 20 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where kind=any(p_supported_kinds) and processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') or not exists(select 1 from private.account_closures c where c.user_id=u.id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end,
    'trial_ends_at',tr.ends_at,
    'trial_funds_post',case when tr.id is not null then exists(select 1 from private.post_activations a
      join private.posts fp on fp.id=a.post_id where a.entitlement_id=tr.id and a.released_at is null and fp.status='live') end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active';
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

CREATE OR REPLACE FUNCTION internal.retention_commerce(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare provider_events integer; invoices integer; addon_windows integer; partner_events integer;
  commissions integer; acquisitions integer; sponsorships integer; trial_claims integer; activations integer;
  entitlements integer; payments integer; customer_invoices integer; bank_transfers integer;
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
  delete from private.entitlements where id in(select e.id from private.entitlements e
    where (e.status='revoked' or e.ends_at<=statement_timestamp())
      and internal.retention_tax_year_due(coalesce(e.ends_at,e.created_at))
      and not exists(select 1 from private.organisation_sponsorships s where s.entitlement_id=e.id)
      and not exists(select 1 from private.post_activations a where a.entitlement_id=e.id)
      and not exists(select 1 from private.post_trial_claims c where c.trial_entitlement_id=e.id)
      and not exists(select 1 from private.trial_identities t where t.entitlement_id=e.id)
    order by e.created_at limit p_limit for update skip locked);
  get diagnostics entitlements=row_count;
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
    'bank_transfers',bank_transfers);
end;
$function$;
alter function internal.retention_commerce(integer) owner to postgres;
revoke all on function internal.retention_commerce(integer) from public;

CREATE OR REPLACE FUNCTION internal.entitlement_for_post_eligible(p_ent uuid, p_post uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  return exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
    where e.id=p_ent and p.owner_id=p_owner
      and e.status='active' and e.starts_at<=clock_timestamp() and e.ends_at>clock_timestamp()
      and (e.area is null or e.area=p.area)
      and (e.owner_id=p_owner or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=p_owner))
      and exists(select 1 from private.current_account_access u where u.id=p_owner)
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete')));
end;
$function$;
alter function internal.entitlement_for_post_eligible(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.entitlement_for_post_eligible(uuid,uuid,uuid) from public;

CREATE OR REPLACE FUNCTION internal.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_expired integer:=0; n_notices integer:=0; n_deleted integer:=0; n_extended integer:=0; n_kept integer:=0;
  r record; post private.posts; changed integer; decision jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023';
  end if;
  -- 1. Expiry. A Market or Business post whose paid run has ended expires,
  -- whether live or paused while it still holds its slot. Events are not
  -- expired: they are deleted when they end (step 3). A post under a staff
  -- hold keeps its state until the hold is released.
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select p.id,p.owner_id from private.posts p
    where p.kind<>'event' and p.visible_until<=clock_timestamp()
      and (p.status='live' or (p.status='paused' and exists(select 1 from private.post_activations a
        where a.post_id=p.id and a.released_at is null)))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
    order by p.visible_until,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.kind<>'event' and p.visible_until<=clock_timestamp()
      and (p.status='live' or (p.status='paused' and exists(select 1 from private.post_activations a
        where a.post_id=p.id and a.released_at is null)))
      for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=r.id and h.released_at is null) then continue; end if;
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- 2. Notices. At most p_limit new notices per invocation; old dedupe rows
  -- do not starve later notices. Lock/recheck each post so a concurrent change
  -- invalidates the captured revision first. The expiry notice keys on
  -- ended_at, which edits do not move; its ':3d' suffix gives posts that ended
  -- before this update one notice of the 3-day rule. The sold notice keys on
  -- the slot the post was sold in (its last activation, released or not), so
  -- neither a refund freeing the slot nor undoing and redoing "sold" repeats it.
  -- A post already due for deletion gets the deletion notice instead. A held
  -- post is not warned about a deletion that will not happen; an idle post's
  -- clock counts from the release of its last staff hold. A paused post that
  -- holds a slot is not idle: it expires with its run.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.ended_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint||':3d' as dedupe_key
      from private.posts p where p.status='expired' and p.kind<>'event' and p.deletes_at>clock_timestamp()
      union all
      select 'post_sold',p.id,p.owner_id,p.revision,p.ended_at,
        'post_sold:'||p.id||':'||coalesce((select a.id::text from private.post_activations a
          where a.post_id=p.id and a.activated_at<=p.ended_at order by a.activated_at desc,a.id desc limit 1),'none')
      from private.posts p where p.status='sold' and p.deletes_at>clock_timestamp()
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,i.idle_since+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from i.idle_since))::bigint
      from private.posts p cross join lateral (select greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id)) as idle_since) i
      where (p.status in('draft','rejected') or (p.status='paused' and not exists(select 1 from private.post_activations a
          where a.post_id=p.id and a.released_at is null)))
        and i.idle_since<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=n.id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=r.id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  -- 3. Deletion: ended runs at their deletion date (moved by the late-payment
  -- rule, internal.ended_post_decision), events that have ended, and idle
  -- drafts, rejected posts and paused posts without a slot, unless an open
  -- report keeps the post a little longer (internal.post_report_deferred).
  -- Deleting a post releases its slot (posts_release_activation). The payment
  -- rule is evaluated only for posts that are due or whose owner has confirmed
  -- a recent plan payment.
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and (p.deletes_at<=clock_timestamp()
          or (p.status='expired' and p.kind<>'event' and exists(select 1 from private.payments pay
            where pay.owner_id=p.owner_id and pay.product_kind='plan' and pay.created_at>=p.ended_at-interval '24 hours'
              and pay.status='complete' and pay.fulfillment_status='fulfilled')))
          and internal.ended_post_decision(p) is not null)
        or (p.kind='event' and p.edit_of is null and p.status not in('expired','sold','archived')
          and p.deletes_at<=clock_timestamp() and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))
        or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'
          and internal.post_idle_deletion_due(p)))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
      and not internal.post_report_deferred(p)
    order by coalesce(p.deletes_at,p.status_changed_at),p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=post.id and h.released_at is null) then continue; end if;
    if post.status in('expired','sold','archived') then
      decision:=internal.ended_post_decision(post);
      if decision is null then continue; end if;
      if decision->>'action' in('extend','keep') then
        insert into private.post_deletion_extensions(post_id,ended_at,grace_ended_at,payment_id,kept_at)
          values(post.id,post.ended_at,(decision->>'grace_ended_at')::timestamptz,(decision->>'payment_id')::uuid,
            case when decision->>'action'='keep' then clock_timestamp() end)
          on conflict(post_id) do update set ended_at=excluded.ended_at,grace_ended_at=excluded.grace_ended_at,
            payment_id=excluded.payment_id,extended_at=excluded.extended_at,kept_at=excluded.kept_at;
        update private.posts set deletes_at=(decision->>'deletes_at')::timestamptz where id=post.id;
        if decision->>'action'='keep' then
          insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
            values('post_kept',post.id,post.owner_id,'post_kept:'||post.id||':'||floor(extract(epoch from post.ended_at))::bigint)
            on conflict(dedupe_key) do nothing;
          n_kept:=n_kept+1;
        else
          n_extended:=n_extended+1;
        end if;
        continue;
      end if;
    elsif not ((post.kind='event' and post.edit_of is null and post.deletes_at<=clock_timestamp()
        and exists(select 1 from private.event_details e where e.post_id=post.id and e.ends_at<=clock_timestamp()))
      or internal.post_idle_deletion_due(post)) then
      continue;
    end if;
    if internal.post_report_deferred(post) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  -- Free-event submissions older than every rolling 30-day window.
  delete from private.event_submissions s where s.id in(select x.id from private.event_submissions x
    where x.submitted_at<=clock_timestamp()-interval '31 days' order by x.submitted_at limit p_limit);
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted,'extended',n_extended,'kept',n_kept);
end;
$function$;
alter function internal.run_post_lifecycle(integer) owner to postgres;
revoke all on function internal.run_post_lifecycle(integer) from public;
grant execute on function internal.run_post_lifecycle(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.release_frontend_content_hold(p_hold uuid, p_expected_version integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('content:restore');target uuid;subject uuid;h private.frontend_content_holds;
  post private.posts;state private.frontend_post_hold_state;review_reason text;did_restore boolean:=false;
begin
  review_reason:=internal.retention_reason(p_reason);
  select x.post_id,x.account_id into target,subject from private.frontend_content_holds x where x.id=p_hold;
  if not found then raise exception 'content hold unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into post from private.posts where id=target for update;
  select * into h from private.frontend_content_holds where id=p_hold for update;

  actor:=internal.staff_actor('content:restore');
  if actor=subject or actor=h.actor_id or actor=h.reporter_id then raise exception 'independent restoration reviewer required' using errcode='42501';end if;
  if h.released_at is not null then
    if h.released_by=actor and h.release_reason=review_reason and h.version=p_expected_version+1 then return jsonb_build_object('hold_id',h.id,'status','released','restored',h.restored,'reused',true);end if;
    raise exception 'content hold release changed' using errcode='PT409';
  end if;
  if h.version is distinct from p_expected_version or h.version>=2147483647 then raise exception 'represented content hold changed' using errcode='PT409';end if;
  update private.frontend_content_holds set version=version+1,released_at=clock_timestamp(),released_by=actor,release_reason=review_reason where id=h.id;
  if not exists(select 1 from private.frontend_content_holds x where x.post_id=target and x.released_at is null) then
    select * into state from private.frontend_post_hold_state where post_id=target for update;
    if post.status='paused' and post.status_reason='staff_hidden' and post.revision<2147483647 then
      if not state.content_changed and post.revision=state.hidden_revision and state.prior_status='live'
        and internal.current_verified_identity(subject) is not null and exists(select 1 from private.frontend_restorable_posts x where x.id=target) then
        update private.posts set status='live',status_reason=state.prior_reason,revision=revision+1 where id=target;
        perform internal.write_post_projection(target);did_restore:=true;
      else
        update private.posts set status_reason=case when state.prior_status='paused' then state.prior_reason else 'staff_review_cleared' end,revision=revision+1 where id=target;
      end if;
    end if;
    delete from private.frontend_post_hold_state where post_id=target;
  end if;
  update private.frontend_content_holds set restored=did_restore where id=h.id;
  perform internal.staff_actor('content:restore');
  return jsonb_build_object('hold_id',h.id,'status','released','restored',did_restore);
end$function$;
alter function internal.release_frontend_content_hold(uuid,integer,text) owner to postgres;
revoke all on function internal.release_frontend_content_hold(uuid,integer,text) from public;
grant execute on function internal.release_frontend_content_hold(uuid,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 62 then
    raise exception 'invalid media list' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.kind='event' then
    photo_limit:=10; video_limit:=1; -- Free event product allowance, not paid funding.
  else
    select e.max_photos,e.max_videos into photo_limit,video_limit
    from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
    where a.post_id=post.id and a.owner_id=actor and a.released_at is null
      and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.area is null or e.area=post.area)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
    if not found then
      -- Unfunded drafts can prepare the current public product allowance.
      -- Submission still checks the exact entitlement selected atomically.
      select max(v.max_photos),max(v.max_videos) into photo_limit,video_limit
      from private.plan_versions v where v.is_public and v.retired_at is null and (v.area is null or v.area=post.area);
      -- With no plan on sale (paid plans paused), drafts prepare the free first
      -- post's allowance (internal.grant_intro_trial: 10 photos, 1 video).
      if photo_limit is null or video_limit is null then
        photo_limit:=10; video_limit:=1;
      end if;
    end if;
  end if;
  if photo_limit is null or video_limit is null then
    raise exception 'no current media allowance available' using errcode='PT409';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
      where jsonb_typeof(i) <> 'object'
        or not (array(select jsonb_object_keys(i)) <@ array['object_id', 'purpose', 'position', 'focal_x', 'focal_y'])
        or i->>'purpose' not in ('cover', 'gallery', 'logo', 'video')
        or (i->>'object_id') !~ '^[0-9a-f-]{36}$' or (i->>'position') !~ '^[0-9]{1,2}$') then
    raise exception 'invalid media item' using errcode = '22023';
  end if;
  -- Lock before checking state; cleanup takes the same lock and rechecks links.
  perform m.id from private.media_objects m
    where m.owner_id=actor and m.id in (select (i->>'object_id')::uuid from jsonb_array_elements(p_items) i)
    order by m.id for update;
  -- Every object must be the owner's, finished, and the right kind for its purpose.
  if exists (select 1 from jsonb_array_elements(p_items) i
      left join private.media_objects m on m.id = (i->>'object_id')::uuid
      where m.id is null or m.owner_id <> actor or m.state <> 'ready'
        or (i->>'purpose' = 'video') <> (m.kind = 'video')) then
    raise exception 'media must be your own finished uploads of the right type' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'cover') > 1
    or (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'logo') > 1 then
    raise exception 'one cover and one logo at most' using errcode = '22023';
  end if;
  -- Per-post limits count distinct objects, so reuse costs nothing extra.
  if (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' <> 'video') > photo_limit
    or (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' = 'video') > video_limit then
    raise exception 'media exceed the current post allowance' using errcode = '22023';
  end if;
  delete from private.post_media where post_id = post.id;
  begin
    insert into private.post_media (post_id, object_id, purpose, position, focal_x, focal_y)
    select post.id, (i->>'object_id')::uuid, i->>'purpose', (i->>'position')::smallint,
      (i->>'focal_x')::numeric, (i->>'focal_y')::numeric
    from jsonb_array_elements(p_items) i;
  exception when unique_violation or check_violation then
    raise exception 'duplicate media position or invalid focal point' using errcode = '22023';
  end;
  update private.posts set revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$function$;
alter function internal.set_post_media(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.set_post_media(uuid,integer,jsonb) from public;
grant execute on function internal.set_post_media(uuid,integer,jsonb) to authenticated;

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
    ('payments',$q$select id,product_kind,target_post_id,amount_cents,currency,status,fulfillment_status,merchant_reference,provider,created_at,completed_at
      from private.payments where owner_id=$1 order by created_at,id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason
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

create or replace view private.public_eligible_posts with (security_invoker=true) as
 SELECT id
   FROM ( SELECT p.id
           FROM private.posts p
             JOIN private.current_account_access u ON u.id = p.owner_id
          WHERE p.status = 'live'::text AND p.published_at <= statement_timestamp() AND p.visible_until > statement_timestamp() AND (p.kind = 'event'::text AND (EXISTS ( SELECT 1
                   FROM private.event_details e_1
                  WHERE e_1.post_id = p.id AND e_1.ends_at > statement_timestamp())) OR p.kind <> 'event'::text AND (EXISTS ( SELECT 1
                   FROM private.post_activations a
                     JOIN private.entitlements e_1 ON e_1.id = a.entitlement_id
                     JOIN private.current_account_access funding_owner ON funding_owner.id = e_1.owner_id
                  WHERE a.post_id = p.id AND a.owner_id = p.owner_id AND a.released_at IS NULL AND internal.entitlement_usable(e_1.status, e_1.starts_at, e_1.ends_at) AND (e_1.area IS NULL OR e_1.area = p.area) AND (e_1.owner_id = p.owner_id OR (EXISTS ( SELECT 1
                           FROM private.entitlement_members m
                          WHERE m.entitlement_id = e_1.id AND m.member_id = p.owner_id))) AND (( SELECT count(DISTINCT pm.object_id) AS count
                           FROM private.post_media pm
                          WHERE pm.post_id = p.id AND pm.purpose <> 'video'::text)) <= e_1.max_photos AND (( SELECT count(DISTINCT pm.object_id) AS count
                           FROM private.post_media pm
                          WHERE pm.post_id = p.id AND pm.purpose = 'video'::text)) <= e_1.max_videos AND (e_1.source <> 'retail_paid'::text OR (EXISTS ( SELECT 1
                           FROM private.payments pay
                          WHERE pay.id = e_1.payment_id AND pay.owner_id = e_1.owner_id AND pay.status = 'complete'::text))))))) e
  WHERE NOT (EXISTS ( SELECT 1
           FROM private.frontend_content_holds h
          WHERE h.post_id = e.id AND h.released_at IS NULL));
alter view private.public_eligible_posts owner to postgres;
revoke all on private.public_eligible_posts from public;

create or replace view private.frontend_restorable_posts with (security_invoker=true) as
 SELECT p.id
   FROM private.posts p
     JOIN private.current_account_access u ON u.id = p.owner_id
  WHERE (p.status = ANY (ARRAY['live'::text, 'paused'::text])) AND p.published_at <= statement_timestamp() AND p.visible_until > statement_timestamp() AND (p.kind = 'event'::text AND (EXISTS ( SELECT 1
           FROM private.event_details e
          WHERE e.post_id = p.id AND e.ends_at > statement_timestamp())) OR p.kind <> 'event'::text AND (EXISTS ( SELECT 1
           FROM private.post_activations a
             JOIN private.entitlements e ON e.id = a.entitlement_id
             JOIN private.current_account_access funding_owner ON funding_owner.id = e.owner_id
          WHERE a.post_id = p.id AND a.owner_id = p.owner_id AND a.released_at IS NULL AND internal.entitlement_usable(e.status, e.starts_at, e.ends_at) AND (e.area IS NULL OR e.area = p.area) AND (e.owner_id = p.owner_id OR (EXISTS ( SELECT 1
                   FROM private.entitlement_members m
                  WHERE m.entitlement_id = e.id AND m.member_id = p.owner_id))) AND (( SELECT count(DISTINCT pm.object_id) AS count
                   FROM private.post_media pm
                  WHERE pm.post_id = p.id AND pm.purpose <> 'video'::text)) <= e.max_photos AND (( SELECT count(DISTINCT pm.object_id) AS count
                   FROM private.post_media pm
                  WHERE pm.post_id = p.id AND pm.purpose = 'video'::text)) <= e.max_videos AND (e.source <> 'retail_paid'::text OR (EXISTS ( SELECT 1
                   FROM private.payments pay
                  WHERE pay.id = e.payment_id AND pay.owner_id = e.owner_id AND pay.status = 'complete'::text))))));
alter view private.frontend_restorable_posts owner to postgres;
revoke all on private.frontend_restorable_posts from public;

drop trigger entitlements_slot_chain_revoked on private.entitlements;
drop function api.get_my_slots_v2();
drop function internal.get_my_slots_v2();
drop function api.run_slot_renewals(integer);
drop function internal.run_slot_renewals(integer);
drop function api.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean);
drop function internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean);
drop function internal.issue_slot_line_entitlements(uuid);
drop function internal.slot_grant_revoked();
drop function internal.refresh_slot_chain_documents(uuid);
drop function internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone);
drop function internal.individual_renewals_allowed(text,uuid,uuid,uuid[]);
drop function internal.slot_lines_renewing(uuid);
drop function internal.slot_lines_adding(uuid);
drop function internal.individual_slots_extended(text,uuid,uuid,uuid[],timestamp with time zone);
drop function internal.slot_renewal_due(uuid,uuid);
drop function internal.slot_chain_end(uuid);
drop function internal.slot_chain_held(uuid);
drop function internal.slot_chain_last_end(uuid);
drop function internal.slot_renewal_window();
drop function internal.individual_slot_owners(text,uuid);
drop index private.entitlements_renews_active_idx;
drop index private.entitlements_renews_entitlement_idx;
drop index private.entitlements_slot_idx;
drop index private.payment_lines_renews_entitlement_idx;
alter table private.entitlements drop constraint entitlements_renewal_link;
alter table private.entitlements drop constraint entitlements_renews_entitlement_id_fkey;
alter table private.entitlements drop constraint entitlements_slot_id_fkey;
alter table private.payment_lines drop constraint payment_lines_renews_entitlement_id_fkey;
alter table private.entitlements drop column renews_entitlement_id;
alter table private.entitlements drop column slot_id;
alter table private.payment_lines drop column renews_entitlement_id;
alter table private.post_activations drop column continued;
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned']));

commit;
