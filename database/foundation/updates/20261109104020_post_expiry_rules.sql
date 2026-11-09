-- Post expiry rules (owner decisions of 9 November 2026). Apply after
-- 20261109073519_post_lifecycle_guards.sql, which this update builds on.
--
-- 1. Market and Business posts hold a plan slot. When a post's paid run ends
--    (visible_until), the lifecycle job expires it, releases its slot and
--    queues the post_expired notice. The post stays hidden for 3 days, during
--    which its owner can buy a plan and reactivate it; then the job deletes it
--    with its media. The 7- and 21-day reminders are no longer queued.
-- 2. A sold post keeps its slot until it is deleted, 3 days after it was
--    marked sold (notice post_sold). Its owner can delete it earlier to reuse
--    the slot, or reactivate it within the 3 days: it then runs for the
--    slot's remaining days while that slot is still valid.
-- 3. A live or paused event is deleted when it ends (event_details.ends_at),
--    with no grace period and no expiry notice. Its place in the limit of 10
--    free events per 30 days returns only when its owner deletes it before it
--    ends; deletion by the job never returns it.
-- 4. Pausing keeps the slot and does not stop the run's clock: a paused post
--    that holds a slot expires like a live one, and reactivating it spends no
--    further activation. A paused post holding a slot is not deleted as idle;
--    paused posts without a slot (paused before this update, or whose plan was
--    reversed) keep the 45/60-day idle rule.
-- 5. A plan payment started during the 3 days and still being confirmed when
--    they end extends the deletion date once, by 24 hours. The post is deleted
--    as soon as that payment fails, or when the 24 hours have passed.
-- 6. Nothing that has already ended is deleted sooner than 3 days after this
--    update: expired, sold and archived posts get the later of now + 3 days
--    and ended_at + 3 days, and their owners get the new notice (expired
--    events excepted). Live and paused events get their end, or now + 3 days
--    when that has already passed.
-- 7. Owner reads get_my_frontend_post_v2 and list_my_frontend_posts_v2 add
--    deletes_at to the owner's post data. The original reads are unchanged.
-- Staff content holds and legal holds keep protecting posts as before.
begin;
set local lock_timeout='5s';

-- Preconditions: the post lifecycle guards update is applied and the bodies
-- replaced below are the reviewed ones.
do $$begin
  if to_regclass('private.event_submissions') is null then raise exception 'apply 20261109073519_post_lifecycle_guards.sql first';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.run_post_lifecycle(integer)'::regprocedure)<>'8109cc9eccb687da899ebbb02184e97e' then raise exception 'post lifecycle job drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.set_post_state(uuid,integer,text)'::regprocedure)<>'9163653804850dbce90d4d035c94c899' then raise exception 'post state command drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.delete_post(uuid,integer)'::regprocedure)<>'f59ac8288d0304efbe65d284538bfc6e' then raise exception 'post deletion command drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.post_lifecycle_clock()'::regprocedure)<>'bbb110ca19351a1a6ad197dd946bd331' then raise exception 'post lifecycle clock drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)<>'f83f424d72bac3544ba31d2968683c20' then raise exception 'notification claim drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.frontend_owner_post(uuid,uuid)'::regprocedure)<>'e8b8897f090143a4e4c428e530fd0dc2' then raise exception 'owner post projection drift';end if;
end$$;

-- Every table lock this update needs, taken first and in one fixed order,
-- without waiting: if any of these tables is busy the update stops at once,
-- holding nothing, and can simply be run again. Until it commits (well under
-- a second) no post, event detail, payment or notification can be written.
lock table private.posts in share row exclusive mode nowait;
lock table private.event_details,private.payments in share row exclusive mode nowait;
lock table private.outbox_events in access exclusive mode nowait;

-- The sold notice joins the closed list of notification kinds.
alter table private.outbox_events drop constraint outbox_events_kind_check,
  add constraint outbox_events_kind_check check(kind=any(array['payment_completed'::text,'payment_reversed'::text,
    'payment_reconciliation_required'::text,'trial_started'::text,'post_expired'::text,'post_expiry_reminder'::text,
    'draft_deletion_warning'::text,'post_deleted'::text,'verification_phone_confirmed'::text,'identity_accepted'::text,
    'enquiry_received'::text,'account_warning'::text,'content_hidden'::text,'account_suspended'::text,
    'account_banned'::text,'appeal_decided'::text,'business_check_update'::text,'post_sold'::text]));

