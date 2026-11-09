-- Post expiry rules (owner decisions of 9 November 2026). Apply after
-- 20261109073519_post_lifecycle_guards.sql, which this update builds on.
--
-- 1. Market and Business posts hold a plan slot. When a post's paid run ends
--    (visible_until, or a refund, chargeback or sponsorship end of the plan
--    funding it), the post expires, releases its slot and its owner gets the
--    post_expired notice. It stays hidden for 3 days, during which its owner
--    can buy a plan and reactivate it; then the lifecycle job deletes it with
--    its media. The 7- and 21-day reminders are no longer queued.
-- 2. A sold post keeps its slot until it is deleted, 3 days after it was
--    marked sold (notice post_sold, once per sale and slot, even when a
--    refund later frees the slot, and not again when "sold" is undone and
--    redone with the same slot). Its owner can delete it
--    earlier to reuse the slot, or reactivate it within the 3 days: it then
--    runs for the slot's remaining days while that slot is still valid.
--    api.release_post no longer frees the slot of a paused or sold post.
--    Archiving (not offered by the website, only by api.set_post_state)
--    releases the slot at once and is deleted 3 days later, without a notice.
-- 3. An event is deleted when it ends (event_details.ends_at), whatever its
--    state (draft, under review, rejected, live or paused), with no grace
--    period and no expiry notice (the 3 days that item 6 gives an event already
--    over stay through later changes of its state). Its end can only be set or
--    moved to a time still ahead. Its place in the limit of 10 free events per 30 days returns
--    only when its owner deletes it before it ends; deletion by the job never
--    returns it.
-- 4. Pausing keeps the slot and does not stop the run's clock: a paused post
--    that holds a slot expires like a live one, and reactivating it spends no
--    further activation. A paused post holding a slot is not deleted as idle;
--    paused posts without a slot (paused before this update, or held by staff
--    when their plan was reversed) keep the 45/60-day idle rule.
-- 5. Late payment, for an expired Market or Business post (a sold or
--    archived post goes at its date). Plan payments count when they were
--    started from 24 hours before the post expired (a last-minute renewal)
--    until its deletion date. One still being confirmed when the 3 days end (a
--    confirmed one still being reconciled counts) extends the deletion date
--    once, by 24 hours, and a payment started during that extension counts
--    too. Once such a payment is confirmed, the post is kept until 3 days after
--    that payment (notice post_kept) for its owner to reactivate it. The 24
--    hours are always waited out: a failed, cancelled or expired payment can
--    still be confirmed late by the provider. A payment confirmed only after
--    the post was deleted is a refund case for staff.
-- 5b. A post with an open report (not yet handled by staff) is kept until the
--    report is handled, for at most 7 days after its deletion date; staff can
--    place a hold to keep it longer.
-- 6. Nothing that has already ended is deleted sooner than 3 days after this
--    update: expired, sold and archived posts get the later of now + 3 days
--    and ended_at + 3 days, and their owners get the new notice once (expired
--    events and archived posts excepted). Events that have not ended their run
--    get their end, or now + 3 days when it has already passed.
-- 7. Owner reads get_my_frontend_post_v2 and list_my_frontend_posts_v2 add
--    deletes_at to the owner's post data, and the mail claim adds the deletion
--    date and whether the post still holds a slot. The original reads are
--    unchanged and the mail claim still accepts the earlier list of kinds, so
--    the website release before this update keeps working with it.
-- Staff content holds and legal holds keep protecting posts as before. A post
-- whose deletion date passes during a legal hold is deleted at the first run
-- after the hold is released; it gets the post_deleted notice, not a new
-- expiry notice. There is no dispute state: to keep a refunded or charged-back
-- post during a dispute, staff place a legal hold. Recent edit copies no
-- longer keep an ended post or an ended event (they can never be approved);
-- they still keep idle drafts, rejected and paused posts as before.
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
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.reverse_payment(uuid,text,text)'::regprocedure)<>'656860e5d35805deef5a0ecefedde383' then raise exception 'payment reversal drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.release_sponsorship_entitlement(uuid)'::regprocedure)<>'e969eedf5de7989b97e72c5f503b72e2' then raise exception 'sponsorship release drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.release_post(uuid,text)'::regprocedure)<>'6c9d484c84696e5dee3b4c6d5224eca6' then raise exception 'slot release drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.save_business_event_context(uuid,integer,jsonb)'::regprocedure)<>'101bd2edc9282611d0ded321c0d005c2' then raise exception 'event context drift';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.create_core_draft(text,text,text,jsonb,text)'::regprocedure)<>'1d6f9ed1dc5cea850f733256a8a99834' then raise exception 'draft creation drift';end if;
end$$;

