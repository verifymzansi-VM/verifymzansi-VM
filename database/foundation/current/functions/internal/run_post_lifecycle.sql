-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_expired integer := 0; n_notices integer := 0; n_deleted integer := 0;
  r record; post private.posts; changed integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select p.id,p.owner_id from private.posts p
    where p.status='live' and p.visible_until<=clock_timestamp()
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
    order by p.visible_until,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.status='live'
      and p.visible_until<=clock_timestamp() for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- At most p_limit new notices per invocation; old dedupe rows do not starve
  -- later notices. Lock/recheck each post so a concurrent renewal invalidates
  -- the captured revision before its stale reminder can be queued.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.status_changed_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.status_changed_at))::bigint as dedupe_key
      from private.posts p where p.status='expired'
      union all
      select 'post_expiry_reminder',p.id,p.owner_id,p.revision,p.status_changed_at+make_interval(days=>d.day),
        'post_expiry_reminder:'||p.id||':'||d.day||':'||floor(extract(epoch from p.status_changed_at))::bigint
      from private.posts p cross join (values(7),(21)) d(day)
      where p.status='expired' and p.status_changed_at<=clock_timestamp()-make_interval(days=>d.day)
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,greatest(p.content_updated_at,p.status_changed_at)+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from greatest(p.content_updated_at,p.status_changed_at)))::bigint
      from private.posts p where p.status in('draft','rejected','paused')
        and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
      or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))
    order by p.status_changed_at,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and
      ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
       or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.posts e where e.edit_of=post.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days')) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted);
end;
$function$;
alter function internal.run_post_lifecycle(integer) owner to postgres;
revoke all on function internal.run_post_lifecycle(integer) from public;
grant execute on function internal.run_post_lifecycle(integer) to service_role;
