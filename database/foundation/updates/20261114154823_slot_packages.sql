-- Multi-listing packages, part one (roadmap P4a): the package record, buying a
-- package online, and posts in its places. Sales stay switched off.
--
-- Apply after 20261114093742_renew_slots_early.sql (it refuses with 55000
-- unless the bodies it builds on or replaces, and the two post funding views,
-- are the reviewed ones). Only adds: no API command, argument or grant is
-- removed or changed. In one transaction it:
--
-- 1. Adds the three package terms to the catalogue (slot_package_30d, _90d,
--    _180d: R100, R300 and R600 per slot), not public, so the slot
--    catalogue and the Individual checkout never offer them.
-- 2. Adds the sales switch private.slot_package_sales: one row, off. No
--    command changes it; the owner switches it on in a reviewed step when
--    business tools P5-P7 pass (G1). While it is off nothing can be bought.
-- 3. Adds private.slot_packages: one row per package (owner, term, slots it
--    was bought with), which never changes. Its places, start and end are
--    read from its grants: private.entitlements gains package_id, and each
--    purchase line is one grant carrying all its slots
--    (private.payment_lines gains slot_count; an Individual line keeps 1).
--    Slots added part-way (P4b) and renewals (P4d) will be further grants of
--    the same package; the team (P4c) will be keyed by the package; package
--    invoices (P4e) are payment lines like any other.
-- 4. New member command api.start_package_checkout(p_plan_id, p_slots,
--    p_expected_total_cents, p_cooling_off_consent): a typed number of slots,
--    5 to 100 online (fewer: 22023 package_slots_invalid; 101 to 250 and
--    any total above R10,000: PT413 package_invoice_required; more than 250:
--    22023), R100 per slot per 30 days, the "my slots start now" consent
--    (kept in the snapshot as package-starts-now-v1), an accepted ID review
--    (PT412), the total the member was shown (PT428), the switch on (PT403
--    packages_not_on_sale), one package per account (PT409 package_active).
--    One payment with one line holding every slot; one package order open at
--    a time (the same order is continued, another one cancelled when never
--    sent to Ozow, otherwise returned).
-- 5. Delivery: internal.apply_provider_event and
--    internal.activate_staff_paid_payment (full bodies) deliver a package only
--    while the account has no other package (otherwise the money goes to
--    reconciliation, or staff are told to refund); the Individual limit is
--    not applied to it. internal.issue_slot_line_entitlements (full body)
--    opens the package and issues its one grant (all its slots, 4 posts
--    going live per slot per 30 days, starting at payment). Partner
--    commission follows the line (20% of the package, once) and a refund or
--    chargeback of the line withdraws the grant, the posts in it and the
--    commission, through the existing reversal commands.
-- 6. Posts in package places. api.activate_post (full body) tries the
--    package's places first; its capacity is the package's places and the 4
--    posts going live per place per rolling 30 days count over the whole
--    package (decision 10; internal.slot_posts_held and
--    internal.slot_posts_started, full bodies, which the capacity, allowance
--    and post manager reads use); one activation at a time per package.
-- 7. E3. While a package runs (more than its last 7 days, decision 11), no
--    Individual slot of the person can be bought or renewed
--    (internal.start_slot_checkout and internal.start_slot_renewal_checkout,
--    full bodies; PT409 package_active). An Individual slot runs to its own
--    end; when its paid run ends, the package takes its post if it has a free
--    place, decided at read time: internal.slot_chain_end (full body; its
--    earlier body is now internal.slot_chain_paid_end) returns the package's
--    end for it, so the public view, the restorable view, post funding, the
--    kept activation and the shown end date keep the post before any job
--    runs, and the posts waiting take free places in the order their slots
--    ended. Search documents of posts in Individual slots that end before the
--    package move to the package's end when it is delivered and on every
--    sweep (internal.refresh_package_documents; search and the post page still
--    need read-time funding). internal.run_slot_renewals (full body) then moves
--    such posts into the package (continued, so not a post going live). A post
--    the package cannot take follows the normal 3-day grace.
-- 8. api.manage_plan_member (full body) never adds a member to a package's
--    grant: the team belongs to the package (P4c).
-- 9. New reads: api.get_slot_package_offer() (the website's server only:
--    on sale or not, the rules, and the terms while on sale) and api.get_my_slot_package()
--    (member: their package, its places, posts, end and fair-use count,
--    whether they can buy one, and until when Individual slots are closed).
--
-- ORDER: apply this update before the pull request that uses it is merged (a
-- merge into main is deployed, and that release calls the new commands).
-- Earlier releases do not call them and keep working with it applied.
-- Read-only preflight: ../preflight/20261114154823_slot_packages.check.sql.
-- Rollback: ../rollback/20261114154823_slot_packages.down.sql.
begin;
set local lock_timeout='5s';

