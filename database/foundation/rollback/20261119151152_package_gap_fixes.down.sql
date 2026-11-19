-- Reviewed rollback for updates/20261119151152_package_gap_fixes.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix. Revert and deploy the website
-- release first: the rollback removes api.get_staff_package_move_failures,
-- which that release's staff payments page reads (it then shows the page
-- without the list, with a warning).
--
-- It refuses (55000) unless the six added functions and the six replaced
-- ones have this update's bodies (a later update changed one: undo that update
-- first), and while any other function refers to an added function or the
-- table (a later update that uses them: undo it first). Otherwise it puts back the earlier bodies of
-- internal.run_slot_renewals, internal.slot_package_grant_revoked,
-- internal.claim_checkout_request, internal.record_staff_invoice_transfer,
-- internal.confirm_staff_invoice_payment and internal.issue_staff_invoice byte
-- for byte, and drops the added
-- functions and the table private.slot_package_move_failures with its
-- indexes (its rows are an operational record kept at most a few days after
-- a package ends; nothing else refers to them). No other row is changed:
-- slots already delivered from a bank transfer to an invoice issued before a
-- package, and paused posts already put back to their own end date, stay as
-- they are.
begin;
set local lock_timeout='5s';

do $$
declare shape text; dependants text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.slot_package_move_failed(uuid,uuid,text,text)'),
      ('internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone,integer,text)'),
      ('internal.slot_package_release_paused(uuid)'),
      ('internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone)'),
      ('internal.get_staff_package_move_failures()'),
      ('api.get_staff_package_move_failures()'),
      ('internal.run_slot_renewals(integer)'),
      ('internal.slot_package_grant_revoked()'),
      ('internal.claim_checkout_request(uuid,uuid)'),
      ('internal.record_staff_invoice_transfer(text,text,text,boolean,text)'),
      ('internal.confirm_staff_invoice_payment(uuid)'),
      ('internal.issue_staff_invoice(text,integer,integer,integer,text,uuid)')) v(sig)
  loop
    if shape not in (
        'internal.slot_package_move_failed(uuid,uuid,text,text) e4b6ce4b2aee3ff1938607d6e4c13b62',
        'internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone,integer,text) 1a00e8cdc844d71492dafff93b9214ab',
        'internal.slot_package_release_paused(uuid) 7a759a9a2eae8a30e821acb1bc9502af',
        'internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone) abe2bfd47931f123e0ae7d0ade767324',
        'internal.get_staff_package_move_failures() 2f537d010494190f161fb7db1ddf5967',
        'api.get_staff_package_move_failures() 3f539d70b5e2b7e538b77b0eecc94c68',
        'internal.run_slot_renewals(integer) 287781841f49b3a0e2aa3a6d10280a5f',
        'internal.slot_package_grant_revoked() 3d22cd9389fa075274e8ba14343e9aea',
        'internal.claim_checkout_request(uuid,uuid) 4922a976d1652603d491349a40f4f7da',
        'internal.record_staff_invoice_transfer(text,text,text,boolean,text) e37a32a916640c9a16f5924818b9b735',
        'internal.confirm_staff_invoice_payment(uuid) c9adba77f7b7ac7c6366083956e53454',
        'internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) 98f455b38a64273d664a5a745ad862e0') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if pg_catalog.to_regclass('private.slot_package_move_failures') is null then
    raise exception 'rollback precondition: private.slot_package_move_failures is missing' using errcode='55000';
  end if;
  -- A later function that calls an added function, or reads the table, would
  -- break silently once they are dropped: undo that update first.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into dependants
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api', 'internal', 'private', 'public')
    and p.oid not in (select to_regprocedure(s) from unnest(array[
      'internal.slot_package_move_failed(uuid,uuid,text,text)',
      'internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone,integer,text)',
      'internal.slot_package_release_paused(uuid)',
      'internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone)',
      'internal.get_staff_package_move_failures()',
      'api.get_staff_package_move_failures()',
      'internal.run_slot_renewals(integer)',
      'internal.slot_package_grant_revoked()',
      'internal.claim_checkout_request(uuid,uuid)',
      'internal.record_staff_invoice_transfer(text,text,text,boolean,text)',
      'internal.confirm_staff_invoice_payment(uuid)',
      'internal.issue_staff_invoice(text,integer,integer,integer,text,uuid)']) s)
    and (p.prosrc ilike '%slot_package_move_failed%' or p.prosrc ilike '%slot_package_move_stuck%'
      or p.prosrc ilike '%slot_package_release_paused%' or p.prosrc ilike '%slot_package_blocks_invoice%'
      or p.prosrc ilike '%get_staff_package_move_failures%' or p.prosrc ilike '%slot_package_move_failures%');
  if dependants is not null then
    raise exception 'rollback precondition: % refers to a function or table this rollback drops; undo that update first',
      dependants using errcode='55000';
  end if;