-- Every table lock this update needs, taken first and in one fixed order,
-- without waiting: if any of these tables is busy the update stops at once,
-- holding nothing, and can simply be run again. Until it commits (well under
-- a second) no post, event detail, payment, report or notification can be
-- written.
lock table private.posts in exclusive mode nowait;
lock table private.event_details,private.payments,private.reports in share row exclusive mode nowait;
lock table private.outbox_events in access exclusive mode nowait;

-- The sold and kept notices join the closed list of notification kinds.
alter table private.outbox_events drop constraint outbox_events_kind_check,
  add constraint outbox_events_kind_check check(kind=any(array['payment_completed'::text,'payment_reversed'::text,
    'payment_reconciliation_required'::text,'trial_started'::text,'post_expired'::text,'post_expiry_reminder'::text,
    'draft_deletion_warning'::text,'post_deleted'::text,'verification_phone_confirmed'::text,'identity_accepted'::text,
    'enquiry_received'::text,'account_warning'::text,'content_hidden'::text,'account_suspended'::text,
    'account_banned'::text,'appeal_decided'::text,'business_check_update'::text,'post_sold'::text,'post_kept'::text]));

-- 5. The lifecycle job looks up an owner's recent plan payments every minute.
create index payments_owner_plan_created_idx on private.payments(owner_id,created_at) where product_kind='plan';
-- 5b. ... and whether a post due for deletion has an open report.
create index reports_open_post_idx on private.reports(post_id) where status='open';

-- 5. The late-payment state of an ended run: one 24-hour extension, and the
-- confirmed payment that keeps the post. Removed with the post, and cleared
-- when the post runs again.
create table private.post_deletion_extensions(
  post_id uuid primary key references private.posts(id) on delete cascade,
  ended_at timestamptz not null,
  grace_ended_at timestamptz not null,
  payment_id uuid not null references private.payments(id) on delete cascade,
  extended_at timestamptz not null default statement_timestamp(),
  kept_at timestamptz
);
create index post_deletion_extensions_payment_idx on private.post_deletion_extensions(payment_id);
alter table private.post_deletion_extensions enable row level security;
revoke all on private.post_deletion_extensions from public,anon,authenticated,service_role;

-- 1-3. The deletion clock: 3 days after a run ends; an event at its end.
create or replace function internal.post_lifecycle_clock()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  -- Ending a run (expired, sold, archived) starts the 3-day deletion clock
  -- once; an event that ends its run earlier still goes at its end. Passing
  -- through paused (the edit flow does this inside one transaction) keeps it.
  if new.status in('expired','sold','archived') then
    if new.ended_at is null then
      new.ended_at:=statement_timestamp();
      new.deletes_at:=case when new.kind='event' and new.deletes_at is not null
        then least(new.deletes_at,new.ended_at+interval '3 days') else new.ended_at+interval '3 days' end;
    else
      new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '3 days');
    end if;
  else
    -- Publication or a new submission for review starts a new run.
    if new.status in('live','pending_moderation') then
      new.ended_at:=null;
      delete from private.post_deletion_extensions x where x.post_id=new.id;
    end if;
    -- Outside an ended run only an event has a deletion date: its end (an
    -- edit copy goes with its original), or the later date the cutover gave
    -- an event already over. A changed end is followed by event_deletion_clock.
    if new.ended_at is null then
      new.deletes_at:=case when new.kind='event' and new.edit_of is null
        then greatest((select e.ends_at from private.event_details e where e.post_id=new.id),new.deletes_at) end;
    end if;
  end if;
  return new;
end$$;
revoke all on function internal.post_lifecycle_clock() from public,anon,authenticated,service_role;

