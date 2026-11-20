-- Multi-listing packages: add slots part-way through a package (roadmap P4b;
-- the owner's decision D1 of 19 November 2026).
--
-- It needs 20261114154823_slot_packages.sql, 20261119025106_package_invoices.sql
-- and 20261119151152_package_gap_fixes.sql. Order: apply-first. It adds three
-- member commands (api.get_my_package_add_offer,
-- api.start_package_add_checkout, api.request_package_add_invoice); no
-- command, argument or grant is removed or changed, and no field is added to
-- an answer the website reads strictly except for an added-slots invoice
-- request, which cannot exist while packages are off sale. It refuses with
-- 55000 unless the six functions it adds are absent (or this update's), the
-- twelve it replaces have their reviewed bodies (or this update's) and
-- private.package_invoice_requests has no column `kind` (or this update's).
-- Packages stay off sale (private.slot_package_sales is not touched): every
-- new command refuses with PT403 packages_not_on_sale until the owner switches
-- them on. In one transaction it:
--
-- 1. Prices an add (internal.slot_package_add_quote): the account's running
--    package, its term's catalogue row on sale (internal.slot_package_term_plan,
--    R100 per slot per 30 days), and the whole 24-hour periods left in it,
--    rounded down. One added slot costs the term's price x days left / term
--    days, rounded to the cent; an add of n slots costs n times that (so an
--    invoice keeps "slots x unit price = total"). Added slots start on payment
--    and end with the package, always. A package holds at most 250 slots.
-- 2. Adds slots online. api.start_package_add_checkout(p_package_id, p_slots,
--    p_expected_total_cents, p_cooling_off_consent): needs the switch on
--    (PT403), an accepted ID review (PT412), the "my added slots start now"
--    box (22023; kept in the payment's snapshot as
--    package-add-starts-now-v1), the package still running (PT409
--    package_ended) with 7 or more whole days left (PT409
--    package_add_too_late), 1 slot or more and at most 250 in all (22023
--    package_slots_invalid), at most 100 in all and a total within the online
--    payment limit (PT413 package_invoice_required), the total shown (PT428)
--    and no unpaid package invoice (PT409 package_invoice_unpaid). One
--    payment with one line holding every added slot (snapshot category
--    `slot_package_add` naming the package). The same order within 30 minutes
--    is continued; an unsent order otherwise is replaced; one already open at
--    Ozow is returned to continue, check or cancel. The price holds 30
--    minutes: internal.claim_checkout_request (replaced) does not send an
--    older unsent order to Ozow (PT409 package_add_price_expired), nor one
--    whose package has ended (PT409 package_ended) or has fewer than 7 days
--    left (PT409 package_add_too_late).
-- 3. Adds slots by invoice (D1). api.request_package_add_invoice(p_package_id,
--    p_slots, p_expected_total_cents, p_cooling_off_consent, p_request_id):
--    the package invoice request (private.package_invoice_requests) gains
--    `kind` ('package' or 'add'), the package and the days left it was priced
--    for; asked only while 10 or more whole days are left (PT409
--    package_add_invoice_too_late), at the price of that moment, which the
--    invoice keeps. The same rules as the online add otherwise, with the
--    existing request rules (one open request, repeats, 10 a day). Staff issue,
--    approve (above R50,000) or decline it in the existing queue:
--    internal.package_invoice_issue_check and
--    internal.issue_package_customer_invoice (replaced) issue it only while
--    the package runs with 7 or more days left and has room, at the price
--    asked for ("Multi-listing package: <n> slots added for <d> days").
-- 4. Delivers an add, however it is paid, only while the package it was
--    bought for still runs and has room (internal.slot_package_add_ok): the
--    Ozow notice (internal.apply_provider_event), staff activation
--    (internal.activate_staff_paid_payment), Pay now
--    (internal.start_invoice_payment) and a bank transfer
--    (internal.record_staff_invoice_transfer,
--    internal.confirm_staff_invoice_payment), all replaced. Money that
--    arrives after the package ended is not delivered: an Ozow payment goes to
--    reconciliation and staff refund it in full; Pay now and a bank transfer
--    are refused (PT409 package_ended) and staff void the invoice and return
--    the money. internal.issue_slot_line_entitlements (replaced) issues the
--    add as a further grant of the package (package_id), from payment to the
--    package's end, with 4 new posts per added slot per 30 days.
-- 5. Refunds. An add is its own payment line, refunded on its own with the
--    existing refund tools (its commission reversed with it). When a package
--    grant is revoked (internal.slot_package_grant_revoked, replaced) the
--    posts in it that still fit in the package's other running grants stay in
--    the package, the most recently approved first (new
--    internal.slot_package_keep_posts); the reversal ends only the others, as
--    before. It never stops a refund or chargeback.
--
-- Read-only preflight: ../preflight/20261120045404_package_add_slots.check.sql.
-- Rollback: ../rollback/20261120045404_package_add_slots.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the functions this update adds are absent (or this update's)
-- and the ones it replaces have their reviewed bodies (or this update's).
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.slot_package_term_plan(integer)'),
      ('internal.slot_package_add_quote(uuid)'),
      ('internal.slot_package_add_ok(uuid,uuid,integer)'),
      ('internal.package_add_invoice_package(uuid)'),
      ('internal.slot_package_keep_posts(uuid)'),
      ('internal.get_my_package_add_offer()'),
      ('internal.start_package_add_checkout(uuid,integer,bigint,boolean)'),
      ('internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)'),
      ('api.get_my_package_add_offer()'),
      ('api.start_package_add_checkout(uuid,integer,bigint,boolean)'),
      ('api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid)'),
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
      ('internal.confirm_staff_invoice_payment(uuid)')) v(sig)
  loop
    if shape not in (
        -- each: absent or its reviewed body, then this update's body
        'internal.slot_package_term_plan(integer) absent',
        'internal.slot_package_term_plan(integer) 0d8726c18c52a84d92c5badfddc10482',
        'internal.slot_package_add_quote(uuid) absent',
        'internal.slot_package_add_quote(uuid) 233e14908c1d2b21b17a9205da371a77',
        'internal.slot_package_add_ok(uuid,uuid,integer) absent',
        'internal.slot_package_add_ok(uuid,uuid,integer) 27fc89e79b7b625096fe2219fd567aaa',
        'internal.package_add_invoice_package(uuid) absent',
        'internal.package_add_invoice_package(uuid) 1c6cab90a756caa366bb753b0af5b18e',
        'internal.slot_package_keep_posts(uuid) absent',
        'internal.slot_package_keep_posts(uuid) f02b6d4a487a0bf83b9a22afb7d0fb9a',
        'internal.get_my_package_add_offer() absent',
        'internal.get_my_package_add_offer() f605a9652ebaaaba2aad1a2080f52d6b',
        'internal.start_package_add_checkout(uuid,integer,bigint,boolean) absent',
        'internal.start_package_add_checkout(uuid,integer,bigint,boolean) 59df4cce4fd43a0302efc281933a7ca7',
        'internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) absent',
        'internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) ea74ccfc168e27e7d3f087063c40ce6b',
        'api.get_my_package_add_offer() absent',
        'api.get_my_package_add_offer() 4b7a12f241f9fdc5ec61545eaac6fa2b',
        'api.start_package_add_checkout(uuid,integer,bigint,boolean) absent',
        'api.start_package_add_checkout(uuid,integer,bigint,boolean) 3be278362296fc2ec9cc5fdfbb256593',
        'api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) absent',
        'api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) 6a61e0b25fc1600829ac3c13f1d22a67',
        'internal.issue_slot_line_entitlements(uuid) 3d167ce1ce2bcc4a84480b8ed7888e0a',
        'internal.issue_slot_line_entitlements(uuid) b81aadc5fd06b47c33fc96b81d49b586',
        'internal.apply_provider_event(jsonb) 7f33edbb6bcafaecb519eef80c9b3633',
        'internal.apply_provider_event(jsonb) 3a7487b374df1d1334d007111fd1d97f',
        'internal.activate_staff_paid_payment(uuid,text) 324f8855e844937190754f70c03fcd2e',
        'internal.activate_staff_paid_payment(uuid,text) 369ef2cc3b3a3139cfe83a3e7edb74eb',
        'internal.claim_checkout_request(uuid,uuid) 4922a976d1652603d491349a40f4f7da',
        'internal.claim_checkout_request(uuid,uuid) d8affaf6a98880da473f7707c8a1de4a',
        'internal.slot_package_grant_revoked() 3d22cd9389fa075274e8ba14343e9aea',
        'internal.slot_package_grant_revoked() bf7e9466fba7aae9f5b3b67cd24daffb',
        'internal.package_invoice_request_guard() e41853f9d3e75297df7a4bf00e736792',
        'internal.package_invoice_request_guard() 10402007d059149a498cc3eb64b6b232',
        'internal.package_invoice_request_dto(private.package_invoice_requests,uuid) 16fb4eae547a00d51cf95b55adc16dda',
        'internal.package_invoice_request_dto(private.package_invoice_requests,uuid) d9f8aad4e141beee2e957664cb564908',
        'internal.package_invoice_issue_check(private.package_invoice_requests) e0ae2e35373cba98b3cb385d07871377',
        'internal.package_invoice_issue_check(private.package_invoice_requests) 25ff4d2cd9f12123d0f238ffcfaf558f',
        'internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) 117d33c9a93c2d965e138a7fdc7930b8',
        'internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) 6495b7bce4bc6572b59ad585f8352411',
        'internal.start_invoice_payment(text,bigint,boolean) a43e58e5ebc85179c901428e4f0f805e',
        'internal.start_invoice_payment(text,bigint,boolean) 3637cefdf51809d67891104e041d71da',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) e37a32a916640c9a16f5924818b9b735',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 0f3f117b8bed207a401030c3bfb429df',
        'internal.confirm_staff_invoice_payment(uuid) c9adba77f7b7ac7c6366083956e53454',
        'internal.confirm_staff_invoice_payment(uuid) ff40d1c2cf36149d535a4fdb7d99f1bf'
      ) then
      raise exception 'package add slots precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'private.package_invoice_requests'::regclass and a.attname = 'kind' and not a.attisdropped)
    and not exists(select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'private.package_invoice_requests'::regclass and c.conname = 'package_invoice_requests_add') then
    raise exception 'package add slots precondition: private.package_invoice_requests has a column kind of another shape'
      using errcode='55000';
  end if;
end$$;

-- 3. The package invoice request learns what it is for: a new package
-- (`package`, as before) or slots added to the account's running package
-- (`add`: the package, and the whole days left it was priced for). The package
-- is named without a foreign key, as a payment's snapshot names it: the request
-- is kept five tax years, with its invoice, whatever happens to the package
-- record.
alter table private.package_invoice_requests add column if not exists kind text not null default 'package';
alter table private.package_invoice_requests add column if not exists package_id uuid;
alter table private.package_invoice_requests add column if not exists days_left integer;
alter table private.package_invoice_requests drop constraint if exists package_invoice_requests_kind_check;
alter table private.package_invoice_requests add constraint package_invoice_requests_kind_check
  check (kind in ('package', 'add'));
alter table private.package_invoice_requests drop constraint if exists package_invoice_requests_add;
alter table private.package_invoice_requests add constraint package_invoice_requests_add
  check ((kind = 'add') = (package_id is not null) and (kind = 'add') = (days_left is not null)
    and (days_left is null or days_left between 10 and 179));
-- A new package has 5 to 250 slots; an add 1 to 245 (a package holds at most 250).
alter table private.package_invoice_requests drop constraint if exists package_invoice_requests_slots_check;
alter table private.package_invoice_requests add constraint package_invoice_requests_slots_check
  check ((kind = 'package' and slots >= 5 and slots <= 250) or (kind = 'add' and slots >= 1 and slots <= 245));

-- 1. The package term's catalogue row on sale: the latest version not retired
-- (as api.get_slot_package_offer lists it). No row when the term is not sold.
create or replace function internal.slot_package_term_plan(p_term_days integer)
 returns setof private.plan_versions
 language sql
 stable
 set search_path to 'pg_catalog'
as $$
  select v.* from private.plan_versions v
  where internal.slot_package_plan(v.plan_code) and v.retired_at is null and v.duration_days = p_term_days
  order by v.version desc, v.created_at desc, v.id
  limit 1;
$$;
alter function internal.slot_package_term_plan(integer) owner to postgres;
revoke all on function internal.slot_package_term_plan(integer) from public;

-- What adding slots to the account's running package costs now: the package,
-- its term, the term's catalogue row (none when it is not sold), the slots it
-- holds now, its end, the whole 24-hour periods left (rounded down) and the
-- price of one added slot for them (the term's price x days left / term days,
-- rounded to the cent). No row when the account has no running package.
create or replace function internal.slot_package_add_quote(p_owner uuid)
 returns table(package_id uuid, term_days integer, plan_id uuid, places integer, ends_at timestamptz,
   days_left integer, unit_price_cents bigint)
 language plpgsql
 stable
 set search_path to 'pg_catalog'
as $$
declare v_package uuid; v_places integer; v_ends timestamptz; v_term integer; v_days integer;
  v_plan private.plan_versions;
begin
  select n.package_id, n.places, n.ends_at into v_package, v_places, v_ends
    from internal.slot_package_now(p_owner) n;
  if v_package is null then return; end if;
  select k.term_days into v_term from private.slot_packages k where k.id = v_package and k.owner_id = p_owner;
  if v_term is null then return; end if;
  select x.* into v_plan from internal.slot_package_term_plan(v_term) x;
  v_days := floor(extract(epoch from (v_ends - statement_timestamp())) / 86400)::integer;
  return query select v_package, v_term, v_plan.id, v_places, v_ends, v_days,
    case when v_plan.id is null then null::bigint
      else round(v_plan.price_cents::numeric * v_days / v_plan.duration_days)::bigint end;
end;
$$;
alter function internal.slot_package_add_quote(uuid) owner to postgres;
revoke all on function internal.slot_package_add_quote(uuid) from public;

-- 4. An add can be delivered: packages are on sale, the member's ID review is
-- accepted and the package it was bought for still runs with room for the
-- added slots (250 in all).
create or replace function internal.slot_package_add_ok(p_owner uuid, p_package uuid, p_slots integer)
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $$
  select internal.slot_packages_on_sale() and internal.current_verified_identity(p_owner) is not null
    and coalesce((select n.package_id = p_package and n.places + p_slots <= 250
      from internal.slot_package_now(p_owner) n), false);
$$;
alter function internal.slot_package_add_ok(uuid,uuid,integer) owner to postgres;
revoke all on function internal.slot_package_add_ok(uuid,uuid,integer) from public;

-- The package an added-slots invoice adds to (its request names it); null for
-- any other invoice.
create or replace function internal.package_add_invoice_package(p_invoice_id uuid)
 returns uuid
 language sql
 stable
 set search_path to 'pg_catalog'
as $$
  select r.package_id from private.package_invoice_requests r where r.invoice_id = p_invoice_id and r.kind = 'add';
$$;
alter function internal.package_add_invoice_package(uuid) owner to postgres;
revoke all on function internal.package_add_invoice_package(uuid) from public;

-- 5. A package grant was revoked (a refund or chargeback of its line): the
-- posts in it that still fit in the package's other running grants stay in the
-- package, the most recently approved first, each moved as a continued
-- activation (not a post going live) onto the running grant that ends last.
-- Returns how many stayed. The reversal then ends only the others.
create or replace function internal.slot_package_keep_posts(p_grant uuid)
 returns integer
 language plpgsql
 set search_path to 'pg_catalog'
as $$
declare g private.entitlements; target private.entitlements; v_places integer; v_held integer;
  r record; kept integer := 0;
begin
  select * into g from private.entitlements e where e.id = p_grant;
  if g.id is null or g.package_id is null or g.status <> 'revoked' then return 0; end if;
  select n.places into v_places from internal.slot_package_now(g.owner_id) n where n.package_id = g.package_id;
  if v_places is null then return 0; end if;
  select e.* into target from private.entitlements e
    where e.package_id = g.package_id and e.owner_id = g.owner_id and e.status = 'active'
      and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      and exists(select 1 from private.payments pay where pay.id = e.payment_id and pay.owner_id = e.owner_id
        and pay.status = 'complete')
    order by e.ends_at desc, e.slot_capacity desc, e.id
    limit 1;
  if target.id is null then return 0; end if;
  select count(*)::integer into v_held from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id
    where a.released_at is null and c.package_id = g.package_id and c.id <> g.id;
  for r in
    select a.id, a.post_id from private.post_activations a join private.posts p on p.id = a.post_id
    where a.entitlement_id = g.id and a.released_at is null
    order by p.published_at desc nulls last, a.activated_at desc, a.id
  loop
    exit when v_held >= v_places;
    continue when not internal.entitlement_for_post_eligible(target.id, r.post_id, g.owner_id);
    update private.post_activations set released_at = clock_timestamp(), release_reason = 'entitlement_ended'
      where id = r.id;
    insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
      values (r.post_id, target.id, g.owner_id, clock_timestamp(), true);
    v_held := v_held + 1;
    kept := kept + 1;
  end loop;
  return kept;
end;
$$;
alter function internal.slot_package_keep_posts(uuid) owner to postgres;
revoke all on function internal.slot_package_keep_posts(uuid) from public;

-- The member's "Add slots" page: whether packages are on sale, their ID
-- review, the online payment limit and, for their running package, its slots,
-- end, the whole days left, the price of one added slot for them, the most
-- slots that can still be added, whether an add is open online (7 or more days
-- left) and by invoice (10 or more), whether a package invoice is unpaid,
-- their latest added-slots invoice request for this package and the slots
-- added to it so far.
create or replace function internal.get_my_package_add_offer()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); q record; request private.package_invoice_requests;
  result jsonb;
begin
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is not null then
    select r.* into request from private.package_invoice_requests r
      where r.account_id = actor and r.kind = 'add' and r.package_id = q.package_id
      order by r.requested_at desc, r.id limit 1;
  end if;
  result := jsonb_build_object(
    'on_sale', internal.slot_packages_on_sale(),
    'verified', internal.current_verified_identity(actor) is not null,
    'online_limit_cents', internal.online_payment_max_cents()::text,
    'package', case when q.package_id is null then null else jsonb_build_object(
      'id', q.package_id, 'term_days', q.term_days, 'places', q.places, 'ends_at', q.ends_at,
      'days_left', q.days_left, 'unit_price_cents', q.unit_price_cents::text,
      'max_slots', greatest(250 - q.places, 0),
      'max_online_slots', greatest(100 - q.places, 0),
      'online_open', q.days_left >= 7 and q.plan_id is not null,
      'invoice_open', q.days_left >= 10 and q.plan_id is not null,
      'invoice_unpaid', exists(select 1 from private.customer_invoices i
        join private.plan_versions v on v.id = i.plan_version_id
        where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)),
      'request', case when request.id is null then null
        else internal.package_invoice_request_dto(request, null) end,
      -- the slots added to it so far (paid and delivered), newest first
      'adds', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'slots', x.slots,
          'paid_at', x.completed_at) order by x.completed_at desc, x.id)
        from (select p.id, l.slot_count as slots, p.completed_at from private.payments p
            join private.payment_lines l on l.payment_id = p.id and l.line_number = 1
          where p.owner_id = actor and p.status = 'complete' and p.fulfillment_status = 'fulfilled'
            and p.snapshot->>'category' = 'slot_package_add' and p.snapshot->>'package_id' = q.package_id::text
          order by p.completed_at desc, p.id limit 20) x), '[]'::jsonb)) end);
  perform internal.price_draft_actor(); -- final live owner/session check
  return result;
