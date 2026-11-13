-- Individual slots at R69 (roadmap Milestone 11, P2, with M3.8): paid slots
-- go on sale again at the prices posting-v4 states.
--
-- Apply after 20261112173841_switch_posting_terms_v4.sql, which makes
-- posting-v4 current and takes every earlier plan off sale; this file refuses
-- (55000) unless posting-v4 is current and no plan is on sale except the three
-- below (a repeated run). In one transaction it:
--
-- 1. Puts three new plan versions on sale: one Individual slot for any posting
--    area (area null) for 30, 90 or 180 days at 6,900, 20,700 and 41,400 cents
--    (R69 per slot per 30 days, no discounts), one slot each, at most 4 posts
--    going live per slot per 30 days, 10 photos and 1 video per post, the same
--    add-on capabilities as the retired retail plans (add-on sales stay paused
--    by the website). Their ids are fixed below so every replay and the
--    website's browser test copy use the same ones. Earlier plan versions stay
--    retired and are kept as history.
-- 2. New table private.payment_lines: one row per slot of a plan payment. A
--    payment keeps one amount (the order total, one Ozow payment); each line
--    is one slot at its own price, gets its own entitlement when the payment
--    is confirmed (private.entitlements.payment_line_id) and its own partner
--    commission (private.partner_commissions.payment_line_id), so one slot can
--    be refunded or charged back alone. The one-entitlement and
--    one-commission-per-payment unique constraints become partial unique
--    indexes for payments without lines (payments made before this update).
-- 3. New member command api.start_slot_checkout(p_plan_id, p_slots,
--    p_expected_total_cents, p_cooling_off_consent): the only way to buy a
--    slot. The server computes slot price x slots (the plan's price already
--    covers its 30-day periods) and refuses:
--    - without the cooling-off consent the checkout box records (22023); the
--      consent, its time and the posting terms version are kept in the
--      payment's snapshot;
--    - before the member's ID review is accepted (PT412, M3.8);
--    - an order above R10,000 (1,000,000 cents; exactly R10,000 is allowed),
--      which is paid by invoice (PT413);
--    - a total that differs from the one the member was shown (PT428), so the
--      price shown is the price charged;
--    - more Individual slots than the person's limit (PT429): 4 at once per
--      ID-reviewed person, counted over every account that has had an
--      accepted ID review with the same identity fingerprint, including
--      slots in payments still open at Ozow. The free first post, staff
--      grants and sponsored places are not Individual slots and never count.
--    A pending payment for the same plan and number of slots is reused; one
--    for another number of slots is cancelled when no Ozow request was made
--    for it, and otherwise returned so the member can continue, check or
--    cancel it.
--    api.start_checkout(p_product_id, p_target_post) now refuses plans; it
--    still sells add-ons.
-- 4. Confirming a payment with lines (api.apply_provider_event) gives each
--    open line its own entitlement, unless the person would then hold more
--    Individual slots than their limit (for example a late success of an
--    expired checkout): the money is recorded and the payment goes to
--    reconciliation for staff (outcome complete_unfulfillable_target), as for
--    any confirmed payment that cannot be activated.
-- 5. New staff command api.record_staff_slot_reversal(p_line_id, p_kind,
--    p_reason) (capability payments:refund, never the buyer's own identity): records the refund or chargeback of one slot. It revokes that
--    slot's entitlement, ends the posts it paid for as a whole-payment
--    reversal does, and reverses only that slot's commission. When the last
--    open slot of a payment is reversed, the payment itself becomes refunded
--    or charged back. A whole-payment reversal (api.reverse_payment) marks
--    every open line reversed, and is refused once a single slot was
--    reversed.
-- 6. New table private.individual_slot_limits and staff command
--    api.staff_set_individual_slot_limit(p_account_id, p_slot_limit,
--    p_ends_at, p_reason) (new capability slots:raise_limit, administrators,
--    recent second factor): raises one ID-reviewed person's limit to 5-25
--    Individual slots until an end date at most 366 days away, only when that
--    account has a checked business (a live business profile or an approved
--    business check); 4 ends the raise. Rows are kept as an audit trail:
--    a raise is only ever ended, never changed or deleted.
-- 7. New member read api.get_my_slots(): every slot the member holds and every
--    slot that ended in the last 3 days, with the post in it (or none), the
--    sponsor's name for a sponsored place, and the member's Individual slot
--    count and limit, for the "My slots" page and the checkout.
-- 8. The fair-use count (api.activate_post) no longer counts a submission that
--    review rejected: each paid slot takes at most 4 posts going live per 30
--    days, a new post and an ended post brought back each count, editing a
--    live post never counts (posting-v4).
--
-- No existing API command changes its arguments or its reply shape. The
-- website release deployed before this update (paid slots paused) never
-- offers a plan, so it is unaffected.
--
-- Staff never act for themselves: a staff member needs an accepted ID review of
-- their own, and may not raise the limit of, or record a reversal on, an
-- account that has had an accepted ID review with a fingerprint the staff
-- member's own account has had (internal.assert_staff_acts_for_other, checked
-- before the lock waits and again after the last authority check; also applied
-- to api.record_frontend_staff_payment_reversal). Partner commission is created
-- only for a payment whose purchase was delivered (fulfilled): nothing for
-- money sent to staff for reconciliation. Slots of an account that has lost
-- access for good (closed, deleted, or under an approved permanent ban that was
-- not lifted) stop counting towards the person's limit; slots of an account
-- that is only blocked for a while keep counting.
--
-- ORDER: apply this update after the website release of
-- 20261112173841_switch_posting_terms_v4.sql is live and that update is
-- applied, and BEFORE the pull request that uses this update is merged (a merge
-- into main is deployed): that release calls the new commands. Read-only
-- preflight: ../preflight/20261112174600_individual_slots_r69.check.sql.
-- Rollback: ../rollback/20261112174600_individual_slots_r69.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: posting-v4 is current; nothing else is on sale; the new
-- tables and columns are absent or exactly this update's; the three plan rows
-- are absent or exactly this update's.
do $$
declare shape text; current_version text;
begin
  select c.version into current_version from private.posting_terms_current c where c.singleton;
  if current_version is distinct from 'posting-v4' then
    raise exception 'individual slots precondition: posting-v4 must be current (apply 20261112173841_switch_posting_terms_v4.sql first); current is %',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  if exists(select 1 from private.plan_versions v where v.is_public and v.retired_at is null
      and v.plan_code not in('individual_30d','individual_90d','individual_180d')) then
    raise exception 'individual slots precondition: another plan is on sale (%)',
      (select string_agg(v.plan_code||'@'||v.version,', ' order by v.plan_code) from private.plan_versions v
        where v.is_public and v.retired_at is null and v.plan_code not in('individual_30d','individual_90d','individual_180d'))
      using errcode='55000';
  end if;
  for shape in
    select v.name||' '||coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
      from pg_catalog.pg_attribute a where a.attrelid=to_regclass(v.name) and a.attnum>0 and not a.attisdropped),'absent')
    from (values ('private.payment_lines'),('private.individual_slot_limits')) v(name)
  loop
    if shape not in ('private.payment_lines absent','private.individual_slot_limits absent',
        'private.payment_lines id:uuid!,payment_id:uuid!,line_number:integer!,plan_version_id:uuid!,amount_cents:bigint!,'
          ||'status:text!,reversal_kind:text,reversal_reason:text,reversed_at:timestamp with time zone,reversed_by:uuid,'
          ||'created_at:timestamp with time zone!',
        'private.individual_slot_limits id:uuid!,identity_hmac:text!,account_id:uuid!,slot_limit:integer!,'
          ||'ends_at:timestamp with time zone!,reason:text!,granted_by:uuid!,granted_at:timestamp with time zone!,'
          ||'revoked_at:timestamp with time zone,revoked_by:uuid,revoke_reason:text') then
      raise exception 'individual slots table drift: %', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.name||' '||coalesce((select pg_catalog.format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then '!' else '' end
      from pg_catalog.pg_attribute a where a.attrelid=to_regclass(v.rel) and a.attname='payment_line_id' and not a.attisdropped),'absent')
    from (values ('entitlements','private.entitlements'),('partner_commissions','private.partner_commissions')) v(name,rel)
  loop
    if shape not in ('entitlements absent','entitlements uuid','partner_commissions absent','partner_commissions uuid') then
      raise exception 'individual slots column drift: %', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.plan_versions v
      join (values ('individual_30d','d6ca48e5-43be-40df-8d8c-72c98a6fda96'::uuid,'Individual slot — 30 days',6900,30),
          ('individual_90d','6a449457-2384-457e-9434-23c2b0e73127'::uuid,'Individual slot — 90 days',20700,90),
          ('individual_180d','ce4ef578-344a-4816-ab6a-6961bec46621'::uuid,'Individual slot — 180 days',41400,180))
        x(code,id,label,price,days) on x.code=v.plan_code
      where v.version=1
        and jsonb_build_object('id',v.id,'area',v.area,'label',v.label,'price',v.price_cents,'currency',v.currency,
          'days',v.duration_days,'slots',v.slot_capacity,'activations',v.activations_per_period,
          'period',v.activation_period_days,'photos',v.max_photos,'videos',v.max_videos,
          'addons',to_jsonb(v.addon_capabilities),'public',v.is_public)
        is distinct from jsonb_build_object('id',x.id,'area',null,'label',x.label,'price',x.price,'currency','ZAR',
          'days',x.days,'slots',1,'activations',4,'period',30,'photos',10,'videos',1,
          'addons',jsonb_build_array('boost','featured','urgent'),'public',true)) then
    raise exception 'individual slots precondition: an individual plan version exists with other terms' using errcode='55000';
  end if;
  if exists(select 1 from private.plan_versions v where v.version=1 and v.retired_at is not null
      and v.plan_code in('individual_30d','individual_90d','individual_180d')) then
    raise exception 'individual slots precondition: these plan versions were taken off sale (by the rollback); publish new versions in a new update'
      using errcode='55000';
  end if;