-- 3. An event follows a changed end time (the owner's edit of an event that
-- is not live, or an approved edit of a live one).
create function internal.event_deletion_clock()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  update private.posts p set deletes_at=new.ends_at
    where p.id=new.post_id and p.kind='event' and p.edit_of is null and p.ended_at is null
      and p.status not in('expired','sold','archived') and p.deletes_at is distinct from new.ends_at;
  return null;
end$$;
revoke all on function internal.event_deletion_clock() from public,anon,authenticated,service_role;
create trigger event_deletion_clock after insert or update of ends_at on private.event_details
  for each row execute function internal.event_deletion_clock();

-- 5. What the lifecycle job does with an ended post, as
-- {"action":"delete"} or {"action":"extend"|"keep","payment_id",
-- "grace_ended_at","deletes_at"}, or null when nothing is due yet.
create function internal.ended_post_decision(p_post private.posts)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare ext private.post_deletion_extensions; window_end timestamptz; paid record; started record;
begin
  if p_post.status not in('expired','sold','archived') then return null; end if;
  -- Only an expired Market or Business post waits for a plan payment.
  if p_post.kind='event' or p_post.status<>'expired' then
    return case when p_post.deletes_at<=clock_timestamp() then jsonb_build_object('action','delete') end;
  end if;
  select * into ext from private.post_deletion_extensions x where x.post_id=p_post.id and x.ended_at=p_post.ended_at;
  -- Plan payments count when started from 24 hours before the post expired
  -- until its deletion date, the 24-hour extension included.
  window_end:=coalesce(ext.grace_ended_at+interval '24 hours',p_post.deletes_at);
  -- One has been confirmed: the post is kept until 3 days after that payment.
  select pay.id,pay.completed_at into paid from private.payments pay
    where pay.owner_id=p_post.owner_id and pay.product_kind='plan' and pay.status='complete'
      and pay.fulfillment_status='fulfilled' and pay.created_at>=p_post.ended_at-interval '24 hours'
      and pay.created_at<=window_end
    order by pay.completed_at desc,pay.id limit 1;
  if paid.completed_at+interval '3 days'>p_post.deletes_at then
    return jsonb_build_object('action','keep','payment_id',paid.id,
      'grace_ended_at',coalesce(ext.grace_ended_at,p_post.deletes_at),'deletes_at',paid.completed_at+interval '3 days');
  end if;
  if p_post.deletes_at>clock_timestamp() then return null; end if;
  -- Due: one 24-hour extension while such a payment is still being confirmed
  -- (a confirmed payment still being reconciled counts). The extension is
  -- always waited out; after it the post goes.
  if ext.post_id is null then
    select pay.id into started from private.payments pay
      where pay.owner_id=p_post.owner_id and pay.product_kind='plan'
        and pay.created_at>=p_post.ended_at-interval '24 hours' and pay.created_at<=p_post.deletes_at
        and (pay.status='pending' or (pay.status='complete' and pay.fulfillment_status='needs_reconciliation'))
      order by pay.created_at desc,pay.id limit 1;
    if started.id is not null then
      return jsonb_build_object('action','extend','payment_id',started.id,'grace_ended_at',p_post.deletes_at,
        'deletes_at',p_post.deletes_at+interval '24 hours');
    end if;
  end if;
  return jsonb_build_object('action','delete');
end$$;
revoke all on function internal.ended_post_decision(private.posts) from public,anon,authenticated,service_role;