end;
$$;
alter function internal.get_my_package_add_offer() owner to postgres;
revoke all on function internal.get_my_package_add_offer() from public;
grant execute on function internal.get_my_package_add_offer() to authenticated;

-- 2. Adding slots online: one payment with one line holding every added slot.
create or replace function internal.start_package_add_checkout(p_package_id uuid, p_slots integer,
    p_expected_total_cents bigint, p_cooling_off_consent boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); q record; plan private.plan_versions; pay private.payments;
  total bigint; open_slots integer;
begin
  if p_package_id is null or p_slots is null or p_expected_total_cents is null then
    raise exception 'package, number of slots and total required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before payment' using errcode='22023';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you add slots' using errcode='PT412';
  end if;
  -- This account, then its package, as the package checkout locks them.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is distinct from p_package_id then
    raise exception 'this package has ended' using errcode='PT409', detail='package_ended';
  end if;
  if q.days_left < 7 then
    raise exception 'slots can be added while 7 or more days of the package are left'
      using errcode='PT409', detail='package_add_too_late';
  end if;
  select v.* into plan from private.plan_versions v where v.id = q.plan_id;
  if not found then
    raise exception 'this package term is not on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  if p_slots < 1 or q.places + p_slots > 250 then
    raise exception 'a package holds at most 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  total := q.unit_price_cents * p_slots;
  -- More than 100 slots in all, or above the most Ozow accepts in one payment:
  -- by invoice.
  if q.places + p_slots > 100 or total > internal.online_payment_max_cents() then
    raise exception 'adds above 100 slots in all or the online payment limit of % cents are paid by invoice',
      internal.online_payment_max_cents() using errcode='PT413', detail='package_invoice_required';
  end if;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
  end if;
  if exists(select 1 from private.customer_invoices i join private.plan_versions v on v.id = i.plan_version_id
      where i.account_id = actor and i.status = 'issued' and internal.slot_package_plan(v.plan_code)) then
    raise exception 'your package invoice is not paid yet; pay it, or ask us to cancel it first'
      using errcode='PT409', detail='package_invoice_unpaid';
  end if;
  -- One package order open at a time (a new package or an add; an invoice's
  -- own Pay now attempts are the invoice's).
  select p.* into pay from private.payments p join private.plan_versions v on v.id = p.plan_version_id
    where p.owner_id = actor and p.status = 'pending' and p.target_post_id is null
      and internal.slot_package_plan(v.plan_code)
      and not exists(select 1 from private.customer_invoice_payments l where l.payment_id = p.id)
    order by p.created_at desc, p.id limit 1
    for update of p;
  if found then
    select l.slot_count into open_slots from private.payment_lines l where l.payment_id = pay.id and l.line_number = 1;
    if pay.checkout_url is not null then
      -- Open at Ozow: the member continues, checks or cancels it first.
      perform internal.price_draft_actor();
      return jsonb_build_object('payment_id', pay.id, 'merchant_reference', pay.merchant_reference,
        'amount_cents', pay.amount_cents::text, 'currency', pay.currency, 'status', pay.status,
        'slots', open_slots, 'package', true, 'reused', true);
    elsif pay.checkout_claim_until > clock_timestamp() then
      raise exception 'checkout is being created' using errcode='PT409';
    end if;
    if not (pay.snapshot->>'category' = 'slot_package_add' and pay.snapshot->>'package_id' = p_package_id::text
        and open_slots = p_slots and pay.amount_cents = total
        and pay.created_at > statement_timestamp() - interval '30 minutes') then
      -- Never sent to Ozow, so it can never be paid: replaced.
      update private.payments set status = 'cancelled', status_changed_at = clock_timestamp() where id = pay.id;
      pay := null;
    end if;
  end if;
  if pay.id is null then
    insert into private.payments (owner_id, product_kind, plan_version_id, amount_cents, currency, snapshot)
    values (actor, 'plan', plan.id, total, plan.currency, jsonb_build_object('kind', 'plan',
        'category', 'slot_package_add', 'package_id', q.package_id,
        'code', plan.plan_code, 'version', plan.version, 'label', plan.label, 'area', plan.area,
        'price_cents', plan.price_cents, 'unit_price_cents', q.unit_price_cents, 'days_left', q.days_left,
        'package_ends_at', q.ends_at, 'slots', p_slots, 'total_cents', total,
        'duration_days', plan.duration_days, 'slot_capacity', p_slots,
        'activations_per_period', plan.activations_per_period * p_slots,
        'activation_period_days', plan.activation_period_days,
        'max_photos', plan.max_photos, 'max_videos', plan.max_videos,
        'addon_capabilities', to_jsonb(plan.addon_capabilities),
        'invoice_description', 'Multi-listing package: ' || p_slots::text
          || case when p_slots = 1 then ' slot' else ' slots' end || ' added for ' || q.days_left::text || ' days',
        'cooling_off_consent', jsonb_build_object('accepted_at', statement_timestamp(),
          'terms_version', (select c.version from private.posting_terms_current c where c.singleton),
          'wording_version', 'package-add-starts-now-v1',
          'wording', 'My added slots start now and end with my package; the 7-day cooling-off does not apply because the service starts immediately')))
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
alter function internal.start_package_add_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function internal.start_package_add_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function internal.start_package_add_checkout(uuid,integer,bigint,boolean) to authenticated;

-- 3. "Ask for an invoice" for added slots (D1): only while 10 or more whole
-- days are left (7 days of use and 3 to pay); the price of this moment is kept.
create or replace function internal.request_package_add_invoice(p_package_id uuid, p_slots integer,
    p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); q record; plan private.plan_versions; total bigint;
  unpaid text; prior private.package_invoice_requests; waiting private.package_invoice_requests;
  made private.package_invoice_requests; consent jsonb := internal.customer_invoice_consent();
begin
  if p_package_id is null or p_slots is null or p_expected_total_cents is null or p_request_id is null then
    raise exception 'package, number of slots, total and request id required' using errcode='22023';
  end if;
  if p_cooling_off_consent is distinct from true then
    raise exception 'cooling-off consent required before asking for an invoice'
      using errcode='22023', detail='invoice_consent_required';
  end if;
  perform internal.lock_evidence_subject(actor);
  if not internal.slot_packages_on_sale() then
    raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
  end if;
  if internal.current_verified_identity(actor) is null then
    raise exception 'your ID review must be accepted before you ask for a package invoice' using errcode='PT412';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
  -- The same request again (a retried submission) returns the first answer.
  select * into prior from private.package_invoice_requests r
    where r.account_id = actor and r.member_request_id = p_request_id;
  if found then
    if prior.kind = 'add' and prior.package_id = p_package_id and prior.slots = p_slots then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(prior, null) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already asked for another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  select x.* into q from internal.slot_package_add_quote(actor) x;
  if q.package_id is distinct from p_package_id then
    raise exception 'this package has ended' using errcode='PT409', detail='package_ended';
  end if;
  if q.days_left < 10 then
    raise exception 'slots are added by invoice while 10 or more days of the package are left'
      using errcode='PT409', detail='package_add_invoice_too_late';
  end if;
  select v.* into plan from private.plan_versions v where v.id = q.plan_id;
  if not found then
    raise exception 'this package term is not on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  if p_slots < 1 or q.places + p_slots > 250 then
    raise exception 'a package holds at most 250 slots' using errcode='22023', detail='package_slots_invalid';
  end if;
  total := q.unit_price_cents * p_slots;
  if total <> p_expected_total_cents then
    raise exception 'the price changed; check the total again' using errcode='PT428';
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
    if waiting.kind = 'add' and waiting.package_id = p_package_id and waiting.slots = p_slots
        and waiting.unit_price_cents = q.unit_price_cents then
      perform internal.price_draft_actor();
      return internal.package_invoice_request_dto(waiting, null) || jsonb_build_object('repeated', true);
    end if;
  end if;
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
      unit_price_cents, total_cents, consent_at, consent_version, consent_terms_version, kind, package_id, days_left)
    values (actor, p_request_id, plan.id, plan.duration_days, p_slots, q.unit_price_cents, total, statement_timestamp(),
      consent->>'version', (select c.version from private.posting_terms_current c where c.singleton),
      'add', q.package_id, q.days_left)
    returning * into made;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.package_invoice_request_dto(made, null) || jsonb_build_object('repeated', false);
