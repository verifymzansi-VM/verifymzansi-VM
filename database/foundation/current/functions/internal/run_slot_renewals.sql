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