-- Preconditions: the functions this update replaces are the earlier reviewed
-- bodies or this update's; the functions and views it builds on are the
-- reviewed ones; its columns and catalogue rows are absent or exactly its own.
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.slot_chain_end(uuid)'),('internal.slot_posts_held(uuid)'),
      ('internal.slot_posts_started(uuid,timestamp with time zone)'),('internal.activate_post(uuid)'),
      ('internal.issue_slot_line_entitlements(uuid)'),('internal.apply_provider_event(jsonb)'),
      ('internal.activate_staff_paid_payment(uuid,text)'),('internal.start_slot_checkout(uuid,integer,bigint,boolean)'),
      ('internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean)'),('internal.run_slot_renewals(integer)'),
      ('internal.manage_plan_member(uuid,text,text)')) v(sig)
  loop
    if shape not in (
        'internal.slot_chain_end(uuid) de3528681a1ad52128c6db296e413d12',
        'internal.slot_chain_end(uuid) fe36eb29f4128a1eef3c967c9c501c76',
        'internal.slot_posts_held(uuid) 991f2a39a08f79399bb502e1a382d2dc',
        'internal.slot_posts_held(uuid) 79a8a8cbd5e2a5208cb885bcfce222ef',
        'internal.slot_posts_started(uuid,timestamp with time zone) 1792e3af738c40f7f412198a47859398',
        'internal.slot_posts_started(uuid,timestamp with time zone) b4c766fe4de985334272296045f529e8',
        'internal.activate_post(uuid) bc99d728b6a6e4465b87b0fd607aeb08',
        'internal.activate_post(uuid) 2092e9b1814073bb1c3239e03013235e',
        'internal.issue_slot_line_entitlements(uuid) 85ae00308b9abb35c6c13bc67821d39d',
        'internal.issue_slot_line_entitlements(uuid) e4041c30d7297bc4b4da74791701627d',
        'internal.apply_provider_event(jsonb) 19d5c2eb7e1a75210bc2b77d2cbb961b',
        'internal.apply_provider_event(jsonb) ac38c2c9eceb3bed2df1083fabeeb4e8',
        'internal.activate_staff_paid_payment(uuid,text) 03c8a3314cd99f02fb465a391ca2942f',
        'internal.activate_staff_paid_payment(uuid,text) c892a45c4769f7f140b59ce6ba8d1a7c',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) 4ce514eae4c2fb3fd9b0a0ecc40ac498',
        'internal.start_slot_checkout(uuid,integer,bigint,boolean) cae84c17b05a49fc3937064eaaff38f2',
        'internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) 94de32ca80099d59db23aed33c6e7ee2',
        'internal.start_slot_renewal_checkout(uuid[],uuid,bigint,boolean) e014633dd37ebb3fa212fc2944dd7ed6',
        'internal.run_slot_renewals(integer) db9fd3d09dd015c5de40da964d6f8825',
        'internal.run_slot_renewals(integer) 0fb5f68336aab1f1f43b58c9acafb083',
        'internal.manage_plan_member(uuid,text,text) 39d6eba6a1db025d4ae0655d34870f96',
        'internal.manage_plan_member(uuid,text,text) 285ce1cc4dc56a1e262811362a345da8') then
      raise exception 'slot packages precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.price_draft_actor()'),('internal.lock_evidence_subject(uuid)'),
      ('internal.individual_slot_plan(text)'),('internal.individual_slot_owners(text,uuid)'),
      ('internal.individual_slot_identity(uuid)'),('internal.individual_slot_limit(text)'),
      ('internal.individual_slots_counted(text,uuid,uuid)'),('internal.individual_renewals_allowed(text,uuid,uuid,uuid[])'),
      ('internal.slot_lines_adding(uuid)'),('internal.slot_lines_renewing(uuid)'),('internal.slot_chain_held(uuid)'),
      ('internal.slot_chain_last_end(uuid)'),('internal.slot_renewal_window()'),('internal.slot_renewal_due(uuid,uuid)'),
      ('internal.refresh_slot_chain_documents(uuid)'),('internal.entitlement_for_post_eligible(uuid,uuid,uuid)'),
      ('internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone)'),
      ('internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone)'),
      ('internal.post_funding(uuid)'),('internal.post_shown_until(uuid,text,timestamp with time zone)'),
      ('internal.run_post_lifecycle(integer)'),('internal.customer_invoice_settled_elsewhere(uuid)'),
      ('internal.addon_purchase_entitlement(uuid,uuid,text)'),('internal.payment_invoice_vat(private.payments)'),
      ('internal.payment_delivery_commission(uuid)'),('internal.payment_partner_commission()'),
      ('internal.payment_line_guard()'),('internal.reverse_payment_line(uuid,text,text,uuid)'),
      ('internal.reverse_payment(uuid,text,text)'),('internal.staff_actor(text)'),
      ('internal.assert_staff_payment_actor(uuid,uuid)'),('internal.plain_text_valid(text,integer,integer,boolean)')) v(sig)
  loop
    if shape not in (
        'internal.price_draft_actor() 1d70271a4447ba5d1377f3f64a6cf029',
        'internal.lock_evidence_subject(uuid) 3ef77cf81542607c0ba91f6687255f01',
        'internal.individual_slot_plan(text) c0c1d06dc52122641d02db6b1364be75',
        'internal.individual_slot_owners(text,uuid) 49c59acc8f02fcb09e757c0584b7de51',
        'internal.individual_slot_identity(uuid) 4e4552c83cb629e96f1300060eeff16b',
        'internal.individual_slot_limit(text) 90ecd5c02572cc9831468458f3ae0e2d',
        'internal.individual_slots_counted(text,uuid,uuid) 4213e64e4b2fb9f8062fe02277a28e69',
        'internal.individual_renewals_allowed(text,uuid,uuid,uuid[]) 0012cbcef8b31da4ed93ee267ca13afd',
        'internal.slot_lines_adding(uuid) 74fe04e6cff80dece687c24e05c18fb7',
        'internal.slot_lines_renewing(uuid) 9ce02eccc93128dff9142cb06db0efe6',
        'internal.slot_chain_held(uuid) 23b8b9c552d561b4f2d818e9d5056f61',
        'internal.slot_chain_last_end(uuid) b1751aee92ddb5d65ed0c95a0bc1b8ea',
        'internal.slot_renewal_window() c238f2c972a2f767c6a70d939d552000',
        'internal.slot_renewal_due(uuid,uuid) f0eb3360c8456cc4b191c315c61c482e',
        'internal.refresh_slot_chain_documents(uuid) 8654d4f1d0886ad9e877835077a2ad3d',
        'internal.entitlement_for_post_eligible(uuid,uuid,uuid) d3861dfcebe2d7e1d6955a0c549b2db3',
        'internal.entitlement_usable(text,timestamp with time zone,timestamp with time zone) 0db72b1ee054a2d8dd1b946d73c58e41',
        'internal.slot_grant_usable(uuid,text,timestamp with time zone,timestamp with time zone) b43abb8cb82c15c1a3f240680d3710ac',
        'internal.post_funding(uuid) 16c30a8438ae9d43796f5f78f4144ad0',
        'internal.post_shown_until(uuid,text,timestamp with time zone) 38dd9acbfe8fe8cee3f4b894e1075d6f',
        'internal.run_post_lifecycle(integer) cb5770e3e71e9e6ed31d1eff3e06e3fc',
        'internal.customer_invoice_settled_elsewhere(uuid) eab13db8976c5bcde805288faec9591c',
        'internal.addon_purchase_entitlement(uuid,uuid,text) 2cd60895de8dad14dfe1d1f26ae83543',
        'internal.payment_invoice_vat(private.payments) 8ba4ca6c4ea0207abece5a9fdc57336e',
        'internal.payment_delivery_commission(uuid) 173b97b47147f69d097daba72def56d9',
        'internal.payment_partner_commission() e99f071fae090328566a61186843c6e2',
        'internal.payment_line_guard() b15e1db8b48ae9de6b4372ecef62ceed',
        'internal.reverse_payment_line(uuid,text,text,uuid) 3f95168e1faacac2ca6f1431962c182c',
        'internal.reverse_payment(uuid,text,text) 66005adb9e06b17e689dbac47ce93d5a',
        'internal.staff_actor(text) 269f0871f156f57c029cedcab72f6c3f',
        'internal.assert_staff_payment_actor(uuid,uuid) fe81cc39557206e06346fcf5e9f33bfd',
        'internal.plain_text_valid(text,integer,integer,boolean) b3654008b4427d60db398555fef16971') then
      raise exception 'slot packages precondition: % is not the reviewed body this update builds on', shape
        using errcode='55000';
    end if;
  end loop;
  -- The two post funding views read a slot's run through
  -- internal.slot_chain_end, which this update extends: they must be the
  -- reviewed definitions (an md5 of each whole definition).
  for shape in
    select v.name||' '||coalesce(md5(replace(pg_get_viewdef(to_regclass(v.name),true),E'\r\n',E'\n')),'absent')
    from (values ('private.public_eligible_posts'),('private.frontend_restorable_posts')) v(name)
  loop
    if shape not in ('private.public_eligible_posts 921182c5875ae0f33536c11e2b85c8a2',
        'private.frontend_restorable_posts 715c8d00fa79df66d1c0544283ea3ff5') then
      raise exception 'slot packages precondition: the post funding view % is not the reviewed definition', shape
        using errcode='55000';
    end if;
  end loop;
  for shape in
    select v.rel||'.'||v.col||' '||coalesce((select pg_catalog.format_type(a.atttypid,a.atttypmod)
        ||case when a.attnotnull then '!' else '' end||coalesce(' default '||pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(v.rel) and a.attname=v.col and not a.attisdropped),'absent')
    from (values ('private.entitlements','package_id'),('private.payment_lines','slot_count'),
      ('private.slot_packages','id'),('private.slot_packages','owner_id'),('private.slot_packages','term_days'),
      ('private.slot_packages','slot_count'),('private.slot_packages','created_at'),
      ('private.slot_package_sales','singleton'),('private.slot_package_sales','on_sale'),
      ('private.slot_package_sales','changed_at'),('private.slot_package_sales','reason')) v(rel,col)
  loop
    if shape not in ('private.entitlements.package_id absent','private.entitlements.package_id uuid',
        'private.payment_lines.slot_count absent','private.payment_lines.slot_count integer! default 1',
        'private.slot_packages.id absent','private.slot_packages.id uuid! default gen_random_uuid()',
        'private.slot_packages.owner_id absent','private.slot_packages.owner_id uuid!',
        'private.slot_packages.term_days absent','private.slot_packages.term_days integer!',
        'private.slot_packages.slot_count absent','private.slot_packages.slot_count integer!',
        'private.slot_packages.created_at absent','private.slot_packages.created_at timestamp with time zone! default statement_timestamp()',
        'private.slot_package_sales.singleton absent','private.slot_package_sales.singleton boolean! default true',
        'private.slot_package_sales.on_sale absent','private.slot_package_sales.on_sale boolean! default false',
        'private.slot_package_sales.changed_at absent','private.slot_package_sales.changed_at timestamp with time zone! default statement_timestamp()',
        'private.slot_package_sales.reason absent','private.slot_package_sales.reason text!') then
      raise exception 'slot packages column drift: %', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.plan_versions v
      join (values ('slot_package_30d','5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11'::uuid,'Multi-listing package — 30 days',10000,30),
          ('slot_package_90d','8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33'::uuid,'Multi-listing package — 90 days',30000,90),
          ('slot_package_180d','e1d7b6a4-0c95-4f8e-b3a2-6d4c8f2e1b55'::uuid,'Multi-listing package — 180 days',60000,180))
        x(code,id,label,price,days) on x.code=v.plan_code
      where v.version=1
        and jsonb_build_object('id',v.id,'area',v.area,'label',v.label,'price',v.price_cents,'currency',v.currency,
          'days',v.duration_days,'slots',v.slot_capacity,'activations',v.activations_per_period,
          'period',v.activation_period_days,'photos',v.max_photos,'videos',v.max_videos,
          'addons',to_jsonb(v.addon_capabilities),'public',v.is_public,'retired',v.retired_at is not null)
        is distinct from jsonb_build_object('id',x.id,'area',null,'label',x.label,'price',x.price,'currency','ZAR',
          'days',x.days,'slots',1,'activations',4,'period',30,'photos',10,'videos',1,
          'addons',jsonb_build_array('boost','featured','urgent'),'public',false,'retired',false)) then
    raise exception 'slot packages precondition: a package plan version exists with other terms' using errcode='55000';
  end if;