end;
$$;
alter function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function internal.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;

create or replace function api.get_my_package_add_offer()
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $$
  select internal.get_my_package_add_offer();
$$;
alter function api.get_my_package_add_offer() owner to postgres;
revoke all on function api.get_my_package_add_offer() from public;
grant execute on function api.get_my_package_add_offer() to authenticated;

create or replace function api.start_package_add_checkout(p_package_id uuid, p_slots integer,
    p_expected_total_cents bigint, p_cooling_off_consent boolean)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $$
  select internal.start_package_add_checkout(p_package_id, p_slots, p_expected_total_cents, p_cooling_off_consent);
$$;
alter function api.start_package_add_checkout(uuid,integer,bigint,boolean) owner to postgres;
revoke all on function api.start_package_add_checkout(uuid,integer,bigint,boolean) from public;
grant execute on function api.start_package_add_checkout(uuid,integer,bigint,boolean) to authenticated;

create or replace function api.request_package_add_invoice(p_package_id uuid, p_slots integer,
    p_expected_total_cents bigint, p_cooling_off_consent boolean, p_request_id uuid)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $$
  select internal.request_package_add_invoice(p_package_id, p_slots, p_expected_total_cents,
    p_cooling_off_consent, p_request_id);
$$;
alter function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) owner to postgres;
revoke all on function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) from public;
grant execute on function api.request_package_add_invoice(uuid,integer,bigint,boolean,uuid) to authenticated;

