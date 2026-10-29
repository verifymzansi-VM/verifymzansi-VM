-- BF-07 canonical entitlement and provider transaction candidate. One model:
-- immutable plan/add-on versions, priced payment snapshots, a provider event
-- inbox, entitlements with explicit funding sources, capacity-locked post
-- activations and add-on time windows. Replaces slot_entitlements, the
-- legacy area-entitlement mirror, mutable boost/featured/urgent columns and
-- free-post counters. Organisations, sponsorship lifecycle, staff AAL2 and
-- invoices' legal numbering remain BF-08/BF-16/BF-17 work.

create table private.plan_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  plan_code text not null check (plan_code ~ '^[a-z][a-z0-9_]{0,59}$'),
  version integer not null check (version > 0),
  area text check (area in ('market', 'business', 'tourism_events')),
  label text not null check (length(label) between 1 and 120),
  price_cents bigint not null check (price_cents between 100 and 100000000),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  duration_days integer not null check (duration_days between 1 and 366),
  slot_capacity integer not null check (slot_capacity between 1 and 1000),
  activations_per_period integer check (activations_per_period between 1 and 10000),
  activation_period_days integer not null default 30 check (activation_period_days between 1 and 366),
  max_photos integer not null check (max_photos between 1 and 50),
  max_videos integer not null check (max_videos between 0 and 10),
  -- Closed, default-denied purchase rights; catalogue immutability also freezes these.
  addon_capabilities text[] not null default '{}' check (case
    when coalesce(array_ndims(addon_capabilities),1)<>1 then false else
    addon_capabilities <@ array['boost','featured','urgent']::text[]
    and array_position(addon_capabilities,null) is null
    and cardinality(addon_capabilities)=(('boost'=any(addon_capabilities))::integer
      +('featured'=any(addon_capabilities))::integer+('urgent'=any(addon_capabilities))::integer) end),
  is_public boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  retired_at timestamptz,
  unique (plan_code, version)
);

create table private.addon_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null check (kind in ('boost', 'featured', 'urgent')),
  version integer not null check (version > 0),
  days integer not null check (days between 1 and 90),
  price_cents bigint not null check (price_cents between 100 and 10000000),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  created_at timestamptz not null default statement_timestamp(),
  retired_at timestamptz,
  unique (kind, days, version)
);

-- Catalogue rows are immutable once published; a price change is a new version.
create function internal.catalogue_version_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'catalogue versions are retained' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at')
    or (old.retired_at is not null and new.retired_at is distinct from old.retired_at) then
    raise exception 'catalogue versions are immutable; publish a new version' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.catalogue_version_guard() from public, anon, authenticated, service_role;
create trigger plan_versions_immutable before update or delete on private.plan_versions
  for each row execute function internal.catalogue_version_guard();
create trigger addon_versions_immutable before update or delete on private.addon_versions
  for each row execute function internal.catalogue_version_guard();

create table private.payments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  product_kind text not null check (product_kind in ('plan', 'addon')),
  plan_version_id uuid references private.plan_versions (id),
  addon_version_id uuid references private.addon_versions (id),
  -- Historical identity, intentionally not a live-post FK: deletion cannot
  -- remove the priced quote or prevent recognition of a late settlement.
  target_post_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency = 'ZAR'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'complete', 'failed', 'cancelled', 'expired', 'refunded', 'chargeback')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'fulfilled', 'needs_reconciliation', 'reversed')),
  merchant_reference text not null unique default replace(pg_catalog.gen_random_uuid()::text, '-', ''),
  provider text not null default 'ozow' check (provider = 'ozow'),
  provider_request_id text unique check (length(provider_request_id) between 1 and 100),
  provider_transaction_id text unique check (length(provider_transaction_id) between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  status_changed_at timestamptz not null default statement_timestamp(),
  check ((product_kind = 'plan' and plan_version_id is not null and addon_version_id is null and target_post_id is null)
    or (product_kind = 'addon' and addon_version_id is not null and plan_version_id is null and target_post_id is not null)),
  check ((status = 'complete') = (completed_at is not null and provider_transaction_id is not null)
    or status in ('refunded', 'chargeback')),
  check (status <> 'complete' or fulfillment_status <> 'unfulfilled')
);
create function internal.payment_quote_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id,new.owner_id,new.product_kind,new.plan_version_id,new.addon_version_id,
      new.target_post_id,new.amount_cents,new.currency,new.snapshot,new.merchant_reference,new.provider)
    is distinct from (old.id,old.owner_id,old.product_kind,old.plan_version_id,old.addon_version_id,
      old.target_post_id,old.amount_cents,old.currency,old.snapshot,old.merchant_reference,old.provider) then
    raise exception 'payment quote and historical target are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.payment_quote_guard() from public,anon,authenticated,service_role;
