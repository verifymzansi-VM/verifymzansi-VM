-- Hosted billing transport. The quote/settlement transactions remain the
-- canonical start_checkout/apply_provider_event implementation. No table is
-- exposed; browser callers can only read their own fixed DTOs.
create table private.invoice_merchant_config (
  singleton boolean primary key default true check(singleton),
  registration_status text not null default 'undecided' check(registration_status in ('undecided','not_registered','registered')),
  vat_number text,
  vat_rate_bps integer not null default 0 check(vat_rate_bps between 0 and 10000),
  confirmed_at timestamptz,
  check ((registration_status='registered' and length(btrim(coalesce(vat_number,''))) between 5 and 30 and vat_rate_bps>0)
    or (registration_status<>'registered' and vat_number is null and vat_rate_bps=0)),
  check ((registration_status='undecided')=(confirmed_at is null))
);
alter table private.invoice_merchant_config enable row level security;
revoke all on private.invoice_merchant_config from public,anon,authenticated,service_role;
-- Operator confirmed on 25 October 2026 that VerifyMzansi is not VAT registered.
insert into private.invoice_merchant_config(singleton,registration_status,confirmed_at)
values(true,'not_registered',statement_timestamp());
alter table private.invoices add column merchant_registration_status text;
alter table private.invoices add column merchant_vat_number text;
alter table private.invoices add column vat_rate_bps integer;

create function internal.payment_invoice_config()
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare cfg private.invoice_merchant_config;
begin
  select * into cfg from private.invoice_merchant_config where singleton;
  if not found or cfg.registration_status='undecided' or cfg.confirmed_at is null then
    raise exception 'merchant invoice configuration requires confirmation' using errcode='PT503'; end if;
  return jsonb_build_object('registration_status',cfg.registration_status,'vat_number',cfg.vat_number,'vat_rate_bps',cfg.vat_rate_bps);
end;
$$;
revoke all on function internal.payment_invoice_config() from public,anon,authenticated,service_role;
create function internal.payment_invoice_snapshot()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('merchant_invoice',internal.payment_invoice_config());
  return new;
end;
$$;
revoke all on function internal.payment_invoice_snapshot() from public,anon,authenticated,service_role;
create trigger payments_invoice_snapshot before insert on private.payments for each row execute function internal.payment_invoice_snapshot();
create function internal.payment_invoice_vat(p private.payments)
returns bigint language plpgsql stable security invoker set search_path=pg_catalog as $$
declare cfg jsonb:=coalesce(p.snapshot->'merchant_invoice',internal.payment_invoice_config()); rate integer;
begin
  rate:=(cfg->>'vat_rate_bps')::integer;
  if rate is null or rate not between 0 and 10000 or cfg->>'registration_status' not in ('not_registered','registered') then
    raise exception 'invalid invoice configuration' using errcode='PT503'; end if;
  return round(p.amount_cents::numeric*rate/(10000+rate))::bigint;
end;
$$;
revoke all on function internal.payment_invoice_vat(private.payments) from public,anon,authenticated,service_role;
create function internal.invoice_merchant_snapshot()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare cfg jsonb;
begin
  select coalesce(p.snapshot->'merchant_invoice',internal.payment_invoice_config()) into cfg from private.payments p where p.id=new.payment_id;
  new.merchant_registration_status:=cfg->>'registration_status';
  new.merchant_vat_number:=cfg->>'vat_number';
  new.vat_rate_bps:=(cfg->>'vat_rate_bps')::integer;
  return new;
end;
$$;
revoke all on function internal.invoice_merchant_snapshot() from public,anon,authenticated,service_role;
create trigger invoices_merchant_snapshot before insert on private.invoices for each row execute function internal.invoice_merchant_snapshot();
alter table private.payments add column checkout_url text;
alter table private.payments add column checkout_expires_at timestamptz;
alter table private.payments add column checkout_claim_token uuid;
alter table private.payments add column checkout_claim_until timestamptz;
alter table private.payments add column provider_idempotency_key uuid not null default pg_catalog.gen_random_uuid();
alter table private.payments add column provider_correlation_id uuid not null default pg_catalog.gen_random_uuid();
alter table private.payments add column reconciliation_checked_at timestamptz;
alter table private.payments add constraint payments_checkout_url_https check
  (checkout_url is null or (length(checkout_url) between 10 and 4096 and checkout_url ~ '^https://'));

create function internal.billing_payment_dto(p private.payments)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object('id',p.id,'owner_id',p.owner_id,'product_kind',p.product_kind,
    'product_id',coalesce(p.plan_version_id,p.addon_version_id),'target_post_id',p.target_post_id,
    'amount_cents',p.amount_cents::text,'currency',p.currency,'status',p.status,
    'fulfillment_status',p.fulfillment_status,'merchant_reference',p.merchant_reference,
    'provider_request_id',p.provider_request_id,'provider_transaction_id',p.provider_transaction_id,
    'checkout_url',p.checkout_url,'checkout_expires_at',p.checkout_expires_at,
    'created_at',p.created_at,'label',coalesce(p.snapshot->>'label',initcap(p.snapshot->>'addon')||' add-on'));