-- REPLACED-FUNCTIONS

-- REPLACE: internal.issue_slot_line_entitlements

CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0; pkg uuid; add_end timestamptz;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    pkg := null;
    add_end := null;
    if snap->>'category' = 'slot_package_add' then
      -- Slots added part-way (P4b): a further grant of the buyer's running
      -- package holding every added slot, from payment to the package's end.
      pkg := (snap->>'package_id')::uuid;
      if line.slot_count is distinct from (snap->>'slot_capacity')::integer
          or not exists(select 1 from private.plan_versions v where v.id=line.plan_version_id
            and internal.slot_package_plan(v.plan_code))
          or not exists(select 1 from private.slot_packages k where k.id=pkg and k.owner_id=pay.owner_id) then
        raise exception 'an added-slots line holds the slots it was sold with, for the buyer''s package' using errcode='23514';
      end if;
      select max(e.ends_at) into add_end from private.entitlements e
        where e.package_id=pkg and e.owner_id=pay.owner_id and e.status='active'
          and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp();
      if add_end is null then
        raise exception 'the package these slots were added to has ended' using errcode='PT409', detail='package_ended';
      end if;
    elsif exists(select 1 from private.plan_versions v where v.id=line.plan_version_id
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
      coalesce(add_end, starts + make_interval(days => (snap->>'duration_days')::integer)),
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

-- REPLACE: internal.apply_provider_event

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
        if snap->>'category' = 'slot_package_add' then
          -- Slots added part-way (P4b): only to the package they were bought
          -- for while it still runs and has room; otherwise reconciliation,
          -- and staff refund it in full.
          fulfillable := internal.slot_package_add_ok(pay.owner_id, (snap->>'package_id')::uuid,
            (select l.slot_count from private.payment_lines l where l.payment_id = pay.id and l.line_number = 1));
        else
          fulfillable := not internal.slot_package_open(pay.owner_id) and internal.slot_packages_on_sale()
            and internal.current_verified_identity(pay.owner_id) is not null;
        end if;
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

-- REPLACE: internal.activate_staff_paid_payment

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
        if snap->>'category' is distinct from 'slot_package_add' and internal.slot_package_open(pay.owner_id) then
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
        -- Slots added part-way (P4b): only to the package they were bought for
        -- while it still runs and has room.
        if snap->>'category' = 'slot_package_add' and not internal.slot_package_add_ok(pay.owner_id,
            (snap->>'package_id')::uuid,
            (select l.slot_count from private.payment_lines l where l.payment_id = pay.id and l.line_number = 1)) then
          raise exception 'the package these slots were added to has ended or has no room; refund this payment in full'
            using errcode='PT409', detail='package_ended';
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

-- REPLACE: internal.claim_checkout_request

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
    if pay.snapshot->>'category' = 'slot_package_add' then
      -- Slots added part-way (20261120045404): sent only for the running
      -- package they were priced for, with room. An online order holds its
      -- price 30 minutes and needs 7 or more whole days left; an invoice's
      -- Pay now keeps the invoice's price.
      if pay.checkout_url is null then
        if not internal.slot_package_add_ok(pay.owner_id, (pay.snapshot->>'package_id')::uuid,
            (pay.snapshot->>'slot_capacity')::integer) then
          raise exception 'the package these slots were for has ended' using errcode='PT409', detail='package_ended';
        end if;
        if pay.snapshot->>'customer_invoice_id' is null then
          if pay.created_at <= clock_timestamp() - interval '30 minutes' then
            raise exception 'the price of these slots was held for 30 minutes; start again'
              using errcode='PT409', detail='package_add_price_expired';
          end if;
          if coalesce((select q.days_left from internal.slot_package_add_quote(pay.owner_id) q), 0) < 7 then
            raise exception 'slots can be added while 7 or more days of the package are left'
              using errcode='PT409', detail='package_add_too_late';
          end if;
        end if;
      end if;
    elsif pay.checkout_url is null and internal.slot_package_open(pay.owner_id) then
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

-- REPLACE: internal.slot_package_grant_revoked

CREATE OR REPLACE FUNCTION internal.slot_package_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- 20261120045404: the posts in the revoked grant that still fit in the
  -- package's other running grants stay in it (the reversal then ends only the
  -- others); this never stops the refund or chargeback.
  begin
    perform internal.slot_package_keep_posts(new.id);
  exception when others then
    raise warning 'slot package posts not kept after a revoked grant (%)', sqlstate;
  end;
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