end$$;

-- 1. The catalogue: the three Multi-listing package terms, priced per slot
-- (R100 per slot per 30 days). They are not public: the slot catalogue
-- (api.billing_catalogue) never lists them and api.start_slot_checkout never
-- sells them; only api.start_package_checkout does, while the sales switch
-- is on.
insert into private.plan_versions (id, plan_code, version, area, label, price_cents, duration_days, slot_capacity,
  activations_per_period, activation_period_days, max_photos, max_videos, addon_capabilities, is_public)
values
  ('5b0f4c1e-2a7d-4c43-9b51-7e0d3f6a9c11', 'slot_package_30d', 1, null, 'Multi-listing package — 30 days', 10000, 30, 1,
    4, 30, 10, 1, array['boost','featured','urgent'], false),
  ('8c3e1a52-6f0b-4d29-a7c4-2b9e5d1f7a33', 'slot_package_90d', 1, null, 'Multi-listing package — 90 days', 30000, 90, 1,
    4, 30, 10, 1, array['boost','featured','urgent'], false),
  ('e1d7b6a4-0c95-4f8e-b3a2-6d4c8f2e1b55', 'slot_package_180d', 1, null, 'Multi-listing package — 180 days', 60000, 180,
    1, 4, 30, 10, 1, array['boost','featured','urgent'], false)
