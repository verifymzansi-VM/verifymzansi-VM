-- Multi-listing packages: the small gaps of part one (roadmap P4a; the
-- owner's decision D6 of 19 November 2026).
--
-- Apply after 20261119082834_house_slots.sql (filename order; this update does
-- not depend on it and touches none of its functions or tables). It needs
-- 20261114154823_slot_packages.sql and 20261119025106_package_invoices.sql.
-- Order: apply-first. It adds one staff read command
-- (api.get_staff_package_move_failures) and three fields to the reply of the
-- service command api.run_slot_renewals; no command, argument or grant is
-- removed or changed, and no field is added to an answer the website reads
-- strictly. It refuses with 55000 unless the six functions it adds are absent
-- (or this update's), the five it replaces have their reviewed bodies (or
-- this update's) and its table is absent or has this update's shape. Packages
-- stay off sale (private.slot_package_sales is not touched). In one
-- transaction it:
--
-- 1. Keeps a record of the package moves the sweep could not make. New table
--    private.slot_package_move_failures: one row per package, post (none when
--    the package itself was busy) and direction (`into_package`: the post of
--    an ended Individual slot that the package takes; `out_of_package`: a
--    package post moving into a free Individual slot in the package's last 7
--    days), with the number of tries, the first and last failure and the
--    reason (`busy`, or `error <SQLSTATE>`). A failure more than 15 minutes
--    after the last one starts the count again. The row goes when the post
--    moves, when the sweep finds it no longer waiting, or 7 days after its
--    last failure once its package has ended. It has no foreign key on
--    purpose: a key-share lock on the
--    post or package row would make the sweep wait for an activation holding
--    it, and the sweep never waits. Row level security on, no API role reads
--    it.
-- 2. Replaces api.run_slot_renewals' body internal.run_slot_renewals: every
--    failure it counts in `package_skipped` is recorded (a post another
--    transaction holds is now counted too, as `busy`), and its reply gains
--    `package_stuck` (current failures that started over 30 minutes ago, or
--    whose package ends within a day), `package_stuck_moves` (up to 20 of
--    them: package, post, direction, tries, first failure, reason; no
--    personal data) and `package_paused_released` (see 3). The website's
--    operations job logs a non-zero `package_skipped` and alerts on
--    `package_stuck`. Every other step is unchanged.
-- 3. Paused posts after a package refund. A paused post still held in its
--    ended Individual slot, whose own end date the lifecycle job had raised to
--    the package's end while the package took it, keeps that date once no
--    package takes it any more (the package refunded or charged back, or
--    full), so its 3-day grace and deletion clock started only at the old
--    package end. New internal.slot_package_release_paused(owner) puts such
--    posts back to the end of their slot's paid run; the lifecycle job then
--    ends them on its next run. The revocation trigger
--    (internal.slot_package_grant_revoked, replaced) and the sweep run it.
--    Each post is changed in its own subtransaction with its deferred checks
--    run at once, without waiting for a post another transaction holds, so a
--    post saved under rules that have since changed can never stop a refund,
--    a chargeback or the sweep: such a post is left as it was.
-- 4. Bank transfers for an Individual invoice issued before a package
--    started (D6). internal.record_staff_invoice_transfer and
--    internal.confirm_staff_invoice_payment (replaced) record and deliver
--    them: the slots run beside the package to their own end, like slots
--    already held. E3 still refuses a transfer to an invoice issued after the
--    person's package started, and a transfer recorded without an invoice
--    (new internal.slot_package_blocks_invoice). The Individual slot limit
--    still applies.
-- 5. An unsent online package checkout. internal.claim_checkout_request
--    (replaced) refuses a package payment while the account has a package
--    that has not ended (PT409 package_active) or an unpaid package invoice
--    it is not an attempt of (PT409 package_invoice_unpaid), checked under the
--    account's package lock (the one a bank transfer's confirmation, Pay now
--    and a package delivery hold), taken without waiting after the payment
--    row: while that lock is busy it refuses with PT409 package_busy and the
--    member tries again. So a checkout started before a package invoice was
--    paid by bank transfer can no longer be sent to Ozow and paid beside the
--    package.
-- 6. Adds the staff read api.get_staff_package_move_failures()
--    (`payments:view`): the current failures (last one in the past 15
--    minutes), oldest first, at most 50, each with the package's end, the
--    owner's public name, the post's title and whether it is stuck.
--
-- No existing row is changed. Read-only preflight:
-- ../preflight/20261119151152_package_gap_fixes.check.sql. Rollback:
-- ../rollback/20261119151152_package_gap_fixes.down.sql.
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
    from (values ('internal.slot_package_move_failed(uuid,uuid,text,text)'),
      ('internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone)'),
      ('internal.slot_package_release_paused(uuid)'),
      ('internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone)'),
      ('internal.get_staff_package_move_failures()'),
      ('api.get_staff_package_move_failures()'),
      ('internal.run_slot_renewals(integer)'),
      ('internal.slot_package_grant_revoked()'),
      ('internal.claim_checkout_request(uuid,uuid)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.confirm_staff_invoice_payment(uuid)')) v(sig)
  loop
    if shape not in (
        'internal.slot_package_move_failed(uuid,uuid,text,text) absent',
        'internal.slot_package_move_failed(uuid,uuid,text,text) a202bfe80af8e5021d85c61c954f4afd',
        'internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone) absent',
        'internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone) f12afc45d9dcd4d66a3c426121776f8a',
        'internal.slot_package_release_paused(uuid) absent',
        'internal.slot_package_release_paused(uuid) 7a759a9a2eae8a30e821acb1bc9502af',
        'internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone) absent',
        'internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone) 936d94bad14a6dd93b088d713d7afc50',
        'internal.get_staff_package_move_failures() absent',
        'internal.get_staff_package_move_failures() 68b72b4d76c7326eafa78f4622e96c2c',
        'api.get_staff_package_move_failures() absent',
        'api.get_staff_package_move_failures() 3f539d70b5e2b7e538b77b0eecc94c68',
        'internal.run_slot_renewals(integer) 91941c5d801ac26cb0a8fc98051cd04b',
        'internal.run_slot_renewals(integer) f27b3048f7bff4b071a579a5fbf56c98',
        'internal.slot_package_grant_revoked() e052094af78e8fe39eeb26f11b8c3e69',
        'internal.slot_package_grant_revoked() 3d22cd9389fa075274e8ba14343e9aea',
        'internal.claim_checkout_request(uuid,uuid) ed0fda34dc274593ad117b51d47eb13c',
        'internal.claim_checkout_request(uuid,uuid) cf0116ac2b82826a71f30adbad3309eb',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) 6f508a66a82ad2a24e4c43c324fd90a3',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) e37a32a916640c9a16f5924818b9b735',
        'internal.confirm_staff_invoice_payment(uuid) 3daa82e3347ee5e2880279251c9521c2',
        'internal.confirm_staff_invoice_payment(uuid) c9adba77f7b7ac7c6366083956e53454') then
      raise exception 'package gap fixes precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if pg_catalog.to_regclass('private.slot_package_move_failures') is not null and not exists(
      select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('private.slot_package_move_failures')
        and a.attname='first_failed_at' and not a.attisdropped) then
    raise exception 'package gap fixes precondition: private.slot_package_move_failures exists with another shape'
      using errcode='55000';
  end if;