-- REPLACE: internal.package_invoice_request_guard

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
      new.consent_terms_version, new.kind, new.package_id, new.days_left)
    is distinct from (old.id, old.account_id, old.member_request_id, old.plan_version_id, old.term_days, old.slots,
      old.unit_price_cents, old.total_cents, old.requested_at, old.consent_at, old.consent_version,
      old.consent_terms_version, old.kind, old.package_id, old.days_left)
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

-- REPLACE: internal.package_invoice_request_dto

CREATE OR REPLACE FUNCTION internal.package_invoice_request_dto(r private.package_invoice_requests, p_staff uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('request_id', r.id, 'status', r.status, 'term_days', r.term_days, 'slots', r.slots,
    'unit_price_cents', r.unit_price_cents, 'total_cents', r.total_cents, 'requested_at', r.requested_at,
    'invoice_number', (select i.invoice_number from private.customer_invoices i where i.id = r.invoice_id),
    'closed_at', r.closed_at)
  -- 20261120045404: an added-slots request says so, with the days it was
  -- priced for and its package's current end (a new package's is unchanged).
  || case when r.kind = 'add' then jsonb_build_object('kind', 'add', 'days_left', r.days_left,
    'package_ends_at', (select max(e.ends_at) from private.entitlements e
      where e.package_id = r.package_id and e.status = 'active')) else '{}'::jsonb end
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