end$$;

-- 1. The catalogue.
insert into private.plan_versions (id, plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, activation_period_days, max_photos, max_videos, addon_capabilities)
values
  ('d6ca48e5-43be-40df-8d8c-72c98a6fda96', 'individual_30d', 1, null, 'Individual slot — 30 days', 6900, 30, 1, 4, 30, 10, 1,
    array['boost','featured','urgent']),
  ('6a449457-2384-457e-9434-23c2b0e73127', 'individual_90d', 1, null, 'Individual slot — 90 days', 20700, 90, 1, 4, 30, 10, 1,
    array['boost','featured','urgent']),
  ('ce4ef578-344a-4816-ab6a-6961bec46621', 'individual_180d', 1, null, 'Individual slot — 180 days', 41400, 180, 1, 4, 30, 10, 1,
    array['boost','featured','urgent'])
on conflict (plan_code, version) do nothing;

-- 2. Payment lines and their links.
create table if not exists private.payment_lines (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  payment_id uuid not null references private.payments (id) on delete cascade,
  line_number integer not null check (line_number between 1 and 25),
  plan_version_id uuid not null references private.plan_versions (id) on delete restrict,
  amount_cents bigint not null check (amount_cents between 100 and 1000000),
  status text not null default 'open' check (status in ('open', 'reversed')),
  reversal_kind text check (reversal_kind in ('refunded', 'chargeback')),
  reversal_reason text check (length(btrim(reversal_reason)) between 5 and 500),
  reversed_at timestamptz,
  reversed_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint payment_lines_number_key unique (payment_id, line_number),
  constraint payment_lines_id_payment_key unique (id, payment_id),
  constraint payment_lines_reversal check ((status = 'reversed')
    = (reversal_kind is not null and reversal_reason is not null and reversed_at is not null)),
  constraint payment_lines_reversed_by check (reversed_by is null or status = 'reversed')
);
alter table private.payment_lines enable row level security;
revoke all on table private.payment_lines from public, anon, authenticated, service_role;
create index if not exists payment_lines_plan_version_idx on private.payment_lines (plan_version_id);
create index if not exists payment_lines_reversed_by_idx on private.payment_lines (reversed_by) where reversed_by is not null;