-- 5b. A post with an open report is kept until the report is handled, for at
-- most 7 days after the date it would otherwise be deleted (its deletion date,
-- or 60 days after an idle post's last change).
create function internal.post_report_deferred(p_post private.posts)
returns boolean language sql set search_path=pg_catalog as $$
  select exists(select 1 from private.reports r where r.post_id=p_post.id and r.status='open')
    and clock_timestamp()<coalesce(p_post.deletes_at,greatest(p_post.content_updated_at,p_post.status_changed_at,
      (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p_post.id))+interval '60 days')
      +interval '7 days';
$$;
revoke all on function internal.post_report_deferred(private.posts) from public,anon,authenticated,service_role;

-- 4. An idle draft, rejected post or paused post without a slot, 60 days
-- after its last change (or the release of its last staff hold), unless a
-- recent or waiting edit copy still belongs to it.
create function internal.post_idle_deletion_due(p_post private.posts)
returns boolean language sql set search_path=pg_catalog as $$
  select (p_post.status in('draft','rejected') or (p_post.status='paused' and not exists(select 1 from private.post_activations a
      where a.post_id=p_post.id and a.released_at is null)))
    and greatest(p_post.content_updated_at,p_post.status_changed_at,(select max(h.released_at) from private.frontend_content_holds h
      where h.post_id=p_post.id))<=clock_timestamp()-interval '60 days'
    and not exists(select 1 from private.posts e where e.edit_of=p_post.id and (e.status='pending_moderation'
      or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'));
$$;
revoke all on function internal.post_idle_deletion_due(private.posts) from public,anon,authenticated,service_role;

-- Server job, run every minute by the operations worker. Nothing is kept
-- indefinitely, except while a legal hold or a staff content hold is open.
create or replace function internal.run_post_lifecycle(p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  -- the slot the post was sold in (its last activation, released or not), so
  -- neither a refund freeing the slot nor undoing and redoing "sold" repeats it.
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
          where a.post_id=p.id and a.activated_at<=p.ended_at order by a.activated_at desc,a.id desc limit 1),'none')
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
  -- drafts, rejected posts and paused posts without a slot, unless an open
  -- report keeps the post a little longer (internal.post_report_deferred).
  -- Deleting a post releases its slot (posts_release_activation). The payment
  -- rule is evaluated only for posts that are due or whose owner has confirmed
  -- a recent plan payment.
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and (p.deletes_at<=clock_timestamp()
          or (p.status='expired' and p.kind<>'event' and exists(select 1 from private.payments pay
            where pay.owner_id=p.owner_id and pay.product_kind='plan' and pay.created_at>=p.ended_at-interval '24 hours'
              and pay.status='complete' and pay.fulfillment_status='fulfilled')))
          and internal.ended_post_decision(p) is not null)
        or (p.kind='event' and p.edit_of is null and p.status not in('expired','sold','archived')
          and p.deletes_at<=clock_timestamp() and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))
        or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'
          and internal.post_idle_deletion_due(p)))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
      and not internal.post_report_deferred(p)
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
    if internal.post_report_deferred(post) then continue; end if;
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

-- 1. A refund or chargeback also ends the run of a paused post the payment
-- funded (unless a staff hold keeps it): it expires with the 3-day clock.
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
revoke all on function internal.reverse_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.reverse_payment(uuid,text,text) to service_role;

-- 1. So does the end of a sponsored place.
CREATE OR REPLACE FUNCTION internal.release_sponsorship_entitlement(p_entitlement uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_post_ids uuid[];
begin
  if p_entitlement is null then return 0; end if;
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p nowait;
  perform e.id from private.entitlements e where e.id=p_entitlement for update nowait;
  -- Re-read after the entitlement lock: an activation may have committed
  -- since the first post scan. Never wait on a newly discovered post here.
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p nowait;
  update private.entitlements set status='revoked',revoked_reason='sponsorship_ended'
    where id=p_entitlement and status<>'revoked';
  with released as (
    update private.post_activations a set released_at=statement_timestamp(),release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null returning a.post_id)
  select coalesce(array_agg(post_id) filter(where post_id is not null),'{}') into v_post_ids from released;
  update private.posts p set status='expired',status_reason='Sponsorship ended',revision=revision+1
    where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
      or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
        where h.post_id=p.id and h.released_at is null)));
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  return cardinality(v_post_ids);
exception when lock_not_available then
  raise exception 'sponsorship is busy; retry the operation' using errcode='PT409',detail='sponsorship_busy';
end;
$function$;
revoke all on function internal.release_sponsorship_entitlement(uuid) from public,anon,authenticated,service_role;