create trigger payments_quote_immutable before update on private.payments
  for each row execute function internal.payment_quote_guard();
-- One open checkout per member and product; retries reuse it.
create unique index payments_one_pending_idx on private.payments
  (owner_id, coalesce(plan_version_id, addon_version_id), coalesce(target_post_id, '00000000-0000-0000-0000-000000000000'))
  where status = 'pending';

-- Inbox: every provider notification is recorded once, before it has any effect.
create table private.provider_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  provider text not null check (provider = 'ozow'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  merchant_reference text not null,
  provider_request_id text not null,
  provider_transaction_id text,
  reported_status text not null check (reported_status in ('complete', 'cancelled', 'error', 'abandoned', 'pending')),
  amount_cents bigint not null,
  currency text not null,
  payment_id uuid references private.payments (id) on delete restrict,
  outcome text not null,
  received_at timestamptz not null default statement_timestamp(),
  unique (provider, payload_sha256)
);

create table private.entitlements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  source text not null check (source in ('retail_paid', 'intro_trial', 'sponsorship', 'contract', 'staff_grant')),
  area text check (area in ('market', 'business', 'tourism_events')),
  payment_id uuid unique references private.payments (id) on delete restrict,
  sponsorship_id uuid,
  contract_id uuid,
  granted_by uuid references auth.users (id) on delete restrict,
  slot_capacity integer not null check (slot_capacity between 1 and 1000),
  activations_per_period integer check (activations_per_period between 1 and 10000),
  activation_period_days integer not null default 30 check (activation_period_days between 1 and 366),
  max_photos integer not null check (max_photos between 1 and 50),
  max_videos integer not null check (max_videos between 0 and 10),
  starts_at timestamptz not null,
  addon_capabilities text[] not null default '{}' check (case
    when coalesce(array_ndims(addon_capabilities),1)<>1 then false else
    addon_capabilities <@ array['boost','featured','urgent']::text[]
    and array_position(addon_capabilities,null) is null
    and cardinality(addon_capabilities)=(('boost'=any(addon_capabilities))::integer
      +('featured'=any(addon_capabilities))::integer+('urgent'=any(addon_capabilities))::integer) end),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'pending_verification', 'revoked')),
  revoked_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (ends_at > starts_at),
  check ((source = 'retail_paid') = (payment_id is not null)),
  check (source <> 'sponsorship' or sponsorship_id is not null),
  check (source <> 'contract' or contract_id is not null),
  check (source <> 'staff_grant' or granted_by is not null),
  check ((status = 'revoked') = (revoked_reason is not null)),
  check (source<>'intro_trial' or addon_capabilities='{}'::text[])
);
create index entitlements_owner_usable_idx on private.entitlements (owner_id, ends_at) where status = 'active';

create function internal.entitlement_capability_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.addon_capabilities is distinct from old.addon_capabilities then
    raise exception 'issued capabilities are immutable; issue a reviewed replacement grant' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.entitlement_capability_guard() from public,anon,authenticated,service_role;
create trigger entitlement_capabilities_immutable before update of addon_capabilities on private.entitlements
  for each row execute function internal.entitlement_capability_guard();