alter table private.entitlements add column if not exists payment_line_id uuid;
do $$begin
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_payment_line_id_fkey'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_payment_line_id_fkey
      foreign key (payment_line_id, payment_id) references private.payment_lines (id, payment_id) on delete restrict;
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_payment_line_source'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_payment_line_source
      check (payment_line_id is null or (source = 'retail_paid' and payment_id is not null));
  end if;
end$$;
alter table private.entitlements drop constraint if exists entitlements_payment_id_key;
create unique index if not exists entitlements_payment_line_idx on private.entitlements (payment_line_id)
  where payment_line_id is not null;
create index if not exists entitlements_payment_line_payment_idx on private.entitlements (payment_line_id, payment_id)
  where payment_line_id is not null;
create unique index if not exists entitlements_payment_unlined_idx on private.entitlements (payment_id)
  where payment_id is not null and payment_line_id is null;
create index if not exists entitlements_payment_id_idx on private.entitlements (payment_id) where payment_id is not null;

alter table private.partner_commissions add column if not exists payment_line_id uuid;
do $$begin
  if not exists(select 1 from pg_catalog.pg_constraint where conname='partner_commissions_payment_line_id_fkey'
      and conrelid='private.partner_commissions'::regclass) then
    alter table private.partner_commissions add constraint partner_commissions_payment_line_id_fkey
      foreign key (payment_line_id, payment_id) references private.payment_lines (id, payment_id) on delete restrict;
  end if;