end$$;

-- 1. The record of package moves the sweep could not make.
create table if not exists private.slot_package_move_failures (
  id uuid not null default gen_random_uuid(),
  package_id uuid not null,
  post_id uuid,
  direction text not null,
  tries integer not null default 1,
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  reason text not null,
  constraint slot_package_move_failures_pkey primary key (id),
  constraint slot_package_move_failures_direction_check check (direction in ('into_package', 'out_of_package')),
  constraint slot_package_move_failures_tries_check check (tries >= 1),
  constraint slot_package_move_failures_times_check check (last_failed_at >= first_failed_at),
  constraint slot_package_move_failures_reason_check check (reason = 'busy' or reason ~ '^error [0-9A-Z]{5}$')
);
alter table private.slot_package_move_failures owner to postgres;
alter table private.slot_package_move_failures enable row level security;
revoke all on private.slot_package_move_failures from public, anon, authenticated, service_role;
-- One row per package, post and direction (the package itself when no post).
create unique index if not exists slot_package_move_failures_move_idx on private.slot_package_move_failures
  (package_id, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid), direction);
-- The 7-day clean-up and the staff read of current failures.
create index if not exists slot_package_move_failures_last_idx on private.slot_package_move_failures (last_failed_at);

-- A move failed: counted on the row of its package, post and direction. A
-- failure more than 15 minutes after the last one starts the count again.
-- Called only by the sweep while it holds the owner's fence, so two runs
-- never write the same row at once.
create or replace function internal.slot_package_move_failed(p_package uuid, p_post uuid, p_direction text,
    p_sqlstate text)
 returns void
 language plpgsql
 set search_path to 'pg_catalog'