create table private.entitlement_members (
  entitlement_id uuid not null references private.entitlements (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  added_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (entitlement_id, member_id)
);
create index entitlement_members_member_idx on private.entitlement_members(member_id,entitlement_id);

-- Identity-bound trial claims: one introductory trial per verified identity.
-- DEC-27: kept while the account exists. When the account is deleted the
-- fingerprint is detached from the account and trial and kept for 3 years, so
-- the same identity cannot claim another free trial, then purged.
create table private.trial_identities (
  identity_hmac text primary key check (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  owner_id uuid references auth.users (id) on delete restrict,
  entitlement_id uuid unique references private.entitlements (id) on delete restrict,
  claimed_at timestamptz not null default statement_timestamp(),
  detached_at timestamptz,
  retain_until timestamptz,
  check ((owner_id is null) = (detached_at is not null)),
  check ((owner_id is null) = (entitlement_id is null)),
  check ((detached_at is null) = (retain_until is null)),
  check (retain_until is null or retain_until = detached_at + interval '3 years')
);
create index trial_identities_expiry_idx on private.trial_identities (retain_until) where retain_until is not null;

-- Activation history outlives its post: activations_per_period counts these
-- rows, so deleting a post must not reset the re-post allowance (DEC-28).
create table private.post_activations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid references private.posts (id) on delete set null,
  entitlement_id uuid not null references private.entitlements (id) on delete restrict,
  owner_id uuid not null references auth.users (id) on delete restrict,
  activated_at timestamptz not null default statement_timestamp(),
  released_at timestamptz,
  release_reason text check (release_reason in ('owner', 'sold', 'expired', 'entitlement_ended', 'payment_reversed', 'moderation', 'deleted')),
  check ((released_at is null) = (release_reason is null)),
  check (post_id is not null or released_at is not null)
);
create unique index post_activations_one_active_idx on private.post_activations (post_id) where released_at is null;
create index post_activations_entitlement_idx on private.post_activations (entitlement_id, activated_at);

-- Content-bound trial provenance survives pause/release and another plan purchase.
create table private.post_trial_claims (
  post_id uuid primary key references private.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  trial_entitlement_id uuid not null references private.entitlements(id) on delete restrict,
  claimed_at timestamptz not null default clock_timestamp(),
  converted_at timestamptz,
  converted_by_activation_id uuid references private.post_activations(id) on delete restrict,
  check ((converted_at is null)=(converted_by_activation_id is null)),
  check (converted_at is null or converted_at>=claimed_at)
);
alter table private.post_trial_claims enable row level security;
revoke all on private.post_trial_claims from public,anon,authenticated,service_role;
create index post_trial_claims_owner_idx on private.post_trial_claims(owner_id,post_id);

create function internal.entitlement_for_post_eligible(p_ent uuid,p_post uuid,p_owner uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog as $$
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
$$;
revoke all on function internal.entitlement_for_post_eligible(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function internal.track_post_trial_funding()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare ent private.entitlements;
begin
  select e.* into ent from private.entitlements e where e.id=new.entitlement_id;
  if new.released_at is not null or not internal.entitlement_for_post_eligible(ent.id,new.post_id,new.owner_id) then
    return new; -- invalid/historical inserts cannot create a conversion proof
  end if;
  if ent.source='intro_trial' then
    insert into private.post_trial_claims(post_id,owner_id,trial_entitlement_id)
    values(new.post_id,new.owner_id,ent.id) on conflict(post_id) do nothing;
  elsif ent.source='retail_paid' and exists(select 1 from private.payments p
      where p.id=ent.payment_id and p.owner_id=ent.owner_id and p.status='complete') then
    update private.post_trial_claims set converted_at=clock_timestamp(),converted_by_activation_id=new.id
    where post_id=new.post_id and owner_id=new.owner_id and converted_at is null;
  end if;
  return new;
end;
$$;
revoke all on function internal.track_post_trial_funding() from public,anon,authenticated,service_role;
create trigger post_activation_trial_provenance after insert on private.post_activations
  for each row execute function internal.track_post_trial_funding();

-- Deleting a post (owner, lifecycle sweep or account deletion) first releases
-- its slot; the foreign key then keeps the history row with a null post.
create function internal.release_activation_on_post_delete()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update private.post_activations set released_at = statement_timestamp(), release_reason = 'deleted'
  where post_id = old.id and released_at is null;
  update private.post_addon_windows set revoked_at = clock_timestamp()
  where post_id = old.id and revoked_at is null;
  return old;
end;
$$;
revoke all on function internal.release_activation_on_post_delete() from public, anon, authenticated, service_role;
create trigger posts_release_activation before delete on private.posts
  for each row execute function internal.release_activation_on_post_delete();

-- Paid visibility is a time window, never a stored boolean that can go stale.
create table private.post_addon_windows (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  post_id uuid not null, -- immutable historical target; retained after deletion
  kind text not null check (kind in ('boost', 'featured', 'urgent')),
  payment_id uuid not null unique references private.payments (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  revoked_at timestamptz
);
create index post_addon_windows_live_idx on private.post_addon_windows (post_id, kind, ends_at) where revoked_at is null;

create table private.invoices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  payment_id uuid not null unique references private.payments (id) on delete restrict,
  invoice_number text not null unique,
  amount_ex_vat_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  description text not null,
  issued_at timestamptz not null default statement_timestamp(),
  check (amount_ex_vat_cents + vat_cents = total_cents)
);

-- Durable after-commit effects (email, notifications); workers claim with fencing.
create table private.outbox_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  kind text not null check (kind in ('payment_completed', 'payment_reversed', 'payment_reconciliation_required', 'trial_started',
    'post_expired', 'post_expiry_reminder', 'draft_deletion_warning', 'post_deleted', 'verification_phone_confirmed', 'identity_accepted')),
  subject_id uuid not null,
  owner_id uuid not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz
);

alter table private.plan_versions enable row level security;
alter table private.addon_versions enable row level security;
alter table private.payments enable row level security;
alter table private.provider_events enable row level security;
alter table private.entitlements enable row level security;
alter table private.entitlement_members enable row level security;
alter table private.trial_identities enable row level security;
alter table private.post_activations enable row level security;
alter table private.post_addon_windows enable row level security;
alter table private.invoices enable row level security;
alter table private.outbox_events enable row level security;
revoke all on private.plan_versions, private.addon_versions, private.payments, private.provider_events,
  private.entitlements, private.entitlement_members, private.trial_identities, private.post_activations,
  private.post_addon_windows, private.invoices, private.outbox_events
  from public, anon, authenticated, service_role;

-- Usable means active, inside its window, and evaluated at read time.
create function internal.entitlement_usable(p_status text, p_starts timestamptz, p_ends timestamptz)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select p_status = 'active' and p_starts <= statement_timestamp() and p_ends > statement_timestamp();
$$;
revoke all on function internal.entitlement_usable(text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function internal.entitlement_usable(text, timestamptz, timestamptz) to authenticated, service_role;

-- Public catalogue: current, non-retired public versions only.
create function internal.billing_catalogue()
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.plan_code, 'label', p.label,
        'area', p.area, 'price_cents', p.price_cents::text, 'currency', p.currency, 'duration_days', p.duration_days,
        'activation_period_days', p.activation_period_days, 'activations_per_period', p.activations_per_period,
        'slot_capacity', p.slot_capacity, 'max_photos', p.max_photos, 'max_videos', p.max_videos,
        'addon_capabilities',to_jsonb(p.addon_capabilities))
        order by p.price_cents, p.plan_code)
      from private.plan_versions p where p.is_public and p.retired_at is null), '[]'),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'days', a.days,
        'price_cents', a.price_cents::text, 'currency', a.currency) order by a.kind, a.days)
      from private.addon_versions a where a.retired_at is null), '[]'));
