-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
  -- the slot the post holds, so undoing and redoing "sold" does not repeat it.
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
          where a.post_id=p.id and a.released_at is null),'none')
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
  -- drafts, rejected posts and paused posts without a slot. Deleting a post
  -- releases its slot (posts_release_activation).
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and internal.ended_post_decision(p) is not null)
        or (p.kind='event' and p.edit_of is null and p.status not in('expired','sold','archived')
          and p.deletes_at<=clock_timestamp() and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))
        or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'
          and internal.post_idle_deletion_due(p)))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
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