$$;
revoke all on function internal.billing_payment_dto(private.payments) from public,anon,authenticated,service_role;

create function internal.get_my_payment(p_payment_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select internal.billing_payment_dto(p) into result from private.payments p
    where p.id=p_payment_id and p.owner_id=actor;
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_my_payment(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_payment(uuid) to authenticated;
create function api.get_my_payment(p_payment_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_my_payment(p_payment_id);
$$;
revoke all on function api.get_my_payment(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_my_payment(uuid) to authenticated;

create function internal.get_my_billing()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'payments',coalesce((select jsonb_agg(internal.billing_payment_dto(p) order by p.created_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p),'[]'),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'payment_id',p.id,
      'invoice_number',i.invoice_number,'total_cents',i.total_cents::text,
      'amount_ex_vat_cents',i.amount_ex_vat_cents::text,'vat_cents',i.vat_cents::text,
      'description',i.description,'issued_at',i.issued_at,'payment_status',p.status) order by i.issued_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p
      join private.invoices i on i.payment_id=p.id),'[]'),
    'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'area',e.area,
      'source',e.source,'status',e.status,'slot_capacity',e.slot_capacity,
      'max_photos',e.max_photos,'max_videos',e.max_videos,'addon_capabilities',to_jsonb(e.addon_capabilities),
      'starts_at',e.starts_at,'ends_at',e.ends_at,'used',(select count(*) from private.post_activations a
        where a.entitlement_id=e.id and a.released_at is null)))
      from private.entitlements e where (e.owner_id=actor or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=actor)) and e.status='active'
      and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)),'[]')) into result;
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_my_billing() from public,anon,authenticated,service_role;
grant execute on function internal.get_my_billing() to authenticated;
create function api.get_my_billing()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_my_billing();
$$;
revoke all on function api.get_my_billing() from public,anon,authenticated,service_role;
grant execute on function api.get_my_billing() to authenticated;