$$;
revoke all on function internal.billing_catalogue() from public, anon, authenticated, service_role;
grant execute on function internal.billing_catalogue() to anon, authenticated;
create function api.billing_catalogue()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.billing_catalogue();
$$;
revoke all on function api.billing_catalogue() from public, anon, authenticated, service_role;
grant execute on function api.billing_catalogue() to anon, authenticated;

-- Checkout: the member names only a product (and target post for add-ons). Price,
-- currency, term and capacity come from the stored version and are snapshotted.
create function internal.addon_purchase_entitlement(p_owner uuid,p_post uuid,p_addon text)
returns uuid language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare target_area text; candidate uuid;
begin
  if p_owner is null or p_post is null or p_addon is null or p_addon not in('boost','featured','urgent') then return null; end if;
  select p.area into target_area from private.posts p where p.id=p_post and p.owner_id=p_owner;
  if not found then return null; end if;
  -- Owner/member indexes bound discovery. NOWAIT avoids mixed activation lock-order waits.
  for candidate in select e.id from private.entitlements e
    where e.id in(select owned.id from private.entitlements owned where owned.owner_id=p_owner and owned.status='active'
      union select m.entitlement_id from private.entitlement_members m where m.member_id=p_owner)
      and e.status='active' and (e.area is null or e.area=target_area)
      and p_addon=any(e.addon_capabilities) order by e.id
  loop
    begin
      perform e.id from private.entitlements e where e.id=candidate for update nowait;
    exception when lock_not_available then
      raise exception 'purchase capability is busy; retry the same operation' using errcode='PT409';
    end;
    -- Revalidate after preceding waits; busy entitlement rows require explicit retry.
    if exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
      where e.id=candidate and p.owner_id=p_owner
        and internal.entitlement_for_post_eligible(e.id,p.id,p_owner)
        and p_addon=any(e.addon_capabilities)
        and not exists(select 1 from private.post_trial_claims c where c.post_id=p.id and c.converted_at is null)
        and (p_addon='urgent' or p.kind='event')
        and p.status='live' and p.published_at<=clock_timestamp() and p.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts visible where visible.id=p.id)
        and exists(select 1 from internal.post_funding(p.id) f where f.funded_until>clock_timestamp()))
    then return candidate; end if;
  end loop;
  return null;