as $$
declare v_now timestamptz := clock_timestamp();
  v_reason text := case when p_sqlstate = '55P03' then 'busy' else 'error ' || p_sqlstate end;
begin
  update private.slot_package_move_failures f set
      tries = case when f.last_failed_at < v_now - interval '15 minutes' then 1 else f.tries + 1 end,
      first_failed_at = case when f.last_failed_at < v_now - interval '15 minutes' then v_now else f.first_failed_at end,
      last_failed_at = v_now, reason = v_reason
    where f.package_id = p_package and f.post_id is not distinct from p_post and f.direction = p_direction;
  if not found then
    insert into private.slot_package_move_failures (package_id, post_id, direction, first_failed_at, last_failed_at, reason)
      values (p_package, p_post, p_direction, v_now, v_now, v_reason);
  end if;
end;
$$;
alter function internal.slot_package_move_failed(uuid,uuid,text,text) owner to postgres;
revoke all on function internal.slot_package_move_failed(uuid,uuid,text,text) from public;

-- A current failure is stuck once it started over 30 minutes ago, or while
-- its package ends within a day (one rule for the sweep and the staff read).
create or replace function internal.slot_package_move_stuck(p_first_failed_at timestamptz, p_package_ends timestamptz)
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $$
  select p_first_failed_at <= statement_timestamp() - interval '30 minutes'
    or coalesce(p_package_ends > statement_timestamp() and p_package_ends <= statement_timestamp() + interval '1 day',
      false);
$$;
alter function internal.slot_package_move_stuck(timestamptz,timestamptz) owner to postgres;
revoke all on function internal.slot_package_move_stuck(timestamptz,timestamptz) from public;

-- 3. Paused posts no package takes any more go back to the end of their
-- slot's paid run. Only the owner's paused posts still held in an ended paid
-- Individual slot that no package takes (the posts
-- internal.slot_package_release_dates gives their search documents back for)
-- and whose own end date is later than that run's end. Each post in its own
-- subtransaction, with the posts' deferred checks run at once, so a post saved
-- under rules that have since changed only fails its own change, and never one
-- another transaction holds (skip locked). Returns the number of posts changed.
create or replace function internal.slot_package_release_paused(p_owner uuid)
 returns integer
 language plpgsql
 set search_path to 'pg_catalog'
as $$
declare r record; changed integer := 0; n integer;
begin
  for r in
    select a.post_id, internal.slot_chain_paid_end(x.id) as paid_end
    from private.post_activations a
      join private.entitlements x on x.id = a.entitlement_id
      join private.posts p on p.id = a.post_id
    where a.owner_id = p_owner and a.released_at is null and a.post_id is not null
      and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
      and x.ends_at <= statement_timestamp() and p.status = 'paused' and p.kind <> 'event'
      and coalesce(internal.slot_chain_end(x.id) <= statement_timestamp(), true)
    order by a.post_id
  loop
    continue when r.paid_end is null;
    begin
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category immediate;
      update private.posts p set visible_until = r.paid_end
        where p.id = (select q.id from private.posts q where q.id = r.post_id and q.status = 'paused'
          and q.kind <> 'event' and q.visible_until > r.paid_end for no key update skip locked);
      get diagnostics n = row_count;
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category deferred;
      changed := changed + n;
    exception when others then
      -- Left as it was; the sweep tries again on its next run.
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category deferred;
    end;
  end loop;
  return changed;
end;
$$;
alter function internal.slot_package_release_paused(uuid) owner to postgres;
revoke all on function internal.slot_package_release_paused(uuid) from public;

-- 3. The revocation trigger (the full function): the search documents as
-- before, then the paused posts, each on its own so neither stops the refund
-- or chargeback; whatever is left is the sweep's.
create or replace function internal.slot_package_grant_revoked()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
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

-- 4. E3 for a bank transfer to an Individual invoice: the person's running
-- package refuses it only when the package started at or before the invoice
-- was issued (D6: an invoice issued before the package is honoured). Without
-- an invoice (p_issued_at null) it is internal.slot_package_blocks_individual.
create or replace function internal.slot_package_blocks_invoice(p_identity text, p_owner uuid, p_issued_at timestamptz)
 returns boolean
 language sql
 stable
 set search_path to 'pg_catalog'