end$$;

-- The earlier internal.run_slot_renewals, byte for byte.
CREATE OR REPLACE FUNCTION internal.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_moved integer := 0; n_reminders integer := 0; r record; post private.posts; next_grant private.entitlements;
  activation private.post_activations; used integer; n_package_moved integer := 0; n_documents integer := 0;
  waiting record; held_back integer; places integer; n_downsized integer := 0; n_skipped integer := 0;
  package_ends timestamptz; target record; moved boolean;
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
  -- own end date up to its funding), so no post check can stop it.
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
  -- no package takes go back to their own dates); then, while it runs, the
  -- posts it takes move in, in the order they take its free places: the old
  -- activation released as entitlement_ended, the new one continued (not a
  -- post going live) and the search document moved to the package's end. A
  -- post that cannot move now keeps its place in the order (it stays funded at
  -- read time), so no post behind it moves into a place it needs. Each post
  -- moves in its own subtransaction: one that fails is counted
  -- (package_skipped) and left to the next run, and the others go on.
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
    continue when n_package_moved >= p_limit
      or not exists(select 1 from internal.slot_package_waiting(r.package_id));
    -- The package's places are shared by its grants: its grants and its row,
    -- as api.activate_post takes them, without waiting.
    begin
      perform 1 from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
        order by e.ends_at, e.id for update nowait;
      perform 1 from private.slot_packages k where k.id = r.package_id for update nowait;
    exception when lock_not_available then
      n_skipped := n_skipped + 1;
      continue;
    end;
    select n.places into places from internal.slot_package_now(r.owner_id) n where n.package_id = r.package_id;
    continue when places is null;
    select * into next_grant from private.entitlements e where e.package_id = r.package_id and e.status = 'active'
      and e.starts_at <= clock_timestamp() and e.ends_at > clock_timestamp() order by e.ends_at desc, e.id limit 1;
    continue when not found;
    held_back := 0;
    for waiting in select x.activation_id, x.post_id from internal.slot_package_waiting(r.package_id) x
        order by x.place_rank loop
      exit when n_package_moved >= p_limit or internal.slot_package_posts(r.package_id) + held_back >= places;
      begin
        select * into post from private.posts p where p.id = waiting.post_id for update skip locked;
        if found then
          select * into activation from private.post_activations a where a.id = waiting.activation_id
            and a.released_at is null and a.post_id = post.id;
        end if;
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
      end;
    end loop;
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
  -- subtransaction, as in 1b.
  for r in
    select distinct e.package_id, e.owner_id from private.entitlements e
    where e.package_id is not null and e.status = 'active' and e.ends_at > statement_timestamp()
      and e.ends_at <= statement_timestamp() + interval '7 days' and e.starts_at <= statement_timestamp()
    limit p_limit
  loop
    exit when n_package_moved >= p_limit;
    select n.ends_at into package_ends from internal.slot_package_now(r.owner_id) n where n.package_id = r.package_id;
    continue when package_ends is null
      or not exists(select 1 from internal.individual_free_places(r.owner_id) f where f.runs_until > package_ends);
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    for waiting in select x.activation_id, x.post_id from internal.slot_package_leaving(r.package_id) x
        order by x.place_rank loop
      exit when n_package_moved >= p_limit;
      moved := false;
      for target in select f.entitlement_id, f.runs_until from internal.individual_free_places(r.owner_id) f
          where f.runs_until > package_ends order by f.runs_until desc, f.entitlement_id limit 20 loop
        begin
          select * into post from private.posts p where p.id = waiting.post_id for update skip locked;
          exit when not found;
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
          exit;
        end;
        exit when moved;
      end loop;
      if moved then
        n_downsized := n_downsized + 1;
        n_package_moved := n_package_moved + 1;
      end if;
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
    'package_documents', n_documents, 'package_downsized', n_downsized, 'package_skipped', n_skipped);