on conflict (plan_code, version) do nothing;

-- 2. The sales switch: one row, off. Nothing is on sale until the owner
-- switches it on (G1: not before P5-P7 pass); there is no command for it.
create table if not exists private.slot_package_sales (
  singleton boolean primary key default true check (singleton),
  on_sale boolean not null default false,
  changed_at timestamptz not null default statement_timestamp(),
  reason text not null check (length(btrim(reason)) between 5 and 500)
);
alter table private.slot_package_sales enable row level security;
revoke all on private.slot_package_sales from public, anon, authenticated, service_role;
insert into private.slot_package_sales (singleton, on_sale, reason)
values (true, false, 'Multi-listing is not on sale until business tools P5-P7 pass (G1)')
on conflict (singleton) do nothing;

-- 3. Packages. A package is one account's Multi-listing purchase: the term and
-- the number of slots it was bought with. Its places, start and end are read
-- from its grants (internal.slot_package_now): each purchase line is one grant
-- (private.entitlements.package_id), so later parts add grants (slots added
-- part-way, renewals) and a team (keyed by the package) without changing this
-- row, which never changes.
create table if not exists private.slot_packages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  term_days integer not null check (term_days in (30, 90, 180)),
  slot_count integer not null check (slot_count between 5 and 250),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.slot_packages enable row level security;
revoke all on private.slot_packages from public, anon, authenticated, service_role;
create index if not exists slot_packages_owner_idx on private.slot_packages (owner_id, created_at);

-- One line holds every slot of a package purchase (a slot of an Individual
-- order stays one line each).
alter table private.payment_lines add column if not exists slot_count integer not null default 1;
alter table private.entitlements add column if not exists package_id uuid;
do $$begin
  if not exists(select 1 from pg_catalog.pg_constraint where conname='payment_lines_slot_count_check'
      and conrelid='private.payment_lines'::regclass) then
    alter table private.payment_lines add constraint payment_lines_slot_count_check
      check (slot_count between 1 and 250);
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_package_id_fkey'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_package_id_fkey
      foreign key (package_id) references private.slot_packages (id) on delete restrict;
  end if;
  -- A package's grant is a paid line.
  if not exists(select 1 from pg_catalog.pg_constraint where conname='entitlements_package_grant'
      and conrelid='private.entitlements'::regclass) then
    alter table private.entitlements add constraint entitlements_package_grant
      check (package_id is null or (source = 'retail_paid' and payment_line_id is not null));
  end if;
end$$;
create index if not exists entitlements_package_idx on private.entitlements (package_id) where package_id is not null;
-- The packages running now (the sweep), by end date.
create index if not exists entitlements_package_ends_idx on private.entitlements (ends_at)
  where package_id is not null and status = 'active';
-- The posts a member holds now (a package counts the posts of its owner's
-- ended Individual slots it takes).
create index if not exists post_activations_owner_held_idx on private.post_activations (owner_id)
  where released_at is null;

-- A package row never changes; a package changes by gaining grants.
create or replace function internal.slot_package_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  raise exception 'a package never changes; its slots and dates are its grants' using errcode='23514';
end;
$$;
alter function internal.slot_package_guard() owner to postgres;
revoke all on function internal.slot_package_guard() from public, anon, authenticated, service_role;
drop trigger if exists slot_packages_immutable on private.slot_packages;
create trigger slot_packages_immutable before update on private.slot_packages
  for each row execute function internal.slot_package_guard();