-- 5. One 24-hour extension per ended run, while a plan payment started
-- during the 3 days is being confirmed. Removed with the post, and cleared
-- when the post runs again.
create table private.post_deletion_extensions(
  post_id uuid primary key references private.posts(id) on delete cascade,
  ended_at timestamptz not null,
  grace_ended_at timestamptz not null,
  payment_id uuid not null references private.payments(id) on delete cascade,
  extended_at timestamptz not null default statement_timestamp()
);
create index post_deletion_extensions_payment_idx on private.post_deletion_extensions(payment_id);
alter table private.post_deletion_extensions enable row level security;
revoke all on private.post_deletion_extensions from public,anon,authenticated,service_role;

-- 1-3. The deletion clock: 3 days after a run ends; a live or paused event at
-- its end.
create or replace function internal.post_lifecycle_clock()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  -- Publication or a new submission for review starts a new run; a live event
  -- is deleted when it ends. Ending a run starts the 3-day deletion clock once
  -- (an event that ends its run earlier still goes at its end); passing
  -- through paused, draft or rejected (the edit flow does this inside one
  -- transaction) keeps it.
  if new.status in('live','pending_moderation') then
    new.ended_at:=null;
    new.deletes_at:=case when new.kind='event' and new.status='live'
      then (select e.ends_at from private.event_details e where e.post_id=new.id) end;
    delete from private.post_deletion_extensions x where x.post_id=new.id;
  elsif new.status in('expired','sold','archived') then
    if new.ended_at is null then
      new.ended_at:=statement_timestamp();
      new.deletes_at:=case when new.kind='event' and new.deletes_at is not null
        then least(new.deletes_at,new.ended_at+interval '3 days') else new.ended_at+interval '3 days' end;
    else
      new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '3 days');
    end if;
  elsif new.status='paused' and new.kind='event' and new.ended_at is null then
    new.deletes_at:=(select e.ends_at from private.event_details e where e.post_id=new.id);
  end if;
  return new;
end$$;
revoke all on function internal.post_lifecycle_clock() from public,anon,authenticated,service_role;

-- 3. A live or paused event follows a changed end time (the owner's edit of a
-- paused event, or an approved edit of a live one).
create function internal.event_deletion_clock()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  update private.posts p set deletes_at=new.ends_at
    where p.id=new.post_id and p.kind='event' and p.status in('live','paused') and p.ended_at is null
      and p.deletes_at is distinct from new.ends_at;
  return null;
end$$;
revoke all on function internal.event_deletion_clock() from public,anon,authenticated,service_role;
create trigger event_deletion_clock after insert or update of ends_at on private.event_details
  for each row execute function internal.event_deletion_clock();