end;
$function$;
alter function internal.run_slot_renewals(integer) owner to postgres;
revoke all on function internal.run_slot_renewals(integer) from public;
grant execute on function internal.run_slot_renewals(integer) to service_role;

-- The earlier internal.slot_package_grant_revoked, byte for byte.
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
  return null;
end;
$function$;
alter function internal.slot_package_grant_revoked() owner to postgres;
revoke all on function internal.slot_package_grant_revoked() from public;

-- The earlier internal.claim_checkout_request, byte for byte.
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
  -- are on sale and the member's ID review is still accepted.
  if exists(select 1 from private.plan_versions v where v.id=pay.plan_version_id
      and internal.slot_package_plan(v.plan_code)) then
    if not internal.slot_packages_on_sale() then
      raise exception 'Multi-listing packages are not on sale' using errcode='PT403', detail='packages_not_on_sale';
    end if;
    if internal.current_verified_identity(pay.owner_id) is null then
      raise exception 'your ID review must be accepted before you buy a package' using errcode='PT412';
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

-- The earlier internal.record_staff_invoice_transfer, byte for byte.
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
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
    if internal.slot_package_blocks_individual(fingerprint, inv.account_id) then
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

-- The earlier internal.confirm_staff_invoice_payment, byte for byte.
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
    -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
    if internal.slot_package_blocks_individual(fingerprint, t.account_id) then
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