-- The Multi-listing package terms.
create or replace function internal.slot_package_plan(p_code text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $$
  select coalesce(p_code in ('slot_package_30d','slot_package_90d','slot_package_180d'), false);
$$;
alter function internal.slot_package_plan(text) owner to postgres;
revoke all on function internal.slot_package_plan(text) from public, anon, authenticated, service_role;

-- Whether packages are on sale (the owner's switch; off unless switched on).
create or replace function internal.slot_packages_on_sale()
returns boolean
language sql
stable
set search_path to 'pg_catalog'
as $$
  select coalesce((select s.on_sale from private.slot_package_sales s where s.singleton), false);
$$;
alter function internal.slot_packages_on_sale() owner to postgres;
revoke all on function internal.slot_packages_on_sale() from public, anon, authenticated, service_role;

-- The end of a slot's unbroken run of paid periods: the body
-- internal.slot_chain_end had before this update (20261114093742).
create or replace function internal.slot_chain_paid_end(p_entitlement uuid)
returns timestamptz
language sql
stable
set search_path to 'pg_catalog'
as $$
  with recursive run(id, ends_at, chain) as (
    select e.id, e.ends_at, coalesce(e.slot_id, e.id) from private.entitlements e where e.id=p_entitlement
    union all
    select n.id, n.ends_at, run.chain from run join private.entitlements n
      on n.slot_id=run.chain and n.status='active' and n.starts_at<=run.ends_at and n.ends_at>run.ends_at
  )
  select max(run.ends_at) from run;
$$;
alter function internal.slot_chain_paid_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_paid_end(uuid) from public, anon, authenticated, service_role;

-- The owner's package running now, from its grants that run now (paid, and the
-- account can use them): its places, the posts that may go live in a rolling
-- 30 days (4 per place), and the start and end of its current term. At most
-- one package per account runs (checkout and delivery keep it so). PL/pgSQL so
-- its plan is kept between calls: post reads call it for every post a package
-- takes.
create or replace function internal.slot_package_now(p_owner uuid)
returns table(package_id uuid, places integer, new_posts_limit integer, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
set search_path to 'pg_catalog'
as $$
#variable_conflict use_column
begin
  return query
    select e.package_id, sum(e.slot_capacity)::integer, sum(e.activations_per_period)::integer,
      min(e.starts_at), max(e.ends_at)
    from private.entitlements e
    where e.owner_id = p_owner and e.package_id is not null and e.status = 'active'
      and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      and exists(select 1 from private.payments pay where pay.id = e.payment_id and pay.owner_id = e.owner_id
        and pay.status = 'complete')
      -- the account can use it (checked once, not per grant)
      and exists(select 1 from private.current_account_access u where u.id = p_owner)
    group by e.package_id
    order by max(e.ends_at) desc, e.package_id
    limit 1;
end;
$$;
alter function internal.slot_package_now(uuid) owner to postgres;
revoke all on function internal.slot_package_now(uuid) from public, anon, authenticated, service_role;

-- The posts in a package: activations not released on any of its grants.
create or replace function internal.slot_package_posts(p_package uuid)
returns integer
language sql
stable
set search_path to 'pg_catalog'
as $$
  select count(*)::integer from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id
  where a.released_at is null and c.package_id = p_package;
$$;
alter function internal.slot_package_posts(uuid) owner to postgres;
revoke all on function internal.slot_package_posts(uuid) from public, anon, authenticated, service_role;

-- E3: the posts of the package owner's Individual slots whose paid run ended
-- while the package runs and that still hold their slot, in the order they
-- take the package's free places (the slot that ended first goes first). A
-- post is taken while place_rank <= places - posts in the package; the sweep
-- then moves it in (internal.run_slot_renewals).
create or replace function internal.slot_package_waiting(p_package uuid)
returns table(activation_id uuid, post_id uuid, entitlement_id uuid, slot_chain uuid, ended_at timestamptz,
  place_rank bigint)
language plpgsql
stable
set search_path to 'pg_catalog'
as $$
#variable_conflict use_column
declare v_owner uuid; v_since timestamptz;
begin
  select p.owner_id into v_owner from private.slot_packages p where p.id = p_package;
  select n.starts_at into v_since from internal.slot_package_now(v_owner) n where n.package_id = p_package;
  if v_since is null then
    return;
  end if;
  -- The owner's posts still held in an Individual slot whose own period has
  -- ended (an index read of the posts they hold); the slot's paid run is
  -- followed only for those.
  return query
    select w.id, w.post_id, w.entitlement_id, w.chain, w.ended_at,
      row_number() over (order by w.ended_at, w.id)
    from (
      select a.id, a.post_id, a.entitlement_id, coalesce(x.slot_id, x.id) as chain,
        internal.slot_chain_paid_end(x.id) as ended_at
      from private.post_activations a
        join private.entitlements x on x.id = a.entitlement_id
        join private.payment_lines l on l.id = x.payment_line_id
        join private.plan_versions v on v.id = l.plan_version_id
      where a.owner_id = v_owner and a.released_at is null and a.post_id is not null
        and x.package_id is null and x.source = 'retail_paid' and x.status = 'active' and x.owner_id = v_owner
        and x.ends_at <= statement_timestamp() and internal.individual_slot_plan(v.plan_code)
      offset 0
    ) w
    where w.ended_at <= statement_timestamp() and w.ended_at > v_since;
end;
$$;
alter function internal.slot_package_waiting(uuid) owner to postgres;
revoke all on function internal.slot_package_waiting(uuid) from public, anon, authenticated, service_role;

-- E3: the end of the owner's package when it takes the post of this ended
-- Individual slot (see internal.slot_package_waiting); null otherwise.
create or replace function internal.slot_package_takeover_end(p_entitlement uuid)
returns timestamptz
language plpgsql
stable
set search_path to 'pg_catalog'
as $$
declare v_owner uuid; v_chain uuid; v_package uuid; v_places integer; v_ends timestamptz; v_rank bigint;
begin
  select e.owner_id, coalesce(e.slot_id, e.id) into v_owner, v_chain from private.entitlements e
    where e.id = p_entitlement and e.package_id is null and e.source = 'retail_paid';
  if v_owner is null then
    return null;
  end if;
  select n.package_id, n.places, n.ends_at into v_package, v_places, v_ends from internal.slot_package_now(v_owner) n;
  if v_package is null then
    return null;
  end if;
  select min(w.place_rank) into v_rank from internal.slot_package_waiting(v_package) w where w.slot_chain = v_chain;
  if v_rank is null or v_rank > v_places - internal.slot_package_posts(v_package) then
    return null;
  end if;
  return v_ends;
end;
$$;
alter function internal.slot_package_takeover_end(uuid) owner to postgres;
revoke all on function internal.slot_package_takeover_end(uuid) from public, anon, authenticated, service_role;

-- Whether the account has a package that has not ended (one at a time).
create or replace function internal.slot_package_open(p_owner uuid)
returns boolean
language sql
stable
set search_path to 'pg_catalog'
as $$
  select exists(select 1 from private.entitlements e
    where e.owner_id = p_owner and e.package_id is not null and e.status = 'active'
      and e.ends_at > statement_timestamp());
$$;
alter function internal.slot_package_open(uuid) owner to postgres;
revoke all on function internal.slot_package_open(uuid) from public, anon, authenticated, service_role;

-- E3: while a package of the person (any of their accounts) runs, no
-- Individual slot is bought or renewed; in the package's last 7 days it can
-- be (owner's decision 11: going below 5 slots).
create or replace function internal.slot_package_blocks_individual(p_identity text, p_owner uuid)
returns boolean
language sql
stable
set search_path to 'pg_catalog'
as $$
  select exists(select 1 from private.entitlements e
    where e.owner_id in (select internal.individual_slot_owners(p_identity, p_owner))
      and e.package_id is not null and e.status = 'active' and e.starts_at <= statement_timestamp()
      and e.ends_at > statement_timestamp() + interval '7 days');
$$;
alter function internal.slot_package_blocks_individual(text,uuid) owner to postgres;
revoke all on function internal.slot_package_blocks_individual(text,uuid) from public, anon, authenticated, service_role;

-- E3: the search documents of the owner's posts in Individual slots that end
-- before the package move to the package's end, so a post the package takes
-- when its slot ends stays in search and on its page at the boundary, before
-- any job runs. This changes no shown date (those follow the post's funding)
-- and lets nothing through: search and the post page also need the post to be
-- funded at read time (private.public_eligible_posts), and the lifecycle job
-- hides a post its slot no longer funds.
create or replace function internal.refresh_package_documents(p_package uuid)
returns integer
language plpgsql
set search_path to 'pg_catalog'
as $$
declare owner uuid; ends timestamptz; changed integer;
begin
  select p.owner_id into owner from private.slot_packages p where p.id = p_package;
  select k.ends_at into ends from internal.slot_package_now(owner) k where k.package_id = p_package;
  if ends is null then return 0; end if;
  update private.post_search_documents s set visible_until = ends
  from private.post_activations a
    join private.entitlements x on x.id = a.entitlement_id
    join private.payment_lines l on l.id = x.payment_line_id
    join private.plan_versions v on v.id = l.plan_version_id
  where s.post_id = a.post_id and a.owner_id = owner and a.released_at is null
    and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
    and internal.individual_slot_plan(v.plan_code)
    and s.is_visible and s.kind <> 'event' and s.visible_until < ends;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
alter function internal.refresh_package_documents(uuid) owner to postgres;
revoke all on function internal.refresh_package_documents(uuid) from public, anon, authenticated, service_role;

-- The run end of a slot, as every post read uses it (the public view, the
-- restorable view, post funding, the kept activation, the shown end date, the
-- search documents): the end of its unbroken run of paid periods, or, once
-- that has ended, the end of the owner's Multi-listing package when the
-- package takes its post (E3, internal.slot_package_takeover_end), so the post
-- never drops out at the boundary, before any job runs.
create or replace function internal.slot_chain_end(p_entitlement uuid)
returns timestamptz
language sql
stable
set search_path to 'pg_catalog'
as $$
  select case when r.paid_end > statement_timestamp() then r.paid_end
    else coalesce(internal.slot_package_takeover_end(p_entitlement), r.paid_end) end
  from (select internal.slot_chain_paid_end(p_entitlement) as paid_end) r;
$$;
alter function internal.slot_chain_end(uuid) owner to postgres;
revoke all on function internal.slot_chain_end(uuid) from public;

-- A slot's posts (a post waiting to move to the slot's next period fills it);
-- for a package, the posts in it and the posts of its owner's ended
-- Individual slots it takes.
create or replace function internal.slot_posts_held(p_entitlement uuid)
returns integer
language sql
stable
set search_path to 'pg_catalog'
as $$
  select coalesce((select case when t.package_id is null then
      (select count(*)::integer from private.post_activations a
        where a.released_at is null and a.entitlement_id in (select c.id from private.entitlements c
          where c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)))
    else (select h.posts + least((select count(*)::integer from internal.slot_package_waiting(t.package_id)),
        greatest(coalesce((select k.places from internal.slot_package_now(t.owner_id) k
          where k.package_id = t.package_id), 0) - h.posts, 0))
      from (select internal.slot_package_posts(t.package_id) as posts) h) end
  from private.entitlements t where t.id = p_entitlement), 0);
$$;
alter function internal.slot_posts_held(uuid) owner to postgres;
revoke all on function internal.slot_posts_held(uuid) from public;

-- Posts going live since p_since over every period of a slot (a renewal does
-- not restart the count), or over every grant of a package (decision 10: the
-- 4 per place per 30 days count across the whole package); a submission that
-- review rejected does not count, nor a post moved on (continued).
create or replace function internal.slot_posts_started(p_entitlement uuid, p_since timestamptz)
returns integer
language sql
stable
set search_path to 'pg_catalog'
as $$
  select count(*)::integer from private.post_activations a
  where a.activated_at > p_since and a.release_reason is distinct from 'moderation' and not a.continued
    and a.entitlement_id in (
      select c.id from private.entitlements t
        join private.entitlements c on c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)
      where t.id = p_entitlement and t.package_id is null
      union all
      select c.id from private.entitlements t join private.entitlements c on c.package_id = t.package_id
      where t.id = p_entitlement and t.package_id is not null);
$$;
alter function internal.slot_posts_started(uuid,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_posts_started(uuid,timestamp with time zone) from public;

-- 4. Buying a package. The member types the number of slots (5 to 100
-- online) and picks 30, 90 or 180 days; the total is R100 per slot per 30
-- days, at most R10,000 online (more by invoice, PT413). One payment with one
-- line holding every slot. Needs the sales switch (PT403
-- packages_not_on_sale), an accepted ID review (PT412), the "starts now"
-- consent (22023) and the total the member was shown (PT428). One package per
-- account: none while one runs (PT409 package_active). One package order can
-- be open: the same order is continued; another one is cancelled when it was
-- never sent to Ozow, and otherwise returned (continue, check or cancel it).
create or replace function internal.start_package_checkout(p_plan_id uuid, p_slots integer,
  p_expected_total_cents bigint, p_cooling_off_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
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
  if p_slots > 100 or total > 1000000 then
    raise exception 'packages above 100 slots or R10,000 are paid by invoice' using errcode='PT413',
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
$$;
alter function internal.start_package_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_package_checkout(uuid,integer,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.start_package_checkout(uuid,integer,bigint,boolean) to authenticated;

create or replace function api.start_package_checkout(p_plan_id uuid, p_slots integer, p_expected_total_cents bigint,
  p_cooling_off_consent boolean)
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.start_package_checkout(p_plan_id, p_slots, p_expected_total_cents, p_cooling_off_consent);
$$;
alter function api.start_package_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function api.start_package_checkout(uuid,integer,bigint,boolean) from public, anon, authenticated, service_role;
grant execute on function api.start_package_checkout(uuid,integer,bigint,boolean) to authenticated;

-- 5. What is on offer (for the pricing pages and the checkout): whether
-- packages are on sale and their rules; the terms only while on sale. A
-- trusted read for the website's server only (service_role): the browser
-- roles and the publishable key get nothing.
create or replace function internal.get_slot_package_offer()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog'
as $$
  select jsonb_build_object('on_sale', internal.slot_packages_on_sale(),
    'min_slots', 5, 'max_online_slots', 100, 'max_slots', 250, 'online_limit_cents', '1000000',
    'posts_per_slot_per_30_days', 4,
    'plans', case when internal.slot_packages_on_sale() then coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'term_days', v.duration_days, 'price_cents_per_slot', v.price_cents::text, 'label', v.label)
        order by v.duration_days)
      from private.plan_versions v
      where internal.slot_package_plan(v.plan_code) and v.retired_at is null
        and v.version = (select max(x.version) from private.plan_versions x
          where x.plan_code = v.plan_code and x.retired_at is null)), '[]'::jsonb) else '[]'::jsonb end);