-- REPLACE: internal.package_invoice_issue_check

CREATE OR REPLACE FUNCTION internal.package_invoice_issue_check(r private.package_invoice_requests)
 RETURNS private.plan_versions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare plan private.plan_versions; unpaid text; q record;
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
  if r.kind = 'add' then
    -- Slots added part-way (20261120045404): at the price asked for (D1),
    -- only while the package runs with 7 or more whole days left and room.
    select * into plan from private.plan_versions v where v.id = r.plan_version_id
      and internal.slot_package_plan(v.plan_code);
    if not found then
      raise exception 'this package term is no longer sold; decline the request'
        using errcode='PT409', detail='invoice_plan_unavailable';
    end if;
    select x.* into q from internal.slot_package_add_quote(r.account_id) x;
    if q.package_id is distinct from r.package_id then
      raise exception 'the customer''s package has ended; decline the request'
        using errcode='PT409', detail='package_ended';
    end if;
    if q.days_left < 7 then
      raise exception 'fewer than 7 days of the customer''s package are left; decline the request'
        using errcode='PT409', detail='package_add_too_late';
    end if;
    if q.places + r.slots > 250 then
      raise exception 'the package would hold more than 250 slots; decline the request'
        using errcode='PT409', detail='package_slots_invalid';
    end if;
  else
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