-- The earlier internal.issue_staff_invoice, byte for byte.
CREATE OR REPLACE FUNCTION internal.issue_staff_invoice(p_account_email text, p_term_days integer, p_slots integer, p_due_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; plan private.plan_versions; fingerprint text; prior private.customer_invoices;
  made private.customer_invoices; issued_on date; year_number integer; next_number integer;
begin
  actor := internal.staff_actor('payments:refund');
  if length(btrim(coalesce(p_account_email, ''))) not between 3 and 254 or p_term_days is null
      or p_term_days not in (30, 90, 180) or p_slots is null or p_slots not between 1 and 25
      or p_due_days is null or p_due_days not between 1 and 30 or p_request_id is null then
    raise exception 'customer email, slot term, number of slots and days to pay required'
      using errcode='22023', detail='invoice_issue_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'audit reason required' using errcode='22023';
  end if;
  buyer := internal.invoice_customer_by_email(p_account_email);
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.lock_evidence_subject(buyer);
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  perform internal.assert_staff_payment_actor(actor, buyer);
  perform internal.assert_staff_not_referrer(actor, buyer);
  -- The same request again (a retried submission) returns the first invoice.
  select * into prior from private.customer_invoices i where i.issued_by = actor and i.request_id = p_request_id;
  if found then
    if prior.account_id = buyer and prior.slots = p_slots and prior.issue_reason = btrim(p_reason)
        and prior.due_on - internal.customer_invoice_day(prior.issued_at) = p_due_days
        and (select v.duration_days from private.plan_versions v where v.id = prior.plan_version_id) = p_term_days then
      return internal.customer_invoice_dto(prior, actor) || jsonb_build_object('repeated', true);
    end if;
    raise exception 'that request already issued another invoice' using errcode='PT409', detail='invoice_request_conflict';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id = buyer) then
    raise exception 'the customer''s account cannot use slots now' using errcode='PT409', detail='payment_account_unavailable';
  end if;
  select * into plan from private.plan_versions v
    where v.plan_code = 'individual_'||p_term_days||'d' and v.retired_at is null and v.is_public
      and internal.individual_slot_plan(v.plan_code)
    order by v.version desc limit 1;
  if not found then
    raise exception 'no slot for that term is on sale' using errcode='PT409', detail='invoice_plan_unavailable';
  end if;
  fingerprint := internal.current_verified_identity(buyer);
  if fingerprint is null then
    raise exception 'the customer''s ID review must be accepted before an invoice is issued'
      using errcode='PT412', detail='invoice_buyer_unverified';
  end if;
  -- E3 (20261114154823): while the person's Multi-listing package runs (until
  -- its last 7 days), no Individual slot is sold, whatever the way it is paid.
  if internal.slot_package_blocks_individual(fingerprint, buyer) then
    raise exception 'Individual slots cannot be sold while the person''s Multi-listing package runs'
      using errcode='PT409', detail='package_active';
  end if;
  if plan.price_cents * p_slots > 5000000 then
    raise exception 'invoices above R50,000 cannot be issued yet' using errcode='PT413', detail='invoice_amount_above_limit';
  end if;
  -- An early check of the slot limit; the payment checks it again.
  if (internal.individual_slots_counted(fingerprint, buyer, null)->>'held')::integer + p_slots
      > internal.individual_slot_limit(fingerprint) then
    raise exception 'more slots than the person''s limit; raise the limit first' using errcode='PT429', detail='slot_limit_reached';
  end if;
  -- The invoice says "not registered for VAT": only while the merchant setting says so.
  if not exists(select 1 from private.invoice_merchant_config c where c.singleton
      and c.registration_status = 'not_registered' and c.confirmed_at is not null) then
    raise exception 'the VAT registration setting changed; invoices need updating first'
      using errcode='PT409', detail='invoice_vat_status_changed';
  end if;
  issued_on := internal.customer_invoice_day(statement_timestamp());
  year_number := extract(year from issued_on)::integer;
  insert into private.customer_invoice_numbers as n (invoice_year, last_number) values (year_number, 1)
    on conflict (invoice_year) do update set last_number = n.last_number + 1
    returning n.last_number into next_number;
  insert into private.customer_invoices (invoice_number, invoice_year, sequence_number, account_id, plan_version_id,
      slots, unit_price_cents, total_cents, description, due_on, issued_by, issue_reason, request_id, seller)
    values ('VM-' || year_number::text || '-' || lpad(next_number::text, 6, '0'), year_number, next_number, buyer, plan.id,
      p_slots, plan.price_cents, plan.price_cents * p_slots,
      case when p_slots = 1 then plan.label else p_slots::text || ' × ' || plan.label end,
      issued_on + p_due_days, actor, btrim(p_reason), p_request_id,
      jsonb_build_object('legal_name', 'Verifymzansi (Pty) Ltd', 'registration_number', '2026/155305/07',
        'vat_registered', false))
    returning * into made;
  perform internal.staff_actor('payments:refund');
  perform internal.assert_staff_payment_actor(actor, buyer);
  return internal.customer_invoice_dto(made, actor) || jsonb_build_object('repeated', false);
end;
$function$;
alter function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) owner to postgres;
revoke all on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) from public;
grant execute on function internal.issue_staff_invoice(text,integer,integer,integer,text,uuid) to authenticated;

-- The earlier bodies call none of the added functions: drop them and the table.
drop function api.get_staff_package_move_failures();
drop function internal.get_staff_package_move_failures();
drop function internal.slot_package_blocks_invoice(text,uuid,timestamptz);
drop function internal.slot_package_release_paused(uuid);
drop function internal.slot_package_move_stuck(timestamptz,timestamptz,integer,text);
drop function internal.slot_package_move_failed(uuid,uuid,text,text);
drop table private.slot_package_move_failures;

notify pgrst,'reload schema';
commit;
