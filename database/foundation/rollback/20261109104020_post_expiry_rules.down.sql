-- Reviewed rollback for updates/20261109104020_post_expiry_rules.sql.
-- Not part of the replay. Run it only if that update must be undone, after
-- the owner has decided so; prefer a forward fix. If the website release that
-- reads get_my_frontend_post_v2 is live, it falls back to the earlier reads
-- on its own. This file restores the ten function bodies the update replaced
-- (five exactly as after 20261109073519_post_lifecycle_guards.sql, five as
-- before it), drops everything the update added and puts the data back under
-- the earlier rules.
--
-- What is lost or changes on rollback:
-- - Ended posts get their earlier deletion date back (ended_at + 30 days), so
--   they are kept longer; events that have not ended their run lose their
--   deletion date (live ones expire at their end again, others follow the
--   idle rule).
-- - Paused posts (except those hidden by staff) and sold posts release their
--   slots now, as the earlier rules did when they were paused or sold.
-- - Sold and kept notices (post_sold, post_kept), queued or sent, are deleted;
--   payment extensions are dropped. Posts that expired while the update was
--   in place can get a second post_expired email and the 7- and 21-day
--   reminders, whose keys differ from this update's.
-- - Event ends in the past can be saved again, and refunds, chargebacks and
--   sponsorship ends leave paused posts paused, without their slot.
begin;
set local lock_timeout='5s';

-- Preconditions: only the bodies this update installed are rolled back.
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.run_post_lifecycle(integer)'::regprocedure)<>'8dab8e97fe7ff5b8c8d5b1066bf5a5c0' then raise exception 'rollback precondition: internal.run_post_lifecycle(integer) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.set_post_state(uuid,integer,text)'::regprocedure)<>'98119b54e6b1f0de84c7ddfdc20d2e35' then raise exception 'rollback precondition: internal.set_post_state(uuid,integer,text) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.delete_post(uuid,integer)'::regprocedure)<>'2aa04c741c9dee2e414be6ae1f03f73d' then raise exception 'rollback precondition: internal.delete_post(uuid,integer) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.post_lifecycle_clock()'::regprocedure)<>'fa7bdb5ed8d48850ad9a456deceaab8b' then raise exception 'rollback precondition: internal.post_lifecycle_clock() is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)<>'039b1e461ee382e1e2ae7afc31f9d304' then raise exception 'rollback precondition: internal.claim_supported_notification_outbox(text[],integer) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.reverse_payment(uuid,text,text)'::regprocedure)<>'1beb792cd6681782bcb75d4ee8d207a0' then raise exception 'rollback precondition: internal.reverse_payment(uuid,text,text) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.release_sponsorship_entitlement(uuid)'::regprocedure)<>'22d1448929ddae6b57c5bc6f859a5ce2' then raise exception 'rollback precondition: internal.release_sponsorship_entitlement(uuid) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.release_post(uuid,text)'::regprocedure)<>'3651f27e30cf1c88dfb2da1e3a4c6ac3' then raise exception 'rollback precondition: internal.release_post(uuid,text) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.save_business_event_context(uuid,integer,jsonb)'::regprocedure)<>'8258515286151f1f631d27d486967d12' then raise exception 'rollback precondition: internal.save_business_event_context(uuid,integer,jsonb) is not the post expiry rules body';end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.create_core_draft(text,text,text,jsonb,text)'::regprocedure)<>'9f10647ba49984c56a47b99af6c71360' then raise exception 'rollback precondition: internal.create_core_draft(text,text,text,jsonb,text) is not the post expiry rules body';end if;
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
delete from private.outbox_events where kind in('post_sold','post_kept');
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
  update private.posts set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
    where id = any (v_post_ids) and status in ('live', 'pending_moderation');
  update private.post_search_documents set is_visible = false where post_id = any (v_post_ids);
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$function$;
revoke all on function internal.reverse_payment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.reverse_payment(uuid,text,text) to service_role;

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
  update private.posts set status='expired',status_reason='Sponsorship ended',revision=revision+1
    where id=any(v_post_ids) and status in('live','pending_moderation');
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  return cardinality(v_post_ids);
exception when lock_not_available then
  raise exception 'sponsorship is busy; retry the operation' using errcode='PT409',detail='sponsorship_busy';
end;
$function$;
revoke all on function internal.release_sponsorship_entitlement(uuid) from public,anon,authenticated,service_role;

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
  update private.post_activations a set released_at = statement_timestamp(), release_reason = p_reason
  where a.post_id = p_post_id and a.owner_id = actor and a.released_at is null;
  released:=found;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return released;
end;
$function$;
revoke all on function internal.release_post(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.release_post(uuid,text) to authenticated;

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

drop function internal.ended_post_decision(private.posts);
drop function internal.post_idle_deletion_due(private.posts);
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