-- Server job, run every minute by the operations worker. Nothing is kept
-- indefinitely, except while a legal hold or a staff content hold is open.
create or replace function internal.run_post_lifecycle(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare n_expired integer:=0; n_notices integer:=0; n_deleted integer:=0; n_extended integer:=0;
  r record; post private.posts; changed integer; pay_id uuid; extended boolean;
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
  -- invalidates the captured revision first. Expiry and sold notices key on
  -- ended_at, which edits do not move; the ':3d' suffix gives posts that ended
  -- before this update one notice of the 3-day rule. A held post is not warned
  -- about a deletion that will not happen; an idle post's clock counts from
  -- the release of its last staff hold. A paused post that holds a slot is not
  -- idle: it expires with its run.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.ended_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint||':3d' as dedupe_key
      from private.posts p where p.status='expired' and p.kind<>'event'
      union all
      select 'post_sold',p.id,p.owner_id,p.revision,p.ended_at,
        'post_sold:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint
      from private.posts p where p.status='sold'
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
  -- 3. Deletion: ended runs at their deletion date (or earlier, once the
  -- payment behind a 24-hour extension has failed), live and paused events
  -- that have ended, and idle drafts, rejected posts and paused posts without
  -- a slot. Deleting a post releases its slot (posts_release_activation).
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.deletes_at<=clock_timestamp() and (p.status in('expired','sold','archived')
          or (p.kind='event' and p.status in('live','paused') and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))))
        or (p.status in('expired','sold') and exists(select 1 from private.post_deletion_extensions x
          join private.payments pay on pay.id=x.payment_id
          where x.post_id=p.id and x.ended_at=p.ended_at and pay.status not in('pending','complete')))
        or ((p.status in('draft','rejected') or (p.status='paused' and not exists(select 1 from private.post_activations a
            where a.post_id=p.id and a.released_at is null)))
          and greatest(p.content_updated_at,p.status_changed_at,(select max(h.released_at) from private.frontend_content_holds h
            where h.post_id=p.id))<=clock_timestamp()-interval '60 days'
          and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation'
            or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
    order by coalesce(p.deletes_at,p.status_changed_at),p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id
      and ((p.deletes_at<=clock_timestamp() and (p.status in('expired','sold','archived')
          or (p.kind='event' and p.status in('live','paused') and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))))
        or (p.status in('expired','sold') and exists(select 1 from private.post_deletion_extensions x
          join private.payments pay on pay.id=x.payment_id
          where x.post_id=p.id and x.ended_at=p.ended_at and pay.status not in('pending','complete')))
        or ((p.status in('draft','rejected') or (p.status='paused' and not exists(select 1 from private.post_activations a
            where a.post_id=p.id and a.released_at is null)))
          and greatest(p.content_updated_at,p.status_changed_at,(select max(h.released_at) from private.frontend_content_holds h
            where h.post_id=p.id))<=clock_timestamp()-interval '60 days'
          and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation'
            or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))))
      for update of p skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=post.id and h.released_at is null) then continue; end if;
    if post.status in('expired','sold') and post.kind<>'event' and post.deletes_at<=clock_timestamp() then
      extended:=exists(select 1 from private.post_deletion_extensions x where x.post_id=post.id and x.ended_at=post.ended_at);
      if not extended then
        -- The 3 days have ended: a plan payment the owner started during them
        -- and that is still being confirmed moves the deletion date once, by
        -- 24 hours.
        select pay.id into pay_id from private.payments pay
          where pay.owner_id=post.owner_id and pay.product_kind='plan' and pay.status='pending'
            and pay.created_at>=post.ended_at and pay.created_at<=post.deletes_at
          order by pay.created_at desc,pay.id limit 1;
        if found then
          insert into private.post_deletion_extensions(post_id,ended_at,grace_ended_at,payment_id)
            values(post.id,post.ended_at,post.deletes_at,pay_id)
            on conflict(post_id) do update set ended_at=excluded.ended_at,grace_ended_at=excluded.grace_ended_at,
              payment_id=excluded.payment_id,extended_at=excluded.extended_at;
          update private.posts set deletes_at=deletes_at+interval '24 hours' where id=post.id;
          n_extended:=n_extended+1;
          continue;
        end if;
      end if;
    end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  -- Free-event submissions older than every rolling 30-day window.
  delete from private.event_submissions s where s.id in(select x.id from private.event_submissions x
    where x.submitted_at<=clock_timestamp()-interval '31 days' order by x.submitted_at limit p_limit);
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted,'extended',n_extended);
end;
$$;
revoke all on function internal.run_post_lifecycle(integer) from public,anon,authenticated,service_role;
grant execute on function internal.run_post_lifecycle(integer) to service_role;