create function internal.get_checkout_payment(p_payment_id uuid,p_merchant_reference text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if (p_payment_id is null)=(p_merchant_reference is null) then
    raise exception 'one payment selector required' using errcode='22023'; end if;
  select internal.billing_payment_dto(p) into result from private.payments p
    where p.id=p_payment_id or p.merchant_reference=p_merchant_reference;
  return result;
end;
$$;
revoke all on function internal.get_checkout_payment(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.get_checkout_payment(uuid,text) to service_role;
create function api.get_checkout_payment(p_payment_id uuid default null,p_merchant_reference text default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_checkout_payment(p_payment_id,p_merchant_reference);
$$;
revoke all on function api.get_checkout_payment(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.get_checkout_payment(uuid,text) to service_role;

create function internal.claim_checkout_request(p_payment_id uuid,p_owner_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare pay private.payments;
begin
  perform internal.payment_invoice_config();
  select * into pay from private.payments where id=p_payment_id and owner_id=p_owner_id for update;
  if not found or pay.status<>'pending' or not exists(select 1 from private.current_account_access a where a.id=p_owner_id) then
    raise exception 'pending checkout unavailable' using errcode='PT409'; end if;
  if pay.checkout_url is null and pay.checkout_claim_until>clock_timestamp() then
    raise exception 'checkout is being created' using errcode='PT409'; end if;
  if pay.checkout_url is null then
    update private.payments set checkout_claim_token=pg_catalog.gen_random_uuid(),
      checkout_claim_until=clock_timestamp()+interval '2 minutes',
      checkout_expires_at=coalesce(checkout_expires_at,clock_timestamp()+interval '30 minutes')
      where id=pay.id returning * into pay;
  end if;
  return internal.billing_payment_dto(pay)||jsonb_build_object('claim_token',pay.checkout_claim_token,
    'idempotency_key',pay.provider_idempotency_key,'correlation_id',pay.provider_correlation_id);
end;
$$;
revoke all on function internal.claim_checkout_request(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.claim_checkout_request(uuid,uuid) to service_role;
create function api.claim_checkout_request(p_payment_id uuid,p_owner_id uuid)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$
  select internal.claim_checkout_request(p_payment_id,p_owner_id);
$$;
revoke all on function api.claim_checkout_request(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function api.claim_checkout_request(uuid,uuid) to service_role;

create function internal.complete_checkout_request(p_payment_id uuid,p_owner_id uuid,p_claim_token uuid,
  p_request_id text,p_checkout_url text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
declare pay private.payments;
begin
  if length(coalesce(p_request_id,'')) not between 1 and 100 or length(coalesce(p_checkout_url,'')) not between 10 and 4096
    or p_checkout_url !~ '^https://' then raise exception 'invalid checkout response' using errcode='22023'; end if;
  select * into pay from private.payments where id=p_payment_id and owner_id=p_owner_id for update;
  if not found or pay.status<>'pending' then raise exception 'pending checkout unavailable' using errcode='PT409'; end if;
  if pay.provider_request_id=p_request_id and pay.checkout_url=p_checkout_url then return true; end if;
  if pay.checkout_claim_token is distinct from p_claim_token or p_claim_token is null
    or pay.provider_request_id is not null then raise exception 'checkout claim superseded' using errcode='PT409'; end if;
  update private.payments set provider_request_id=p_request_id,checkout_url=p_checkout_url,
    checkout_claim_until=null where id=pay.id;
  return true;
end;
$$;
revoke all on function internal.complete_checkout_request(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.complete_checkout_request(uuid,uuid,uuid,text,text) to service_role;
create function api.complete_checkout_request(p_payment_id uuid,p_owner_id uuid,p_claim_token uuid,
  p_request_id text,p_checkout_url text)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select internal.complete_checkout_request(p_payment_id,p_owner_id,p_claim_token,p_request_id,p_checkout_url);
$$;
revoke all on function api.complete_checkout_request(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.complete_checkout_request(uuid,uuid,uuid,text,text) to service_role;

create function internal.claim_payment_reconciliation(p_payment_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare pay private.payments;
begin
  update private.payments set reconciliation_checked_at=clock_timestamp()
  where id=p_payment_id and provider_request_id is not null and status in ('pending','failed','expired','cancelled')
    and (reconciliation_checked_at is null or reconciliation_checked_at<clock_timestamp()-interval '15 seconds')
  returning * into pay;
  if not found then return null; end if;
  return internal.billing_payment_dto(pay);
end;
$$;
revoke all on function internal.claim_payment_reconciliation(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.claim_payment_reconciliation(uuid) to service_role;
create function api.claim_payment_reconciliation(p_payment_id uuid)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$
  select internal.claim_payment_reconciliation(p_payment_id);
$$;
revoke all on function api.claim_payment_reconciliation(uuid) from public,anon,authenticated,service_role;
grant execute on function api.claim_payment_reconciliation(uuid) to service_role;

create function internal.list_reconcilable_payments(p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if p_limit not between 1 and 50 then raise exception 'invalid reconciliation limit' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(internal.billing_payment_dto(p)) from
    (select * from private.payments where status in ('pending','failed','expired','cancelled')
      and provider_request_id is not null and created_at>statement_timestamp()-interval '14 days'
      order by reconciliation_checked_at nulls first,created_at limit p_limit) p),'[]');
end;
$$;
revoke all on function internal.list_reconcilable_payments(integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_reconcilable_payments(integer) to service_role;
create function api.list_reconcilable_payments(p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.list_reconcilable_payments(p_limit);
$$;
revoke all on function api.list_reconcilable_payments(integer) from public,anon,authenticated,service_role;
grant execute on function api.list_reconcilable_payments(integer) to service_role;

create function internal.finish_unpaid_checkout(p_payment_id uuid,p_status text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
  if p_status not in ('cancelled','expired') then raise exception 'invalid unpaid status' using errcode='22023'; end if;
  update private.payments set status=p_status,status_changed_at=clock_timestamp() where id=p_payment_id and status='pending';
  return found;
end;
$$;
revoke all on function internal.finish_unpaid_checkout(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.finish_unpaid_checkout(uuid,text) to service_role;
create function api.finish_unpaid_checkout(p_payment_id uuid,p_status text)
returns boolean language sql volatile security invoker set search_path=pg_catalog as $$
  select internal.finish_unpaid_checkout(p_payment_id,p_status);
$$;
revoke all on function api.finish_unpaid_checkout(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.finish_unpaid_checkout(uuid,text) to service_role;

create function internal.manage_plan_member(p_entitlement_id uuid,p_action text,p_email text)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
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
$$;
revoke all on function internal.manage_plan_member(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.manage_plan_member(uuid,text,text) to authenticated;
create function api.manage_plan_member(p_entitlement_id uuid,p_action text,p_email text)
returns jsonb language sql volatile security invoker set search_path=pg_catalog as $$
  select internal.manage_plan_member(p_entitlement_id,p_action,p_email);
$$;
revoke all on function api.manage_plan_member(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function api.manage_plan_member(uuid,text,text) to authenticated;

-- Preserve the complete atomic settlement transaction; derive only its tax
-- breakdown from the merchant configuration frozen with the payment quote.
create or replace function internal.apply_provider_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
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
$$;