end$$;
alter table private.partner_commissions drop constraint if exists partner_commissions_payment_id_key;
create unique index if not exists partner_commissions_payment_line_idx on private.partner_commissions (payment_line_id)
  where payment_line_id is not null;
create index if not exists partner_commissions_payment_line_payment_idx on private.partner_commissions (payment_line_id, payment_id)
  where payment_line_id is not null;
create unique index if not exists partner_commissions_payment_unlined_idx on private.partner_commissions (payment_id)
  where payment_line_id is null;
create index if not exists partner_commissions_payment_id_idx on private.partner_commissions (payment_id);

-- Identity fingerprints are matched over every accepted review, ended ones too.
create index if not exists accepted_identity_facts_identity_idx on private.accepted_identity_facts (identity_hmac);

-- 6. Staff-raised limits.
create table if not exists private.individual_slot_limits (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  identity_hmac text not null check (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  account_id uuid not null references auth.users (id) on delete restrict,
  slot_limit integer not null check (slot_limit between 5 and 25),
  ends_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  granted_by uuid not null references auth.users (id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revoke_reason text check (length(btrim(revoke_reason)) between 5 and 500),
  check (granted_by <> account_id),
  check (ends_at > granted_at and ends_at <= granted_at + interval '366 days'),
  check ((revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null))
);
alter table private.individual_slot_limits enable row level security;
revoke all on table private.individual_slot_limits from public, anon, authenticated, service_role;
create unique index if not exists individual_slot_limits_current_idx on private.individual_slot_limits (identity_hmac)
  where revoked_at is null;
create index if not exists individual_slot_limits_account_idx on private.individual_slot_limits (account_id);
create index if not exists individual_slot_limits_granted_by_idx on private.individual_slot_limits (granted_by);
create index if not exists individual_slot_limits_revoked_by_idx on private.individual_slot_limits (revoked_by)
  where revoked_by is not null;

insert into private.staff_capabilities (role, capability, requires_recent_mfa)
values ('admin', 'slots:raise_limit', true)
on conflict (role, capability) do nothing;

CREATE OR REPLACE FUNCTION internal.payment_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- A line is the price of one slot of a confirmed order: it never changes,
  -- except that it can be reversed (refunded or charged back) once.
  if (to_jsonb(new) - array['status','reversal_kind','reversal_reason','reversed_at','reversed_by'])
      is distinct from (to_jsonb(old) - array['status','reversal_kind','reversal_reason','reversed_at','reversed_by'])
    or old.status <> 'open' or new.status <> 'reversed' then
    raise exception 'payment lines are immutable; a line can only be reversed once' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_line_guard() owner to postgres;
revoke all on function internal.payment_line_guard() from public, anon, authenticated, service_role;
drop trigger if exists payment_lines_immutable on private.payment_lines;
create trigger payment_lines_immutable before update on private.payment_lines
  for each row execute function internal.payment_line_guard();

CREATE OR REPLACE FUNCTION internal.individual_slot_limit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The audit trail of raised limits: a raise is only ever ended, once.
  if tg_op = 'DELETE' then
    raise exception 'slot limit history is retained' using errcode='23514';
  end if;
  if (to_jsonb(new) - array['revoked_at','revoked_by','revoke_reason'])
      is distinct from (to_jsonb(old) - array['revoked_at','revoked_by','revoke_reason'])
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'slot limit history is immutable; end the raise and grant a new one' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.individual_slot_limit_guard() owner to postgres;
revoke all on function internal.individual_slot_limit_guard() from public, anon, authenticated, service_role;
drop trigger if exists individual_slot_limits_immutable on private.individual_slot_limits;
create trigger individual_slot_limits_immutable before update or delete on private.individual_slot_limits
  for each row execute function internal.individual_slot_limit_guard();

CREATE OR REPLACE FUNCTION internal.partner_commission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.partner_id,new.payment_id,new.payment_line_id,new.referred_account_id,new.base_cents,new.rate_bps,
      new.amount_cents,new.eligible_at,new.created_at) is distinct from (old.id,old.partner_id,old.payment_id,
      old.payment_line_id,old.referred_account_id,old.base_cents,old.rate_bps,old.amount_cents,old.eligible_at,
      old.created_at)
    or old.status='reversed'
    or (old.status,new.status) not in(('pending','pending'),('pending','approved'),('pending','reversed'),
      ('approved','approved'),('approved','paid'),('approved','reversed'),('paid','paid'),('paid','reversed')) then
    raise exception 'commission history is immutable' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.partner_commission_guard() owner to postgres;
revoke all on function internal.partner_commission_guard() from public;

-- Staff never act for themselves: the same account, or two accounts that have
-- had an accepted ID review with the same fingerprint (ended reviews too).
CREATE OR REPLACE FUNCTION internal.same_identity(p_one uuid, p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_one = p_other, false)
    or exists(select 1 from private.accepted_identity_facts a
      join private.accepted_identity_facts b on b.identity_hmac=a.identity_hmac
      where a.owner_id=p_one and b.owner_id=p_other);
$function$;
alter function internal.same_identity(uuid,uuid) owner to postgres;
revoke all on function internal.same_identity(uuid,uuid) from public, anon, authenticated, service_role;

-- Individual slot rules.
CREATE OR REPLACE FUNCTION internal.individual_slot_plan(p_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_code in ('individual_30d','individual_90d','individual_180d'), false);
$function$;
alter function internal.individual_slot_plan(text) owner to postgres;
revoke all on function internal.individual_slot_plan(text) from public, anon, authenticated, service_role;

-- The person behind an account: the fingerprint of the current accepted ID
-- review, else of the account's latest accepted review (ended ones too).
CREATE OR REPLACE FUNCTION internal.individual_slot_identity(p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(internal.current_verified_identity(p_owner),
    (select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner
      order by f.reviewed_at desc, f.id desc limit 1));
$function$;
alter function internal.individual_slot_identity(uuid) owner to postgres;
revoke all on function internal.individual_slot_identity(uuid) from public, anon, authenticated, service_role;

-- Staff money and limit actions: the staff member needs an accepted ID review
-- of their own (an account without one cannot be compared with the person it
-- acts on), and never acts on their own identity (internal.same_identity).
-- Called before the lock waits and again after the last authority check, so a
-- review accepted while the command waited is seen.
CREATE OR REPLACE FUNCTION internal.assert_staff_acts_for_other(p_actor uuid, p_subject uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if internal.individual_slot_identity(p_actor) is null then
    raise exception 'staff need an accepted ID review of their own for this' using errcode='42501';
  end if;
  if internal.same_identity(p_actor, p_subject) then
    if p_kind='limit' then
      raise exception 'a different staff member must change this limit' using errcode='42501';
    end if;
    raise exception 'a different staff member must record this reversal' using errcode='42501';
  end if;
end;
$function$;
alter function internal.assert_staff_acts_for_other(uuid,uuid,text) owner to postgres;
revoke all on function internal.assert_staff_acts_for_other(uuid,uuid,text) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.individual_slot_limit(p_identity text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select l.slot_limit from private.individual_slot_limits l
    where l.identity_hmac=p_identity and l.revoked_at is null and l.ends_at>clock_timestamp()), 4);
$function$;
alter function internal.individual_slot_limit(text) owner to postgres;
revoke all on function internal.individual_slot_limit(text) from public, anon, authenticated, service_role;

-- Individual slots of one person: held (active, not ended) and in payments
-- still open at Ozow (checkout window running, or created in the last 30
-- minutes and not yet sent), over the account and every account that has had
-- an accepted ID review with the same fingerprint and has not lost access for
-- good. p_exclude leaves out one payment (the one being reused or confirmed).
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
revoke all on function internal.individual_slots_counted(text,uuid,uuid) from public, anon, authenticated, service_role;

-- A checked business: a live business profile, or an approved business check
-- that has not ended.
CREATE OR REPLACE FUNCTION internal.individual_slot_business_checked(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.posts p where p.owner_id=p_owner and p.kind='business' and p.status='live'
      and p.edit_of is null)
    or exists(select 1 from private.frontend_business_checks c where c.owner_id=p_owner and c.status='approved'
      and c.revoked_at is null and c.expires_at>clock_timestamp());
$function$;
alter function internal.individual_slot_business_checked(uuid) owner to postgres;
revoke all on function internal.individual_slot_business_checked(uuid) from public, anon, authenticated, service_role;

-- 3. The slot checkout.
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
revoke all on function internal.start_slot_checkout(uuid,integer,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.start_slot_checkout(uuid,integer,bigint,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.start_slot_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_slot_checkout(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent);
$function$;
alter function api.start_slot_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function api.start_slot_checkout(uuid,integer,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function api.start_slot_checkout(uuid,integer,bigint,boolean) to authenticated;

-- api.start_checkout keeps selling add-ons; plans are bought per slot.
CREATE OR REPLACE FUNCTION internal.start_checkout(p_product_id uuid, p_target_post uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  addon private.addon_versions;
  pay private.payments;
  target private.posts;
  purchase_entitlement uuid;
begin
  if p_product_id is null then raise exception 'product required' using errcode = '22023'; end if;
  perform internal.lock_evidence_subject(actor);
  perform internal.price_draft_actor();
  if exists(select 1 from private.plan_versions v where v.id = p_product_id) then
    raise exception 'slots are bought with the slot checkout' using errcode = '22023';
  end if;
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  select * into pay from private.payments p
    where p.owner_id = actor and p.status = 'pending'
      and p.addon_version_id = p_product_id
      and p.target_post_id is not distinct from p_target_post;
  if not found then
    insert into private.payments (owner_id, product_kind, addon_version_id, target_post_id,
      amount_cents, currency, snapshot)
    values (actor, 'addon', addon.id, p_target_post, addon.price_cents, addon.currency,
      jsonb_build_object('kind', 'addon', 'addon', addon.kind, 'version', addon.version,
          'days', addon.days, 'price_cents', addon.price_cents, 'target_kind',target.kind,
          'target_area',target.area,'target_owner_id',target.owner_id,
          'purchase_entitlement_id',purchase_entitlement,
          'addon_capabilities',(select to_jsonb(e.addon_capabilities) from private.entitlements e where e.id=purchase_entitlement)))
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

-- 4. Confirmation: one entitlement per open line, within the person's limit.
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

-- Commission: one per slot line (one per payment without lines), only for a
-- delivered purchase. The trigger (payments_partner_commission) fires only
-- when a payment's status changes: any later command that marks a payment
-- fulfilled without changing its status (for example a staff reconciliation
-- that delivers the slots) must create the commission itself.
CREATE OR REPLACE FUNCTION internal.payment_partner_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare acq private.account_acquisitions; partner private.partners; c record; rate integer;
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
  -- Only a delivered purchase earns commission: money sent to staff for
  -- reconciliation (needs_reconciliation) earns none.
  if new.status<>'complete' or new.fulfillment_status<>'fulfilled' then return null; end if;
  select * into acq from private.account_acquisitions a where a.account_id=new.owner_id;
  if acq.partner_id is null then return null; end if;
  select * into partner from private.partners p where p.id=acq.partner_id;
  if partner.status<>'active' or partner.account_id=new.owner_id then return null; end if;
  rate:=coalesce(partner.commission_bps,2000);
  if exists(select 1 from private.payment_lines l where l.payment_id=new.id) then
    insert into private.partner_commissions(partner_id,payment_id,payment_line_id,referred_account_id,base_cents,rate_bps,
        amount_cents,eligible_at)
      select partner.id,new.id,l.id,new.owner_id,l.amount_cents,rate,floor(l.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days'
      from private.payment_lines l where l.payment_id=new.id and l.status='open' order by l.line_number
      on conflict (payment_line_id) where payment_line_id is not null do nothing;
  else
    insert into private.partner_commissions(partner_id,payment_id,referred_account_id,base_cents,rate_bps,amount_cents,
        eligible_at)
      values(partner.id,new.id,new.owner_id,new.amount_cents,rate,floor(new.amount_cents::numeric*rate/10000),
        statement_timestamp()+interval '30 days')
      on conflict (payment_id) where payment_line_id is null do nothing;
  end if;
  return null;
end;
$function$;
alter function internal.payment_partner_commission() owner to postgres;
revoke all on function internal.payment_partner_commission() from public;

-- 5. Reversals: the whole payment, or one slot.
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
  if exists(select 1 from private.payment_lines l where l.payment_id=pay.id and l.status='reversed') then
    raise exception 'a slot of this payment was already reversed; reverse its other slots one by one' using errcode='PT409';
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
  update private.payment_lines set status='reversed', reversal_kind=p_kind, reversal_reason=btrim(p_reason),
    reversed_at=statement_timestamp() where payment_id=pay.id and status='open';
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

CREATE OR REPLACE FUNCTION internal.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; line private.payment_lines; pay private.payments; ent private.entitlements;
  released integer := 0; v_post_ids uuid[] := '{}'::uuid[]; open_left integer; c record;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_line_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'valid slot reversal and reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payment_lines l join private.payments p on p.id=l.payment_id where l.id=p_line_id;
  if buyer is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  perform internal.lock_evidence_subject(buyer);
  select p.* into pay from private.payments p join private.payment_lines l on l.payment_id=p.id where l.id=p_line_id
    for update of p;
  select * into line from private.payment_lines l where l.id=p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  if line.status='reversed' then
    if line.reversed_by=actor and line.reversal_kind=p_kind and line.reversal_reason=btrim(p_reason) then
      return jsonb_build_object('status',line.reversal_kind,'line_id',line.id,'released_activations',0,
        'payment_status',pay.status,'repeated',true);
    end if;
    raise exception 'this slot was already reversed' using errcode='PT409';
  end if;
  if pay.status<>'complete' then
    raise exception 'only slots of a completed payment can be reversed' using errcode='22023';
  end if;
  begin
    select * into ent from private.entitlements e where e.payment_line_id=line.id for update nowait;
    perform p.id from private.posts p where p.id in
      (select a.post_id from private.post_activations a where a.entitlement_id=ent.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payment_lines set status='reversed', reversal_kind=p_kind, reversal_reason=btrim(p_reason),
    reversed_at=statement_timestamp(), reversed_by=actor where id=line.id;
  if ent.id is not null then
    update private.entitlements set status='revoked', revoked_reason='payment_'||p_kind
      where id=ent.id and status<>'revoked';
    with released_rows as (
      update private.post_activations a set released_at=statement_timestamp(), release_reason='payment_reversed'
      where a.entitlement_id=ent.id and a.released_at is null
      returning a.post_id
    )
    select coalesce(array_agg(post_id),'{}') into v_post_ids from released_rows;
    released := cardinality(v_post_ids);
    update private.posts p set status='expired', status_reason='Payment '||p_kind, revision=revision+1
      where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
        or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
          where h.post_id=p.id and h.released_at is null)));
    update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  end if;
  -- Only this slot's commission.
  for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
      where x.payment_line_id=line.id and x.status<>'reversed' for update of x loop
    update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
      reversal_reason='Slot payment '||p_kind where id=c.id;
    perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
  end loop;
  select count(*) into open_left from private.payment_lines l where l.payment_id=pay.id and l.status='open';
  if open_left=0 then
    -- Every slot is reversed: so is the payment (its commission trigger finds nothing left).
    update private.payments set status=p_kind, fulfillment_status='reversed', status_changed_at=statement_timestamp()
      where id=pay.id;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_line_reversed:' || line.id);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_acts_for_other(actor, buyer, 'reversal');
  return jsonb_build_object('status',p_kind,'line_id',line.id,'released_activations',released,
    'payment_status',case when open_left=0 then p_kind else pay.status end,'repeated',false);
end;
$function$;
alter function internal.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_reversal(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function internal.record_staff_slot_reversal(uuid,text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_slot_reversal(p_line_id, p_kind, p_reason);
$function$;
alter function api.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function api.record_staff_slot_reversal(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function api.record_staff_slot_reversal(uuid,text,text) to authenticated;

-- The whole-payment staff reversal: the same staff rule.
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
  perform internal.assert_staff_acts_for_other(actor, owner, 'reversal');
  result:=internal.reverse_payment(p_id,p_kind,p_reason);
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_acts_for_other(actor, owner, 'reversal');
  insert into private.frontend_payment_reversals(payment_id,actor_id,kind,reason,released_activations)
    values(p_id,actor,p_kind,p_reason,(result->>'released_activations')::integer);
  return result;
end$function$;
alter function internal.record_frontend_staff_payment_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_frontend_staff_payment_reversal(uuid,text,text) from public;
grant execute on function internal.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;

-- 6. The staff-raised limit.
CREATE OR REPLACE FUNCTION internal.staff_set_individual_slot_limit(p_account_id uuid, p_slot_limit integer, p_ends_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; fingerprint text; raised private.individual_slot_limits;
begin
  actor:=internal.staff_actor('slots:raise_limit');
  if p_account_id is null or p_slot_limit is null or p_slot_limit not between 4 and 25
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false)
    or (p_slot_limit>4 and (p_ends_at is null or p_ends_at<=statement_timestamp()+interval '1 day'
      or p_ends_at>statement_timestamp()+interval '366 days'))
    or (p_slot_limit=4 and p_ends_at is not null) then
    raise exception 'valid slot limit (4 to 25), end date and reason required' using errcode='22023';
  end if;
  perform internal.assert_staff_acts_for_other(actor, p_account_id, 'limit');
  perform internal.lock_evidence_subject(p_account_id);
  fingerprint:=internal.current_verified_identity(p_account_id);
  if fingerprint is null and p_slot_limit>4 then
    raise exception 'the person''s ID review must be accepted first' using errcode='PT409';
  end if;
  -- Ending a raise works after the review lapsed: the person's latest fingerprint.
  fingerprint:=coalesce(fingerprint, internal.individual_slot_identity(p_account_id));
  if fingerprint is null then
    raise exception 'this account has no ID review' using errcode='PT409';
  end if;
  if p_slot_limit>4 and not internal.individual_slot_business_checked(p_account_id) then
    raise exception 'more than 4 slots need a checked business' using errcode='PT409';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform internal.staff_actor('slots:raise_limit'); -- authority after any lock wait
  perform internal.assert_staff_acts_for_other(actor, p_account_id, 'limit');
  update private.individual_slot_limits set revoked_at=clock_timestamp(), revoked_by=actor, revoke_reason=btrim(p_reason)
    where identity_hmac=fingerprint and revoked_at is null;
  if p_slot_limit>4 then
    insert into private.individual_slot_limits(identity_hmac, account_id, slot_limit, ends_at, reason, granted_by)
      values(fingerprint, p_account_id, p_slot_limit, p_ends_at, btrim(p_reason), actor)
      returning * into raised;
  end if;
  return jsonb_build_object('slot_limit', internal.individual_slot_limit(fingerprint), 'ends_at', raised.ends_at,
    'held', (internal.individual_slots_counted(fingerprint, p_account_id, null)->>'held')::integer);
end;
$function$;
alter function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) owner to postgres;
revoke all on function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) to authenticated;

CREATE OR REPLACE FUNCTION api.staff_set_individual_slot_limit(p_account_id uuid, p_slot_limit integer, p_ends_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_set_individual_slot_limit(p_account_id, p_slot_limit, p_ends_at, p_reason);
$function$;
alter function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) owner to postgres;
revoke all on function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) from public, anon, authenticated, service_role;
grant execute on function api.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) to authenticated;

-- 7. My slots.
CREATE OR REPLACE FUNCTION internal.get_my_slots()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); verified text; fingerprint text; counted jsonb; raise_ends timestamptz;
  result jsonb;
begin
  verified:=internal.current_verified_identity(actor);
  fingerprint:=coalesce(verified, internal.individual_slot_identity(actor));
  counted:=internal.individual_slots_counted(fingerprint, actor, null);
  select l.ends_at into raise_ends from private.individual_slot_limits l
    where l.identity_hmac=fingerprint and l.revoked_at is null and l.ends_at>clock_timestamp();
  select jsonb_build_object(
    'slots', coalesce((select jsonb_agg(s.slot order by s.ended, s.ends_at, s.id) from (
        select e.id, e.ends_at, e.ends_at<=statement_timestamp() as ended, jsonb_build_object(
          'id', e.id, 'source', e.source,
          'individual', coalesce(internal.individual_slot_plan(v.plan_code), false),
          'label', coalesce(v.label, pay.snapshot->>'label'),
          'area', e.area, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
          'state', case when e.ends_at>statement_timestamp() then 'active' else 'ended' end,
          'places', e.slot_capacity,
          'sponsor', (select o.name from private.organisation_sponsorships sp
              join private.organisations o on o.id=sp.organisation_id where sp.entitlement_id=e.id limit 1),
          'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
                'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at) order by x.activated_at, x.id)
              from (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at
                from private.post_activations a join private.posts p on p.id=a.post_id
                where a.entitlement_id=e.id and p.owner_id=actor and p.edit_of is null
                  and (a.released_at is null
                    or (e.ends_at<=statement_timestamp() and a.release_reason in ('expired','entitlement_ended')
                      and p.status='expired' and p.deletes_at>statement_timestamp()
                      and not exists(select 1 from private.post_activations n where n.post_id=p.id and n.released_at is null)))
                order by p.id, a.activated_at desc) x), '[]')) as slot
        from private.entitlements e
          left join private.payment_lines l on l.id=e.payment_line_id
          left join private.plan_versions v on v.id=l.plan_version_id
          left join private.payments pay on pay.id=e.payment_id
        where e.owner_id=actor and e.status='active' and e.starts_at<=statement_timestamp()
          and e.ends_at>statement_timestamp()-interval '3 days'
        order by e.ends_at desc limit 200) s), '[]'),
    'individual', jsonb_build_object('verified', verified is not null,
      'held', (counted->>'held')::integer, 'pending', (counted->>'pending')::integer,
      'limit', internal.individual_slot_limit(fingerprint), 'limit_ends_at', raise_ends)) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_slots() owner to postgres;
revoke all on function internal.get_my_slots() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_slots() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_slots()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_slots();
$function$;
alter function api.get_my_slots() owner to postgres;
revoke all on function api.get_my_slots() from public, anon, authenticated, service_role;
grant execute on function api.get_my_slots() to authenticated;

-- 8. Fair use: a submission that review rejected never went live.
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

-- Postcondition: exactly the three Individual slot plans are on sale.
do $$begin
  if (select string_agg(v.plan_code||'@'||v.version||'='||v.price_cents, ',' order by v.duration_days)
      from private.plan_versions v where v.is_public and v.retired_at is null)
      is distinct from 'individual_30d@1=6900,individual_90d@1=20700,individual_180d@1=41400' then
    raise exception 'the Individual slot plans are not exactly what is on sale';
  end if;
end$$;
commit;