-- 2, 4. A paused or sold post keeps its slot; only archiving releases it now.
create or replace function internal.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; next_status text; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  next_status := case p_action when 'pause' then 'paused' when 'sold' then 'sold' when 'archive' then 'archived' end;
  if next_status is null then raise exception 'unknown action' using errcode = '22023'; end if;
  -- Match hold placement ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  -- While a staff hold is open the owner cannot change the post's state here:
  -- sold or archived would start its deletion clock.
  if exists (select 1 from private.frontend_content_holds h where h.post_id = post.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode = 'PT423', detail = 'staff_visibility_hold';
  end if;
  if post.status not in ('live', 'paused') or (p_action = 'sold' and post.kind <> 'listing')
    or (p_action = 'pause' and post.status <> 'live') then
    raise exception 'action not available for this post' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if next_status in ('sold', 'archived') then
    delete from private.posts where edit_of = post.id; -- an edit of a finished post is moot
  end if;
  update private.posts set status = next_status, revision = revision + 1 where id = post.id returning revision into rev;
  update private.post_search_documents set is_visible = false where post_id = post.id;
  -- A paused post keeps its slot (its run's clock keeps going, and reactivating
  -- it reuses the slot); a sold post holds its slot until it is deleted, 3
  -- days later or earlier by its owner. Archiving releases the slot now.
  if p_action = 'archive' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'owner'
    where post_id = post.id and released_at is null;
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', next_status, 'revision', rev);
end;
$$;
revoke all on function internal.set_post_state(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.set_post_state(uuid,integer,text) to authenticated;

-- 3. Only an event its owner deletes before it ends returns its place.
create or replace function internal.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  -- Match hold placement/closure ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or post.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.legal_holds h where h.subject_id = actor and h.released_at is null) then
    raise exception 'posts cannot be deleted during a legal hold' using errcode = 'PT409';
  end if;
  if exists (select 1 from private.frontend_content_holds h where h.post_id = post.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode = 'PT423', detail = 'staff_visibility_hold';
  end if;
  -- Owner decision DEC-32 (an owner answer on keeping it is pending; removing
  -- this one statement stops owner deletions returning places): deleting
  -- one's own free event before it ends returns its place in the rolling
  -- submission limit. An event that has ended keeps its place.
  update private.event_submissions set released_at = statement_timestamp(), release_reason = 'owner_deleted'
    where post_id = post.id and owner_id = actor and released_at is null
      and exists (select 1 from private.event_details e where e.post_id = post.id and e.ends_at > statement_timestamp());
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$$;
revoke all on function internal.delete_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.delete_post(uuid,integer) to authenticated;

-- The mail consumer may claim the sold notice once it declares it.
create or replace function internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 18 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where kind=any(p_supported_kinds) and processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') or not exists(select 1 from private.account_closures c where c.user_id=u.id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end;
  return result;
end;
$$;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

-- 7. Owner reads with the deletion date. The original reads stay unchanged
-- for the application already deployed.
create function internal.frontend_owner_post_v2(p_post uuid, p_actor uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
  select internal.frontend_owner_post(p.id,p_actor)||jsonb_build_object('deletes_at',p.deletes_at)
  from private.posts p where p.id=p_post and p.owner_id=p_actor;
$$;
revoke all on function internal.frontend_owner_post_v2(uuid,uuid) from public,anon,authenticated,service_role;

create function internal.get_my_frontend_post_v2(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();result jsonb;begin
  result:=internal.frontend_owner_post_v2(p_id,actor);perform internal.price_draft_actor();return result;
end$$;
revoke all on function internal.get_my_frontend_post_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_post_v2(uuid) to authenticated;
create function api.get_my_frontend_post_v2(p_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_post_v2(p_id)$$;
revoke all on function api.get_my_frontend_post_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_post_v2(uuid) to authenticated;

create function internal.list_my_frontend_posts_v2(p_kind text, p_area text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();rows jsonb;total bigint;begin
  if p_kind is null or p_kind not in('listing','business','event') or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 or (p_area is not null and p_area not in('market','business','tourism_events')) then
    raise exception 'bounded owner post query required' using errcode='22023'; end if;
  select count(*) into total from private.posts p where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area);
  select coalesce(jsonb_agg(internal.frontend_owner_post_v2(p.id,actor) order by p.created_at desc,p.id),'[]'::jsonb) into rows
    from (select id,created_at from private.posts where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area)
      order by created_at desc,id limit p_limit offset p_offset) p;
  perform internal.price_draft_actor();return jsonb_build_object('items',rows,'total',total,'limit',p_limit,'offset',p_offset);
end$$;
revoke all on function internal.list_my_frontend_posts_v2(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_frontend_posts_v2(text,text,integer,integer) to authenticated;
create function api.list_my_frontend_posts_v2(p_kind text, p_area text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.list_my_frontend_posts_v2(p_kind,p_area,p_limit,p_offset)$$;
revoke all on function api.list_my_frontend_posts_v2(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function api.list_my_frontend_posts_v2(text,text,integer,integer) to authenticated;

-- 6. Cutover, last: the backfill makes Postgres re-run the posts table's
-- deferred checks on these rows when the update commits (see the preflight).
-- Already ended: at least 3 days from now.
update private.posts set deletes_at=greatest(statement_timestamp()+interval '3 days',ended_at+interval '3 days')
  where status in('expired','sold','archived');
-- Live and paused events: their end, or 3 days from now when it has passed.
update private.posts p set deletes_at=case when e.ends_at>statement_timestamp() then e.ends_at
    else statement_timestamp()+interval '3 days' end
  from private.event_details e
  where e.post_id=p.id and p.kind='event' and p.status in('live','paused') and p.ended_at is null;
set constraints all immediate;
notify pgrst,'reload schema';
commit;