as $$
  select exists(select 1 from private.entitlements e join private.slot_packages k on k.id = e.package_id
    where e.owner_id in (select internal.individual_slot_owners(p_identity, p_owner))
      and e.package_id is not null and e.status = 'active' and e.starts_at <= statement_timestamp()
      and e.ends_at > statement_timestamp() + interval '7 days'
      and (p_issued_at is null or k.created_at <= p_issued_at));
$$;
alter function internal.slot_package_blocks_invoice(text,uuid,timestamptz) owner to postgres;
revoke all on function internal.slot_package_blocks_invoice(text,uuid,timestamptz) from public;

-- 2. The sweep (the full function; steps 1b and 1c record the moves they could
-- not make, step 1b also puts paused posts back, and the reply has three new
-- counts).
CREATE OR REPLACE FUNCTION internal.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_moved integer := 0; n_reminders integer := 0; r record; post private.posts; next_grant private.entitlements;
  activation private.post_activations; used integer; n_package_moved integer := 0; n_documents integer := 0;
  waiting record; held_back integer; places integer; n_downsized integer := 0; n_skipped integer := 0;
  package_ends timestamptz; target record; moved boolean; n_paused integer := 0; seen uuid[]; failed uuid[];
  stuck jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023';
  end if;
  -- Locks: the sweep never waits for a lock it takes. The owner's fence is
  -- tried, posts are skipped when another transaction holds them, and slots,
  -- a package's grants and row and search documents are taken without
  -- waiting; whatever is busy is left to the next run (every minute). So it
  -- cannot take part in a deadlock with api.activate_post (post, then slots,
  -- then the package), a payment or reversal, or the lifecycle job (post, then
  -- search document). It writes no post row (the lifecycle job brings a post's
  -- own end date up to its funding), so no post check can stop it; the one
  -- exception, putting a paused post's end date back (step 1b), changes each
  -- post on its own and skips one that fails or is busy.
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
    select * into next_grant from private.entitlements e where e.id=r.next_id for update skip locked;
    -- Recheck under the locks: the next period still follows on, covers now,
    -- may carry this post and has room for it.
    continue when not found or next_grant.status<>'active' or next_grant.starts_at>clock_timestamp()
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
  -- (internal.slot_chain_end). Read from the packages that have not reached
  -- their end (entitlements_package_ends_idx; refunded ones too) whose owner
  -- still holds a post in a paid Individual slot that has ended, however long
  -- ago, or ends in the next 2 minutes (post_activations_owner_held_idx); the
  -- most recent slot end first, at most p_limit packages a run. For each: the
  -- search documents (internal.refresh_package_documents: those of the posts
  -- it takes, or will take in the next 2 minutes, end with it; those of posts
  -- no package takes go back to their own dates) and the paused posts no
  -- package takes (internal.slot_package_release_paused, 20261119151152: their
  -- own end dates go back too); then, while it runs, the posts it takes move
  -- in, in the order they take its free places: the old activation released
  -- as entitlement_ended, the new one continued (not a post going live) and
  -- the search document moved to the package's end. A post that cannot move
  -- now keeps its place in the order (it stays funded at read time), so no
  -- post behind it moves into a place it needs. Each post moves in its own
  -- subtransaction: one that fails, or that another transaction holds, is
  -- counted (package_skipped), recorded in private.slot_package_move_failures
  -- (20261119151152) and left to the next run, and the others go on. A
  -- recorded failure goes when the post moves or no longer waits.
  for r in
    select k.package_id, k.owner_id from (
      select distinct e.package_id, e.owner_id from private.entitlements e
      where e.package_id is not null and e.ends_at > statement_timestamp()
    ) k
      cross join lateral (
        select max(x.ends_at) as last_end
        from private.post_activations a join private.entitlements x on x.id = a.entitlement_id
        where a.owner_id = k.owner_id and a.released_at is null and a.post_id is not null
          and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
          and x.ends_at <= statement_timestamp() + interval '2 minutes'
      ) h
    where h.last_end is not null
    order by h.last_end desc, k.package_id
    limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    n_documents := n_documents + internal.refresh_package_documents(r.package_id);
    n_paused := n_paused + internal.slot_package_release_paused(r.owner_id);
    continue when n_package_moved >= p_limit;
    if not exists(select 1 from internal.slot_package_waiting(r.package_id)) then
      -- Nothing waits: no move into this package can be failing.
      delete from private.slot_package_move_failures f
        where f.package_id = r.package_id and f.direction = 'into_package';
      continue;
    end if;
    -- The package's places are shared by its grants: its grants and its row,
    -- as api.activate_post takes them, without waiting.
    begin
      perform 1 from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
        order by e.ends_at, e.id for update nowait;
      perform 1 from private.slot_packages k where k.id = r.package_id for update nowait;
    exception when lock_not_available then
      n_skipped := n_skipped + 1;
      perform internal.slot_package_move_failed(r.package_id, null, 'into_package', sqlstate);
      continue;
    end;
    delete from private.slot_package_move_failures f
      where f.package_id = r.package_id and f.post_id is null and f.direction = 'into_package';
    select n.places into places from internal.slot_package_now(r.owner_id) n where n.package_id = r.package_id;
    continue when places is null;
    select * into next_grant from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
      and e.starts_at <= clock_timestamp() and e.ends_at > clock_timestamp() order by e.ends_at desc, e.id limit 1;
    continue when not found;
    held_back := 0;
    seen := '{}';
    failed := '{}';
    for waiting in select x.activation_id, x.post_id from internal.slot_package_waiting(r.package_id) x
        order by x.place_rank loop
      exit when n_package_moved >= p_limit or internal.slot_package_posts(r.package_id) + held_back >= places;
      seen := seen || waiting.post_id;
      begin
        select * into post from private.posts p where p.id = waiting.post_id for update skip locked;
        if not found then
          -- Another transaction holds the post: busy, tried again next run.
          held_back := held_back + 1;
          n_skipped := n_skipped + 1;
          failed := failed || waiting.post_id;
          perform internal.slot_package_move_failed(r.package_id, waiting.post_id, 'into_package', '55P03');
          continue;
        end if;
        select * into activation from private.post_activations a where a.id = waiting.activation_id
          and a.released_at is null and a.post_id = post.id;
        -- Recheck under the locks: the slot's paid run has ended (no renewal
        -- followed on) and the package may carry the post.
        if not found or coalesce(internal.slot_chain_paid_end(activation.entitlement_id) > clock_timestamp(), false)
            or not internal.entitlement_for_post_eligible(next_grant.id, post.id, post.owner_id) then
          held_back := held_back + 1;
          continue;
        end if;
        perform 1 from private.post_search_documents s where s.post_id = post.id for update nowait;
        update private.post_activations set released_at=clock_timestamp(), release_reason='entitlement_ended'
          where id=activation.id;
        insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
          values (post.id, next_grant.id, post.owner_id, clock_timestamp(), true);
        update private.post_search_documents set visible_until = next_grant.ends_at
          where post_id = post.id and kind <> 'event' and visible_until < next_grant.ends_at;
        n_package_moved := n_package_moved + 1;
      exception when others then
        held_back := held_back + 1;
        n_skipped := n_skipped + 1;
        failed := failed || waiting.post_id;
        perform internal.slot_package_move_failed(r.package_id, waiting.post_id, 'into_package', sqlstate);
      end;
    end loop;
    -- Posts that moved, can no longer move, or (when the run was not cut short
    -- by its limit) no longer wait for a place have nothing failing.
    delete from private.slot_package_move_failures f
      where f.package_id = r.package_id and f.direction = 'into_package' and f.post_id is not null
        and not (f.post_id = any(failed)) and (n_package_moved < p_limit or f.post_id = any(seen));
  end loop;
  -- 1c. Going below 5 (decision 11): in a package's last 7 days its posts move
  -- into free places of the same owner's paid Individual slots whose run lasts
  -- beyond the package's end (internal.individual_free_places), the most
  -- recently approved first (internal.slot_package_leaving), so at the
  -- package's end they are already in their Individual slots instead of the
  -- 3-day grace. A post a slot cannot carry (another area, more photos) tries
  -- the owner's other slots, the longest-running first, at most 20. Read by
  -- date: the packages ending within 7 days (entitlements_package_ends_idx), at
  -- most p_limit a run. A move is not a post going live (continued); the post's
  -- search document moves to the slot's end. Each post moves in its own
  -- subtransaction, as in 1b; a failure, or a post another transaction holds,
  -- is counted and recorded as in 1b (20261119151152).
  for r in
    select distinct e.package_id, e.owner_id from private.entitlements e
    where e.package_id is not null and e.status = 'active' and e.ends_at > statement_timestamp()
      and e.ends_at <= statement_timestamp() + interval '7 days' and e.starts_at <= statement_timestamp()
    limit p_limit
  loop
    exit when n_package_moved >= p_limit;
    select n.ends_at into package_ends from internal.slot_package_now(r.owner_id) n where n.package_id = r.package_id;
    continue when package_ends is null;
    if not exists(select 1 from internal.individual_free_places(r.owner_id) f where f.runs_until > package_ends) then
      -- No free place to move into: no move out of this package can be
      -- failing (its record is cleared under the owner's fence).
      if exists(select 1 from private.slot_package_move_failures f
            where f.package_id = r.package_id and f.direction = 'out_of_package')
          and pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then
        delete from private.slot_package_move_failures f
          where f.package_id = r.package_id and f.direction = 'out_of_package';
      end if;
      continue;
    end if;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    seen := '{}';
    failed := '{}';
    for waiting in select x.activation_id, x.post_id from internal.slot_package_leaving(r.package_id) x
        order by x.place_rank loop
      exit when n_package_moved >= p_limit;
      seen := seen || waiting.post_id;
      moved := false;
      for target in select f.entitlement_id, f.runs_until from internal.individual_free_places(r.owner_id) f
          where f.runs_until > package_ends order by f.runs_until desc, f.entitlement_id limit 20 loop
        begin
          select * into post from private.posts p where p.id = waiting.post_id for update skip locked;
          if not found then
            -- Another transaction holds the post: busy, tried again next run.
            n_skipped := n_skipped + 1;
            failed := failed || waiting.post_id;
            perform internal.slot_package_move_failed(r.package_id, waiting.post_id, 'out_of_package', '55P03');
            exit;
          end if;
          select * into activation from private.post_activations a where a.id = waiting.activation_id
            and a.released_at is null and a.post_id = post.id;
          exit when not found;
          select * into next_grant from private.entitlements e where e.id = target.entitlement_id for update skip locked;
          -- Recheck under the locks: the place is still free and may carry the post.
          continue when not found or internal.slot_posts_held(next_grant.id) >= next_grant.slot_capacity
            or not internal.entitlement_for_post_eligible(next_grant.id, post.id, post.owner_id);
          perform 1 from private.post_search_documents s where s.post_id = post.id for update nowait;
          update private.post_activations set released_at=clock_timestamp(), release_reason='entitlement_ended'
            where id=activation.id;
          insert into private.post_activations (post_id, entitlement_id, owner_id, activated_at, continued)
            values (post.id, next_grant.id, post.owner_id, clock_timestamp(), true);
          update private.post_search_documents set visible_until = target.runs_until
            where post_id = post.id and kind <> 'event' and visible_until < target.runs_until;
          moved := true;
        exception when others then
          n_skipped := n_skipped + 1;
          failed := failed || waiting.post_id;
          perform internal.slot_package_move_failed(r.package_id, waiting.post_id, 'out_of_package', sqlstate);
          exit;
        end;
        exit when moved;
      end loop;
      if moved then
        n_downsized := n_downsized + 1;
        n_package_moved := n_package_moved + 1;
      end if;
    end loop;
    delete from private.slot_package_move_failures f
      where f.package_id = r.package_id and f.direction = 'out_of_package' and f.post_id is not null
        and not (f.post_id = any(failed)) and (n_package_moved < p_limit or f.post_id = any(seen));
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
  -- 3. Recorded failures (20261119151152): those last seen 7 days ago of a
  -- package that ended over a day ago go (slot_package_move_failures_last_idx,
  -- at most p_limit a run); no step above can still write them, and rows
  -- another transaction holds are skipped. The current ones that are stuck
  -- (internal.slot_package_move_stuck) are reported, the oldest 20 with their
  -- package, post, direction, tries, first failure and reason, so the
  -- operations job can alert.
  delete from private.slot_package_move_failures f where f.id in (select x.id
    from private.slot_package_move_failures x where x.last_failed_at < statement_timestamp() - interval '7 days'
      and not exists(select 1 from private.entitlements e where e.package_id = x.package_id
        and e.ends_at > statement_timestamp() - interval '1 day')
    order by x.last_failed_at limit p_limit for update skip locked);
  select jsonb_build_object('count', count(*), 'moves', coalesce(jsonb_agg(jsonb_build_object(
      'package_id', s.package_id, 'post_id', s.post_id, 'direction', s.direction, 'tries', s.tries,
      'first_failed_at', s.first_failed_at, 'reason', s.reason) order by s.first_failed_at, s.id)
      filter (where s.n <= 20), '[]'::jsonb))
    into stuck
  from (select f.*, row_number() over (order by f.first_failed_at, f.id) as n
    from private.slot_package_move_failures f
    where f.last_failed_at >= statement_timestamp() - interval '15 minutes'
      and internal.slot_package_move_stuck(f.first_failed_at, (select max(e.ends_at) from private.entitlements e
        where e.package_id = f.package_id and e.status = 'active'))) s;
  return jsonb_build_object('moved', n_moved, 'reminders', n_reminders, 'package_moved', n_package_moved,
    'package_documents', n_documents, 'package_downsized', n_downsized, 'package_skipped', n_skipped,
    'package_paused_released', n_paused, 'package_stuck', (stuck->>'count')::integer,
    'package_stuck_moves', stuck->'moves');
end;
$function$;
alter function internal.run_slot_renewals(integer) owner to postgres;
revoke all on function internal.run_slot_renewals(integer) from public;
grant execute on function internal.run_slot_renewals(integer) to service_role;

-- 5. Sending a checkout to Ozow (the full function; a package payment takes the account's locks first and is refused beside a package or an unpaid package invoice).
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
  -- one of them runs, the member is asked to try again in a moment.
  if exists(select 1 from private.plan_versions v where v.id=pay.plan_version_id
      and internal.slot_package_plan(v.plan_code)) then
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||pay.owner_id::text, 707)) then
      raise exception 'your package is being updated; try again in a moment' using errcode='PT409', detail='package_busy';
    end if;
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.current_verified_identity(pay.owner_id) is null then
      raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
    end if;
    if internal.slot_package_open(pay.owner_id) then
      raise exception 'this account already has a Multi-listing package' using errcode='PT409', detail='package_active';
    end if;
    if exists(select 1 from private.customer_invoices i join private.plan_versions v on v.id=i.plan_version_id
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

-- 4. Recording a bank transfer to an invoice (the full function; only the E3 check changes).
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

-- 4. Confirming a bank transfer (the full function; only the E3 check changes).
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

-- 6. Staff read: the package moves the sweep is failing to make now (the last
-- failure in the past 15 minutes), oldest first, at most 50. Each with the
-- package's end, the owner's public name ("Thandeka D."), the post's title and
-- whether it is stuck (internal.slot_package_move_stuck). Never an email,
-- phone or identity detail.
create or replace function internal.get_staff_package_move_failures()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.staff_actor('payments:view'); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
      'package_id', f.package_id,
      'owner_name', internal.profile_public_name((select pr.display_name from private.profiles pr
        where pr.account_id = k.owner_id)),
      'post_id', f.post_id, 'post_title', p.title, 'direction', f.direction, 'tries', f.tries,
      'first_failed_at', f.first_failed_at, 'last_failed_at', f.last_failed_at, 'reason', f.reason,
      'package_ends_at', e.ends_at,
      'stuck', internal.slot_package_move_stuck(f.first_failed_at, e.ends_at))
      order by f.first_failed_at, f.id), '[]'::jsonb))
    into result
  from (select x.* from private.slot_package_move_failures x
      where x.last_failed_at >= statement_timestamp() - interval '15 minutes'
      order by x.first_failed_at, x.id limit 50) f
    left join private.slot_packages k on k.id = f.package_id
    left join private.posts p on p.id = f.post_id
    left join lateral (select max(g.ends_at) as ends_at from private.entitlements g
      where g.package_id = f.package_id and g.status = 'active') e on true;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$$;
alter function internal.get_staff_package_move_failures() owner to postgres;
revoke all on function internal.get_staff_package_move_failures() from public;
grant execute on function internal.get_staff_package_move_failures() to authenticated;

create or replace function api.get_staff_package_move_failures()
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $$
  select internal.get_staff_package_move_failures();
$$;
alter function api.get_staff_package_move_failures() owner to postgres;
revoke all on function api.get_staff_package_move_failures() from public;
grant execute on function api.get_staff_package_move_failures() to authenticated;

notify pgrst,'reload schema';
commit;