-- REPLACE: internal.issue_package_customer_invoice

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
      p_plan.id, r.slots,
      -- 20261120045404: added slots at the price asked for (D1).
      case when r.kind = 'add' then r.unit_price_cents else p_plan.price_cents end,
      case when r.kind = 'add' then r.total_cents else p_plan.price_cents * r.slots end,
      case when r.kind = 'add'
        then 'Multi-listing package: ' || r.slots::text || case when r.slots = 1 then ' slot' else ' slots' end
          || ' added for ' || r.days_left::text || ' days'
        else 'Multi-listing package: ' || r.slots::text || ' slots × ' || p_plan.duration_days::text || ' days' end,
      issued_on + p_due_days, p_issuer, p_reason, r.id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  return made;
end;
$function$;
alter function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) owner to postgres;
revoke all on function internal.issue_package_customer_invoice(private.package_invoice_requests,private.plan_versions,uuid,integer,text) from public;

-- REPLACE: internal.start_invoice_payment

CREATE OR REPLACE FUNCTION internal.start_invoice_payment(p_invoice_number text, p_expected_total_cents bigint, p_cooling_off_consent boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); inv private.customer_invoices; plan private.plan_versions;
  latest private.payments; other private.payments; pay private.payments; fingerprint text; counted jsonb;
  attempts integer; consent jsonb := internal.customer_invoice_consent(); is_package boolean; add_package uuid;
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
  -- term must still be sold at the invoice's price; or (20261120045404) an
  -- added-slots invoice, at the price asked for (D1).
  add_package := internal.package_add_invoice_package(inv.id);
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and ((v.retired_at is null
        and ((v.is_public and internal.individual_slot_plan(v.plan_code)) or internal.slot_package_plan(v.plan_code))
        and v.price_cents = inv.unit_price_cents)
      or (add_package is not null and internal.slot_package_plan(v.plan_code)));
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
    -- account, then its package, as the package checkout locks them. Added
    -- slots only while the package they were asked for still runs, with room.
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 707));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||actor::text, 707));
    if add_package is not null then
      if not internal.slot_package_add_ok(actor, add_package, inv.slots) then
        raise exception 'the package these slots were for has ended; this invoice can no longer be paid'
          using errcode='PT409', detail='package_ended';
      end if;
    elsif internal.slot_package_open(actor) then
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
            'terms_version', (select c.version from private.posting_terms_current c where c.singleton)))
          -- Added slots (20261120045404): delivered into the package asked for.
          || case when add_package is null then '{}'::jsonb else jsonb_build_object('category', 'slot_package_add',
            'package_id', add_package, 'unit_price_cents', inv.unit_price_cents) end,
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

