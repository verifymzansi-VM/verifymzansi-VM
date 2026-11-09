-- Reviewed rollback for updates/20261109104020_post_expiry_rules.sql.
-- Not part of the replay. Run it only if that update must be undone, after
-- the owner has decided so; prefer a forward fix. Roll the website back first
-- to a release that does not read get_my_frontend_post_v2 or
-- list_my_frontend_posts_v2 and does not declare the post_sold notice. This
-- file restores the five function bodies the update replaced (exactly as
-- after 20261109073519_post_lifecycle_guards.sql), drops everything the
-- update added and puts the data back under the earlier rules.
--
-- What is lost or changes on rollback:
-- - Ended posts get their earlier deletion date back (ended_at + 30 days), so
--   they are kept longer; live and paused events lose their deletion date and
--   expire at their end again.
-- - Paused posts (except those hidden by staff) and sold posts release their
--   slots now, as the earlier rules did when they were paused or sold.
-- - Sold notices (post_sold), queued or sent, are deleted; payment extensions
--   are dropped. Posts that expired while the update was in place can get a
--   second post_expired email and the 7- and 21-day reminders, whose keys
--   differ from this update's.
begin;
set local lock_timeout='5s';

-- Preconditions: only the bodies this update installed are rolled back.
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.run_post_lifecycle(integer)'::regprocedure)<>'3a4bd5f21957cda6acd06cd6c1b19655' then raise exception 'rollback precondition: internal.run_post_lifecycle(integer) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.set_post_state(uuid,integer,text)'::regprocedure)<>'98119b54e6b1f0de84c7ddfdc20d2e35' then raise exception 'rollback precondition: internal.set_post_state(uuid,integer,text) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.delete_post(uuid,integer)'::regprocedure)<>'2aa04c741c9dee2e414be6ae1f03f73d' then raise exception 'rollback precondition: internal.delete_post(uuid,integer) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.post_lifecycle_clock()'::regprocedure)<>'89e028ae43b37977cd39c060adc65c20' then raise exception 'rollback precondition: internal.post_lifecycle_clock() is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)<>'04e8ce800583aefd164a49840cb24748' then raise exception 'rollback precondition: internal.claim_supported_notification_outbox(text[],integer) is not the post expiry rules body';end if;
end$$;

-- Dropping the trigger and the extension table needs exclusive locks on the
-- tables they belong to or reference; take them all first, without waiting.
lock table private.posts in access exclusive mode nowait;
lock table private.event_details,private.payments,private.outbox_events in access exclusive mode nowait;

-- Everything the update added. Table changes come before the data changes
-- below, whose deferred checks would otherwise block them.
drop trigger event_deletion_clock on private.event_details;
drop function internal.event_deletion_clock();
drop function api.get_my_frontend_post_v2(uuid);
drop function internal.get_my_frontend_post_v2(uuid);
drop function api.list_my_frontend_posts_v2(text,text,integer,integer);
drop function internal.list_my_frontend_posts_v2(text,text,integer,integer);
drop function internal.frontend_owner_post_v2(uuid,uuid);
delete from private.outbox_events where kind='post_sold';
alter table private.outbox_events drop constraint outbox_events_kind_check,
  add constraint outbox_events_kind_check check(kind=any(array['payment_completed'::text,'payment_reversed'::text,
    'payment_reconciliation_required'::text,'trial_started'::text,'post_expired'::text,'post_expiry_reminder'::text,
    'draft_deletion_warning'::text,'post_deleted'::text,'verification_phone_confirmed'::text,'identity_accepted'::text,
    'enquiry_received'::text,'account_warning'::text,'content_hidden'::text,'account_suspended'::text,
    'account_banned'::text,'appeal_decided'::text,'business_check_update'::text]));

-- The bodies as they were before the update.
CREATE OR REPLACE FUNCTION internal.post_lifecycle_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Publication or a new submission for review starts a new run. Ending a run
  -- starts the deletion clock once; passing through paused, draft or rejected
  -- (the edit flow does this inside one transaction) keeps it.
  if new.status in('live','pending_moderation') then
    new.ended_at:=null;new.deletes_at:=null;
  elsif new.status in('expired','sold','archived') then
    new.ended_at:=coalesce(new.ended_at,statement_timestamp());
    new.deletes_at:=coalesce(new.deletes_at,new.ended_at+interval '30 days');
  end if;
  return new;
end$function$;
revoke all on function internal.post_lifecycle_clock() from public,anon,authenticated,service_role;

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
  -- the captured revision before its stale reminder can be queued. Expiry
  -- notices key on ended_at, which edits do not move. A held post is not
  -- warned about a deletion that will not happen; an idle post's clock counts
  -- from the release of its last staff hold.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.ended_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint as dedupe_key
      from private.posts p where p.status='expired'
      union all
      select 'post_expiry_reminder',p.id,p.owner_id,p.revision,p.ended_at+make_interval(days=>d.day),
        'post_expiry_reminder:'||p.id||':'||d.day||':'||floor(extract(epoch from p.ended_at))::bigint
      from private.posts p cross join (values(7),(21)) d(day)
      where p.status='expired' and p.ended_at<=clock_timestamp()-make_interval(days=>d.day)
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,i.idle_since+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from i.idle_since))::bigint
      from private.posts p cross join lateral (select greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id)) as idle_since) i
      where p.status in('draft','rejected','paused') and i.idle_since<=clock_timestamp()-interval '45 days'
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
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and p.deletes_at<=clock_timestamp())
      or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id))<=clock_timestamp()-interval '60 days'))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
      and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))
    order by p.status_changed_at,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and
      ((p.status in('expired','sold','archived') and p.deletes_at<=clock_timestamp())
       or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at,
         (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id))<=clock_timestamp()-interval '60 days'))
      for update of p skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=post.id and h.released_at is null)
      or exists(select 1 from private.posts e where e.edit_of=post.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days')) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  -- Free-event submissions older than every rolling 30-day window.
  delete from private.event_submissions s where s.id in(select x.id from private.event_submissions x
    where x.submitted_at<=clock_timestamp()-interval '31 days' order by x.submitted_at limit p_limit);
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted);
end;
$function$;
revoke all on function internal.run_post_lifecycle(integer) from public,anon,authenticated,service_role;
grant execute on function internal.run_post_lifecycle(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  update private.post_activations set released_at = statement_timestamp(),
    release_reason = case when p_action = 'sold' then 'sold' else 'owner' end
  where post_id = post.id and released_at is null;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', next_status, 'revision', rev);
end;
$function$;
revoke all on function internal.set_post_state(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.set_post_state(uuid,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.delete_post(p_post_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  -- Owner decision DEC-32: deleting one's own free event returns its place in
  -- the rolling submission limit.
  update private.event_submissions set released_at = statement_timestamp(), release_reason = 'owner_deleted'
    where post_id = post.id and owner_id = actor and released_at is null;
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$function$;
revoke all on function internal.delete_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.delete_post(uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 17 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
$function$;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

drop table private.post_deletion_extensions;

-- The data under the earlier rules.
update private.post_activations a set released_at=statement_timestamp(),
    release_reason=case when p.status='sold' then 'sold' else 'owner' end
  from private.posts p
  where p.id=a.post_id and a.released_at is null
    and (p.status='sold' or (p.status='paused' and coalesce(p.status_reason,'') not like 'staff\_%'
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)));
update private.posts set deletes_at=ended_at+interval '30 days' where status in('expired','sold','archived');
update private.posts set deletes_at=null where status not in('expired','sold','archived') and deletes_at is not null;
set constraints all immediate;
notify pgrst,'reload schema';
commit;