-- 2, 4. A paused or sold post keeps its slot until it is deleted; the owner
-- frees it by deleting the post.
CREATE OR REPLACE FUNCTION internal.release_post(p_post_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); post private.posts; released boolean;
begin
  if p_reason is null or p_reason not in ('owner', 'sold') then raise exception 'invalid release reason' using errcode = '22023'; end if;
  select p.* into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.status in ('live','pending_moderation') then
    raise exception 'use the revision-fenced post lifecycle to release published funding' using errcode='22023';
  end if;
  if post.status in ('paused','sold') then
    raise exception 'a paused or sold post keeps its slot until it is deleted' using errcode='22023';
  end if;
  update private.post_activations a set released_at = statement_timestamp(), release_reason = p_reason
  where a.post_id = p_post_id and a.owner_id = actor and a.released_at is null;
  released:=found;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return released;
end;
$function$;
revoke all on function internal.release_post(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.release_post(uuid,text) to authenticated;

-- 3. An event's end can only move to a time still ahead: an end in the past
-- would have the lifecycle job delete the event at once.
CREATE OR REPLACE FUNCTION internal.save_business_event_context(p_post_id uuid, p_expected_revision integer, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post private.posts; c jsonb:=p_patch; w jsonb;
  activity text; starts timestamptz; ends timestamptz; zone text; rev integer;
begin
  -- The original precedes its copy, matching content, moderation and discard.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text)>1024 or c='{}'::jsonb
    or not(array(select jsonb_object_keys(c)) <@ array['activity_key','event_window','business_type']) then
    raise exception 'invalid context patch' using errcode='22023';
  end if;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  if not found or post.kind not in ('business','event') then
    raise exception 'business or event not found' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'this context cannot be edited now' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  if c ? 'business_type' then
    if post.kind<>'business' or jsonb_typeof(c->'business_type') not in ('string','null')
      or (c->>'business_type' is not null and c->>'business_type' not in
        ('mall_store','standalone_shop','home_business','mobile_service','online_only','market_stall')) then
      raise exception 'invalid business type' using errcode='22023';
    end if;
    update private.business_details set business_type=c->>'business_type' where post_id=post.id;
    if not found then raise exception 'business detail not found' using errcode='22023'; end if;
  end if;
  activity:=post.activity_key;
  if c ? 'activity_key' then
    if jsonb_typeof(c->'activity_key') not in ('string','null')
      or (c->>'activity_key' is not null and (c->>'activity_key') !~ '^[a-z][a-z0-9_]{0,79}$') then
      raise exception 'invalid activity' using errcode='22023';
    end if;
    activity:=c->>'activity_key';
    if activity is null and exists(select 1 from private.categories k where k.key=post.category_key and k.activity_required)
      or activity is not null and not exists(select 1 from private.category_activities a where a.category_key=post.category_key and a.key=activity) then
      raise exception 'activity does not meet the category rules' using errcode='22023';
    end if;
  end if;
  if c ? 'event_window' then
    w:=c->'event_window';
    if post.kind<>'event' or jsonb_typeof(w) is distinct from 'object' or octet_length(w::text)>512
      or not(array(select jsonb_object_keys(w)) <@ array['starts_at','ends_at','timezone'])
      or jsonb_typeof(w->'starts_at') is distinct from 'string' or jsonb_typeof(w->'ends_at') is distinct from 'string'
      or jsonb_typeof(w->'timezone') is distinct from 'string'
      or (w->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (w->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'complete event window required' using errcode='22023';
    end if;
    begin
      starts:=(w->>'starts_at')::timestamptz; ends:=(w->>'ends_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid event instant' using errcode='22023';
    end;
    zone:=w->>'timezone';
    if not isfinite(starts) or not isfinite(ends)
      or extract(year from starts at time zone 'UTC') not between 1 and 9999
      or extract(year from ends at time zone 'UTC') not between 1 and 9999
      or starts<>date_trunc('milliseconds',starts) or ends<>date_trunc('milliseconds',ends)
      or ends<=starts or ends-starts>interval '90 days'
      or not exists(select 1 from private.post_event_timezones z where z.name=zone) then
      raise exception 'invalid event window' using errcode='22023';
    end if;
    if ends<=clock_timestamp() then
      raise exception 'event end must be in the future' using errcode='22023';
    end if;
    update private.event_details set starts_at=starts,ends_at=ends,timezone=zone where post_id=post.id;
    if not found then raise exception 'event detail not found' using errcode='22023'; end if;
  end if;
  update private.posts set activity_key=activity,revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev);
end;
$function$;
revoke all on function internal.save_business_event_context(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_business_event_context(uuid,integer,jsonb) to authenticated;

-- 3. A new event must end in the future for the same reason.
CREATE OR REPLACE FUNCTION internal.create_core_draft(p_kind text, p_area text, p_category_key text, p_detail jsonb, p_activity_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text; stored_activity text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if exists(select 1 from private.categories c where c.key=p_category_key and c.activity_required)
    and p_activity_key is null then
    raise exception 'activity required for this category' using errcode='22023';
  end if;
  if p_activity_key is not null and not exists(select 1 from private.category_activities a
    where a.category_key=p_category_key and a.key=p_activity_key) then
    raise exception 'activity does not belong to this category' using errcode='22023';
  end if;
  if jsonb_typeof(p_detail) is distinct from 'object' or octet_length(p_detail::text)>512 then
    raise exception 'invalid detail payload' using errcode='22023';
  end if;
  if p_kind='event' then
    if not(array(select jsonb_object_keys(p_detail)) <@ array['starts_at','ends_at','timezone','contact_channels'])
      or jsonb_typeof(p_detail->'starts_at') is distinct from 'string' or jsonb_typeof(p_detail->'ends_at') is distinct from 'string'
      or jsonb_typeof(p_detail->'timezone') is distinct from 'string'
      or (p_detail->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (p_detail->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'explicit event window required' using errcode='22023';
    end if;
    starts:=(p_detail->>'starts_at')::timestamptz; ends:=(p_detail->>'ends_at')::timestamptz; tz:=p_detail->>'timezone';
    if not exists(select 1 from private.post_event_timezones z where z.name=tz) then
      raise exception 'supported IANA timezone required' using errcode='22023';
    end if;
    if ends<=clock_timestamp() then
      raise exception 'event end must be in the future' using errcode='22023';
    end if;
  elsif p_kind='business' and p_detail<>'{}'::jsonb then
    raise exception 'business detail fields are not implemented' using errcode='22023';
  elsif p_kind='listing' and p_detail-'contact_channels'<>'{}'::jsonb then raise exception 'detail fields not implemented in this identity fixture' using errcode='22023';
  end if;
  if p_detail ? 'contact_channels' then
    perform internal.canonical_post_channels(p_detail->'contact_channels');
  end if;
  -- Draft allowance (DEC-29): 5 plus 1 per post in the owner's current
  -- packages (internal.draft_allowance in publication.sql). Edit copies are
  -- not counted. Never accept a caller-provided limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,417));
  if (select count(*) from private.posts p where p.owner_id=actor and p.status='draft' and p.edit_of is null)
      >=internal.draft_allowance(actor) then
    raise exception 'draft limit reached' using errcode='PT429';
  end if;
  insert into private.posts(owner_id,kind,area,category_key,activity_key) values(actor,p_kind,p_area,p_category_key,p_activity_key) returning id,activity_key into post,stored_activity;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  if p_detail ? 'contact_channels' then
    insert into private.post_contacts(post_id,post_kind,channels)
      values(post,p_kind,internal.canonical_post_channels(p_detail->'contact_channels'));
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1)
    || case when stored_activity is not null then jsonb_build_object('activity_key',stored_activity) else '{}'::jsonb end;
end;
$function$;
revoke all on function internal.create_core_draft(text,text,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_core_draft(text,text,text,jsonb,text) to authenticated;

-- 7. The mail consumer may claim the sold and kept notices once it declares
-- them; the earlier list of kinds stays valid. Each job carries the post's
-- deletion date and whether it still holds a slot, for the notice's text.
create or replace function internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 19 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end) order by o.created_at,o.id),'[]'::jsonb)
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
-- Events that have not ended their run: their end, or 3 days from now when it
-- has passed.
update private.posts p set deletes_at=case when e.ends_at>statement_timestamp() then e.ends_at
    else statement_timestamp()+interval '3 days' end
  from private.event_details e
  where e.post_id=p.id and p.kind='event' and p.edit_of is null and p.ended_at is null
    and p.status not in('expired','sold','archived');
set constraints all immediate;
notify pgrst,'reload schema';
commit;