$$;
alter function internal.get_slot_package_offer() owner to postgres;
revoke all on function internal.get_slot_package_offer() from public, anon, authenticated, service_role;
grant execute on function internal.get_slot_package_offer() to service_role;

create or replace function api.get_slot_package_offer()
returns jsonb
language sql
stable
set search_path to 'pg_catalog'
as $$
  select internal.get_slot_package_offer();
$$;
alter function api.get_slot_package_offer() owner to postgres;
revoke all on function api.get_slot_package_offer() from public, anon, authenticated, service_role;
grant execute on function api.get_slot_package_offer() to service_role;

-- 6. The member's package ("My slots" and the checkout): the latest package of
-- the account that runs or ended in the last 3 days, its places, the posts in
-- it (and the posts of ended Individual slots it takes, `moving`), its end and
-- its fair-use count; whether the member could buy one now, and until when
-- Individual slots cannot be bought or renewed (E3). Nothing of another
-- account.
create or replace function internal.get_my_slot_package()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); verified text; pkg private.slot_packages; k record;
  latest_end timestamptz; result jsonb;
begin
  verified := internal.current_verified_identity(actor);
  select p.* into pkg from private.slot_packages p
    where p.owner_id = actor and exists(select 1 from private.entitlements e
      join private.payments pay on pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'
      where e.package_id = p.id and e.status = 'active' and e.ends_at > statement_timestamp() - interval '3 days')
    order by p.created_at desc, p.id limit 1;
  select n.* into k from internal.slot_package_now(actor) n where n.package_id = pkg.id;
  select max(e.ends_at) into latest_end from private.entitlements e
    where e.package_id = pkg.id and e.status = 'active';
  select jsonb_build_object(
    'verified', verified is not null,
    'on_sale', internal.slot_packages_on_sale(),
    'can_buy', internal.slot_packages_on_sale() and verified is not null and not internal.slot_package_open(actor),
    'individual_blocked_until', (select max(e.ends_at) - interval '7 days' from private.entitlements e
      where e.owner_id in (select internal.individual_slot_owners(coalesce(verified,
          internal.individual_slot_identity(actor)), actor))
        and e.package_id is not null and e.status = 'active' and e.starts_at <= statement_timestamp()
        and e.ends_at > statement_timestamp() + interval '7 days'),
    'package', case when pkg.id is null then null else jsonb_build_object(
      'id', pkg.id, 'term_days', pkg.term_days, 'slots_bought', pkg.slot_count,
      'state', case when k.package_id is not null then 'active' else 'ended' end,
      'places', coalesce(k.places, 0),
      'starts_at', coalesce(k.starts_at, (select min(e.starts_at) from private.entitlements e
        where e.package_id = pkg.id and e.status = 'active')),
      'ends_at', coalesce(k.ends_at, latest_end),
      'new_posts_limit', coalesce(k.new_posts_limit, 0),
      -- its grants, which My slots shows as the package rather than as slots
      'grants', coalesce((select jsonb_agg(e.id order by e.starts_at, e.id) from private.entitlements e
        where e.package_id = pkg.id and e.status = 'active'), '[]'::jsonb),
      'new_posts_started', coalesce((select internal.slot_posts_started(e.id,
          statement_timestamp() - make_interval(days => e.activation_period_days))
        from private.entitlements e where e.package_id = pkg.id order by e.ends_at desc, e.id limit 1), 0),
      'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
            'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at, 'moving', x.moving)
            order by x.moving, x.activated_at, x.id)
          from (
            -- the posts in it, and for an ended package the posts it held,
            -- hidden and kept for 3 days
            (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at,
              false as moving
            from private.post_activations a
              join private.entitlements e on e.id = a.entitlement_id
              join private.posts p on p.id = a.post_id
            where e.package_id = pkg.id and p.owner_id = actor and p.edit_of is null
              and (a.released_at is null
                or (k.package_id is null and a.release_reason in ('expired','entitlement_ended')
                  and p.status = 'expired' and p.deletes_at > statement_timestamp()
                  and not exists(select 1 from private.post_activations n where n.post_id = p.id and n.released_at is null)))
            order by p.id, a.activated_at desc)
            union all
            -- the posts of ended Individual slots it takes, before the sweep moves them in
            select p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at, true
            from internal.slot_package_waiting(k.package_id) w
              join private.post_activations a on a.id = w.activation_id
              join private.posts p on p.id = w.post_id
            where k.package_id is not null and p.edit_of is null
              and w.place_rank <= k.places - internal.slot_package_posts(k.package_id)
          ) x), '[]'::jsonb)) end) into result;
  perform internal.price_draft_actor();
  return result;