end;
$$;
revoke all on function internal.addon_purchase_entitlement(uuid,uuid,text) from public,anon,authenticated,service_role;

create function internal.start_checkout(p_product_id uuid, p_target_post uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
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
$$;
revoke all on function internal.start_checkout(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.start_checkout(uuid, uuid) to authenticated;
create function api.start_checkout(p_product_id uuid, p_target_post uuid default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.start_checkout(p_product_id, p_target_post);
$$;
revoke all on function api.start_checkout(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function api.start_checkout(uuid, uuid) to authenticated;

-- Server-only: record the provider's request id after the checkout call succeeds.
create function internal.attach_provider_request(p_payment_id uuid, p_request_id text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  update private.payments p set provider_request_id = p_request_id
  where p.id = p_payment_id and p.status = 'pending'
    and (p.provider_request_id is null or p.provider_request_id = p_request_id);
  if not found then raise exception 'payment not pending or request id differs' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function internal.attach_provider_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.attach_provider_request(uuid, text) to service_role;
create function api.attach_provider_request(p_payment_id uuid, p_request_id text)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.attach_provider_request(p_payment_id, p_request_id);
$$;
revoke all on function api.attach_provider_request(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.attach_provider_request(uuid, text) to service_role;

-- Server-only: apply a verified provider notification (the Worker checks the
-- provider hash before calling). Idempotent, ordered by payment row lock, and
-- every effect (status, entitlement or window, invoice, outbox) is one commit.
create function internal.apply_provider_event(p_event jsonb)
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
    vat := round(pay.amount_cents::numeric * 15 / 115);
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
revoke all on function internal.apply_provider_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.apply_provider_event(jsonb) to service_role;
create function api.apply_provider_event(p_event jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.apply_provider_event(p_event);
$$;
revoke all on function api.apply_provider_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.apply_provider_event(jsonb) to service_role;

-- Owner activation. Usable entitlements are locked in a fixed order (soonest end
-- first) so concurrent activations serialise and capacity can never be exceeded.
create function internal.activate_post(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
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
$$;
revoke all on function internal.activate_post(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.activate_post(uuid) to authenticated;
create function api.activate_post(p_post_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.activate_post(p_post_id);
$$;
revoke all on function api.activate_post(uuid) from public, anon, authenticated, service_role;
grant execute on function api.activate_post(uuid) to authenticated;

create function internal.release_post(p_post_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; released boolean;
begin
  if p_reason is null or p_reason not in ('owner', 'sold') then raise exception 'invalid release reason' using errcode = '22023'; end if;
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.status in ('live','pending_moderation') then
    raise exception 'use the revision-fenced post lifecycle to release published funding' using errcode='22023';
  end if;
  update private.post_activations a set released_at = statement_timestamp(), release_reason = p_reason
  where a.post_id = p_post_id and a.owner_id = actor and a.released_at is null;
  released:=found;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return released;
end;
$$;
revoke all on function internal.release_post(uuid, text) from public, anon, authenticated, service_role;
grant execute on function internal.release_post(uuid, text) to authenticated;
create function api.release_post(p_post_id uuid, p_reason text default 'owner')
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.release_post(p_post_id, p_reason);
$$;
revoke all on function api.release_post(uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.release_post(uuid, text) to authenticated;

create function internal.my_posting_capacity()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  -- The disposable prototype installs current account authority next. The clean
  -- baseline must create authority relations before dependent API functions.
  return (
  with actor as (select internal.price_draft_actor() as id),
  usable as (
    select e.* from private.entitlements e, actor
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.owner_id = actor.id or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor.id))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
  )
  select jsonb_build_object(
    'capacity', coalesce(sum(u.slot_capacity), 0),
    'active', (select count(*) from private.post_activations a where a.released_at is null
      and a.entitlement_id in (select id from usable)),
    'ends_at', max(u.ends_at),
    'sources', coalesce(jsonb_agg(distinct u.source) filter (where u.source is not null), '[]'))
  from usable u);
end;
$$;
revoke all on function internal.my_posting_capacity() from public, anon, authenticated, service_role;
grant execute on function internal.my_posting_capacity() to authenticated;
create function api.my_posting_capacity()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.my_posting_capacity();
$$;
revoke all on function api.my_posting_capacity() from public, anon, authenticated, service_role;
grant execute on function api.my_posting_capacity() to authenticated;

-- Server-only introductory trial grant; the HMAC unique key enforces one per identity.
create function internal.grant_intro_trial(p_owner uuid, p_identity_hmac text, p_days integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare ent uuid;
begin
  if p_days not in (7, 30) then raise exception 'invalid trial length' using errcode = '22023'; end if;
  if p_owner is null or p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' or p_days is null then
    raise exception 'owner, identity fingerprint and trial length required' using errcode='22023';
  end if;
  -- Account closure uses this same subject guard. A grant must either finish
  -- before closure detaches it, or observe closure and leave no attached row.
  perform internal.lock_evidence_subject(p_owner);
  -- Concurrent grants for one identity serialise here; the loser sees the claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_identity_hmac, ''), 2701));
  if not exists (select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active trial owner required' using errcode='42501';
  end if;
  if exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac) then
    return jsonb_build_object('granted', false, 'reason', 'identity_already_used');
  end if;
  -- Banned identities (trust-governance.sql) get no trial while the ban is kept.
  if exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()) then
    return jsonb_build_object('granted', false, 'reason', 'identity_banned');
  end if;
  insert into private.entitlements (owner_id, source, slot_capacity, max_photos, max_videos, starts_at, ends_at)
  values (p_owner, 'intro_trial', 1, 10, 1, statement_timestamp(), statement_timestamp() + make_interval(days => p_days))
  returning id into ent;
  insert into private.trial_identities (identity_hmac, owner_id, entitlement_id) values (p_identity_hmac, p_owner, ent);
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  -- The fingerprint lives only in trial_identities (DEC-27); other copies would
  -- outlive its purge, so effects are keyed by the trial's entitlement.
  values ('trial_started', ent, p_owner, 'trial_started:' || ent);
  return jsonb_build_object('granted', true, 'entitlement_id', ent);
end;
$$;
revoke all on function internal.grant_intro_trial(uuid, text, integer) from public, anon, authenticated, service_role;
-- Raw core helper has no client/service EXECUTE; trusted derived commands call it as owner.
-- Raw API driver lives only in fixture-core-drivers.sql, excluded from target.

-- Server-only sweep (DEC-27): delete detached trial fingerprints whose 3-year
-- period has ended. Live accounts' fingerprints have no deadline.
create function internal.purge_expired_trial_identities(p_limit integer)
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  with due as (
    select t.identity_hmac from private.trial_identities t
    where t.retain_until <= statement_timestamp()
    order by t.retain_until limit p_limit
    for update skip locked
  )
  delete from private.trial_identities t using due where t.identity_hmac = due.identity_hmac;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function internal.purge_expired_trial_identities(integer) from public, anon, authenticated, service_role;
grant execute on function internal.purge_expired_trial_identities(integer) to service_role;
create function api.purge_expired_trial_identities(p_limit integer)
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.purge_expired_trial_identities(p_limit);
$$;
revoke all on function api.purge_expired_trial_identities(integer) from public, anon, authenticated, service_role;
grant execute on function api.purge_expired_trial_identities(integer) to service_role;

-- Server-only reversal (staff authority and AAL2 binding are BF-08). One commit:
-- payment status, entitlement or window revocation, activation release, outbox.
create function internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare pay private.payments; released integer := 0; payment_owner uuid;
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
  -- Activation normally takes post -> entitlement. Never WAIT in the reverse
  -- order: fence the entitlement and acquire the current affected posts NOWAIT,
  -- or return an explicit retry before any financial/domain mutation.
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
  update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
  from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null;
  get diagnostics released = row_count;
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$$;
revoke all on function internal.reverse_payment(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function internal.reverse_payment(uuid, text, text) to service_role;
create function api.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.reverse_payment(p_payment_id, p_kind, p_reason);
$$;
revoke all on function api.reverse_payment(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function api.reverse_payment(uuid, text, text) to service_role;

-- Live catalogue carried over unchanged (DEC-24; source plans/pricing.ts read
-- 14 October 2026). Every plan allows 10 photos and 1 video per post.
-- Explicit reviewed retail/multi purchase capabilities; free/trial defaults remain empty.
insert into private.plan_versions (plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, max_photos, max_videos, addon_capabilities)
select seed.*,array['boost','featured','urgent']::text[]
from (values
  ('market_30d', 1, 'market', 'Mzansi Market — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('market_90d', 1, 'market', 'Mzansi Market — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('market_180d', 1, 'market', 'Mzansi Market — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('business_30d', 1, 'business', 'Mzansi Business — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('business_90d', 1, 'business', 'Mzansi Business — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('business_180d', 1, 'business', 'Mzansi Business — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('tourism_30d', 1, 'tourism_events', 'Tourism — 30 Days', 5000, 30, 1, 10, 10, 1),
  ('tourism_90d', 1, 'tourism_events', 'Tourism — 90 Days', 14000, 90, 1, 10, 10, 1),
  ('tourism_180d', 1, 'tourism_events', 'Tourism — 180 Days', 25000, 180, 1, 10, 10, 1),
  ('multi_10_90d', 1, null, 'Multi-listing — 10 slots, 90 days', 120000, 90, 10, 20, 10, 1),
  ('multi_10_180d', 1, null, 'Multi-listing — 10 slots, 180 days', 215000, 180, 10, 20, 10, 1),
  ('multi_25_90d', 1, null, 'Multi-listing — 25 slots, 90 days', 270000, 90, 25, 50, 10, 1),
  ('multi_25_180d', 1, null, 'Multi-listing — 25 slots, 180 days', 485000, 180, 25, 50, 10, 1),
  ('multi_50_90d', 1, null, 'Multi-listing — 50 slots, 90 days', 500000, 90, 50, 100, 10, 1),
  ('multi_50_180d', 1, null, 'Multi-listing — 50 slots, 180 days', 900000, 180, 50, 100, 10, 1),
  ('multi_100_90d', 1, null, 'Multi-listing — 100 slots, 90 days', 900000, 90, 100, 200, 10, 1),
  ('multi_100_180d', 1, null, 'Multi-listing — 100 slots, 180 days', 1600000, 180, 100, 200, 10, 1)) as seed(plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, max_photos, max_videos);
insert into private.addon_versions (kind, version, days, price_cents)
values ('boost', 1, 7, 1500), ('featured', 1, 7, 2500), ('urgent', 1, 7, 1000);
