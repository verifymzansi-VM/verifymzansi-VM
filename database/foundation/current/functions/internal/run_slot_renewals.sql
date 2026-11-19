-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
  stuck jsonb; stuck_count integer;
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
  -- (internal.slot_package_move_stuck) are counted, and each is reported once
  -- for an alert (alerted_at; a new failure run after 15 quiet minutes may be
  -- reported again): the oldest 20 not reported yet, with their package, post,
  -- direction, tries, first failure and reason, marked under the owner's
  -- fence (tried, never waited for; a busy owner's row is reported next run).
  delete from private.slot_package_move_failures f where f.id in (select x.id
    from private.slot_package_move_failures x where x.last_failed_at < statement_timestamp() - interval '7 days'
      and not exists(select 1 from private.entitlements e where e.package_id = x.package_id
        and e.ends_at > statement_timestamp() - interval '1 day')
    order by x.last_failed_at limit p_limit for update skip locked);
  stuck := '[]'::jsonb;
  stuck_count := 0;
  for target in
    select f.id, f.package_id, f.post_id, f.direction, f.tries, f.first_failed_at, f.reason, f.alerted_at,
      k.owner_id
    from private.slot_package_move_failures f
      left join private.slot_packages k on k.id = f.package_id
    where f.last_failed_at >= statement_timestamp() - interval '15 minutes'
      and internal.slot_package_move_stuck(f.first_failed_at, (select max(e.ends_at) from private.entitlements e
        where e.package_id = f.package_id and e.status = 'active'), f.tries, f.reason)
    order by f.first_failed_at, f.id
  loop
    stuck_count := stuck_count + 1;
    continue when target.alerted_at is not null or jsonb_array_length(stuck) >= 20 or target.owner_id is null
      or not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(target.owner_id::text,2408));
    update private.slot_package_move_failures set alerted_at = clock_timestamp() where id = target.id;
    stuck := stuck || jsonb_build_array(jsonb_build_object('package_id', target.package_id,
      'post_id', target.post_id, 'direction', target.direction, 'tries', target.tries,
      'first_failed_at', target.first_failed_at, 'reason', target.reason));
  end loop;
  return jsonb_build_object('moved', n_moved, 'reminders', n_reminders, 'package_moved', n_package_moved,
    'package_documents', n_documents, 'package_downsized', n_downsized, 'package_skipped', n_skipped,
    'package_paused_released', n_paused, 'package_stuck', stuck_count, 'package_stuck_moves', stuck);
end;
$function$;
alter function internal.run_slot_renewals(integer) owner to postgres;
revoke all on function internal.run_slot_renewals(integer) from public;
grant execute on function internal.run_slot_renewals(integer) to service_role;