end;
$$;
alter function internal.get_my_slot_package() owner to postgres;
revoke all on function internal.get_my_slot_package() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_slot_package() to authenticated;

create or replace function api.get_my_slot_package()
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.get_my_slot_package();
$$;
alter function api.get_my_slot_package() owner to postgres;
revoke all on function api.get_my_slot_package() from public, anon, authenticated, service_role;
grant execute on function api.get_my_slot_package() to authenticated;

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
  places integer;
  posts_limit integer;
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
    -- A Multi-listing package's places first (20261114154823, E3): an
    -- Individual slot beside it is often about to end.
    order by (e.package_id is null), e.ends_at, e.id
    for update
  loop
    -- Cursor predicates may predate a row wait; re-read all authority and wall time.
    continue when not internal.entitlement_for_post_eligible(ent.id,post.id,actor);
    any_usable := true;
    if ent.package_id is not null then
      -- A package's places are shared by all its grants: one activation at a
      -- time (the package row). The posts in it and the posts of the owner's
      -- ended Individual slots it takes fill them (internal.slot_posts_held);
      -- the 4 posts going live per place per rolling 30 days count over the
      -- whole package (decision 10), a post moved in not counting.
      perform 1 from private.slot_packages k where k.id = ent.package_id for update;
      select n.places, n.new_posts_limit into places, posts_limit from internal.slot_package_now(ent.owner_id) n
        where n.package_id = ent.package_id;
      continue when places is null;
      continue when internal.slot_posts_held(ent.id) >= places;
      continue when internal.slot_posts_started(ent.id,
        statement_timestamp() - make_interval(days => ent.activation_period_days)) >= posts_limit;
    else
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
    if pkg is not null then
      -- Posts in Individual slots that end before the package stay in search
      -- when the package takes them (E3).
      perform internal.refresh_package_documents(pkg);
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
      if line_count > 0 and fulfillable and exists(select 1 from private.plan_versions v
          where v.id = pay.plan_version_id and internal.slot_package_plan(v.plan_code)) then
        -- A Multi-listing package (20261114154823): one package per account at
        -- a time. A second one's money goes to reconciliation: staff refund
        -- it, or activate it once the first has ended.
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707));
        fulfillable := not internal.slot_package_open(pay.owner_id);
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
      if exists(select 1 from private.plan_versions v
          where v.id = pay.plan_version_id and internal.slot_package_plan(v.plan_code)) then
        -- A Multi-listing package (20261114154823): one package per account
        -- at a time.
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707));
        if internal.slot_package_open(pay.owner_id) then
          raise exception 'the account already has a package; refund this payment, or activate it once that package has ended'
            using errcode='PT409', detail='package_active';
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
  -- E3 (20261114154823): while the person's Multi-listing package runs, posts
  -- use its places; Individual slots can be bought again in its last 7 days.
  if internal.slot_package_blocks_individual(fingerprint, actor) then
    raise exception 'Individual slots cannot be bought while your Multi-listing package runs'
      using errcode='PT409', detail='package_active';
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
  activation private.post_activations; used integer; n_package_moved integer := 0; n_documents integer := 0;
  waiting record; skipped integer; places integer;
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
  -- 1b. Multi-listing packages (20261114154823, E3). Housekeeping only: a
  -- package takes the post of its owner's ended Individual slot at read time
  -- (internal.slot_chain_end). For each package running now, the search
  -- documents of posts in Individual slots ending before it move to its end
  -- (internal.refresh_package_documents), and the posts it takes move in, in
  -- the order they take its free places: the old activation released as
  -- entitlement_ended, the new one continued (not a post going live). Locks
  -- are taken as api.activate_post takes them (the post, then the package's
  -- grants, then the package). A post that cannot be locked keeps its place
  -- in the order (it stays funded at read time), so no post behind it moves
  -- into a place it needs.
  for r in
    select distinct e.package_id, e.owner_id from private.entitlements e
    where e.package_id is not null and e.status = 'active' and e.ends_at > statement_timestamp()
      and e.starts_at <= statement_timestamp()
    order by e.package_id
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    n_documents := n_documents + internal.refresh_package_documents(r.package_id);
    skipped := 0;
    for waiting in select x.activation_id, x.post_id from internal.slot_package_waiting(r.package_id) x
        order by x.place_rank loop
      exit when n_package_moved >= p_limit;
      select * into post from private.posts p where p.id = waiting.post_id for update skip locked;
      if not found then
        skipped := skipped + 1;
        continue;
      end if;
      select * into activation from private.post_activations a where a.id = waiting.activation_id and a.released_at is null
        and a.post_id = post.id;
      continue when not found;
      perform 1 from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
        order by e.ends_at, e.id for update;
      perform 1 from private.slot_packages k where k.id = r.package_id for update;
      select n.places into places from internal.slot_package_now(r.owner_id) n where n.package_id = r.package_id;
      exit when places is null or internal.slot_package_posts(r.package_id) + skipped >= places;
      select * into next_grant from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
        and e.starts_at <= clock_timestamp() and e.ends_at > clock_timestamp() order by e.ends_at desc, e.id limit 1;
      -- Recheck under the locks: the slot's paid run has ended (no renewal
      -- followed on) and the package may carry the post.
      if not found or coalesce(internal.slot_chain_paid_end(activation.entitlement_id) > clock_timestamp(), false)
          or not internal.entitlement_for_post_eligible(next_grant.id, post.id, post.owner_id) then
        skipped := skipped + 1;
        continue;
      end if;
      update private.post_activations set released_at=clock_timestamp(), release_reason='entitlement_ended'
        where id=activation.id;
      insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
        values (post.id, next_grant.id, post.owner_id, clock_timestamp(), true);
      n_package_moved := n_package_moved + 1;
    end loop;
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
  return jsonb_build_object('moved', n_moved, 'reminders', n_reminders, 'package_moved', n_package_moved,
    'package_documents', n_documents);
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
  -- A Multi-listing package's team belongs to the package, not to one of its
  -- grants (20261114154823): it is never added here.
  if not found or ent.slot_capacity<2 or ent.source<>'retail_paid' or ent.status<>'active' or ent.ends_at<=clock_timestamp()
    or ent.package_id is not null
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

commit;