-- REPLACE: internal.record_staff_invoice_transfer

CREATE OR REPLACE FUNCTION internal.record_staff_invoice_transfer(p_invoice_number text, p_bank_reference text, p_cleared_on text, p_cooling_off_waiver boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; inv private.customer_invoices; plan private.plan_versions; reference text; reference_key text;
  cleared date; today date; audit_reason text; prior private.invoice_transfers; made private.invoice_transfers;
  fingerprint text; add_package uuid;
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
  -- An Individual slot invoice, or (P4e) a Multi-listing package invoice; or
  -- (20261120045404) an added-slots invoice, at the price asked for (D1).
  add_package := internal.package_add_invoice_package(inv.id);
  select * into plan from private.plan_versions v where v.id = inv.plan_version_id
    and (((internal.individual_slot_plan(v.plan_code) or internal.slot_package_plan(v.plan_code))
        and v.price_cents = inv.unit_price_cents)
      or (add_package is not null and internal.slot_package_plan(v.plan_code)));
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
    if add_package is not null then
      -- Money for added slots that arrives after the package ended is
      -- returned in full (D1).
      if not internal.slot_package_add_ok(inv.account_id, add_package, inv.slots) then
        raise exception 'the customer''s package has ended (or has no room); void this invoice and return the money in full'
          using errcode='PT409', detail='package_ended';
      end if;
    elsif internal.slot_package_open(inv.account_id) then
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

-- REPLACE: internal.confirm_staff_invoice_payment

CREATE OR REPLACE FUNCTION internal.confirm_staff_invoice_payment(p_transfer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; t private.invoice_transfers; plan private.plan_versions; pay private.payments;
  fingerprint text; made integer := 0; commissions integer := 0; vat bigint; inv private.customer_invoices;
  is_package boolean; add_package uuid;
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
  -- 20261120045404: an added-slots invoice adds them to the package it names.
  add_package := internal.package_add_invoice_package(t.customer_invoice_id);
  if is_package then
    -- One package per account at a time, only while packages are on sale (as
    -- an Ozow payment of a package is delivered).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||t.account_id::text, 707));
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale; decline this transfer and return the money'
        using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if add_package is not null then
      -- Added slots only while the package still runs, with room; money that
      -- arrives after it ended is returned in full (D1).
      if not internal.slot_package_add_ok(t.account_id, add_package, t.slots) then
        raise exception 'the customer''s package has ended (or has no room); decline this transfer and return the money in full'
          using errcode='PT409', detail='package_ended';
      end if;
    elsif internal.slot_package_open(t.account_id) then
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
    if (case when add_package is not null
          then (select i.total_cents from private.customer_invoices i where i.id = t.customer_invoice_id)
          else plan.price_cents * t.slots end) is distinct from t.amount_received_cents then
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
            'wording', 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately'))
          -- Added slots (20261120045404): delivered into the package asked for.
          || case when add_package is null then '{}'::jsonb else jsonb_build_object('category', 'slot_package_add',
            'package_id', add_package, 'unit_price_cents', inv.unit_price_cents) end,
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
    'slots_started', made, 'ends_at', case when add_package is not null
      then (select max(e.ends_at) from private.entitlements e where e.payment_id = pay.id)
      else statement_timestamp() + make_interval(days => plan.duration_days) end,
    'repeated', false);
end;
$function$;
alter function internal.confirm_staff_invoice_payment(uuid) owner to postgres;
revoke all on function internal.confirm_staff_invoice_payment(uuid) from public;
grant execute on function internal.confirm_staff_invoice_payment(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
