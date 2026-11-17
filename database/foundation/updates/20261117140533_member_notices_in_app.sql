-- Members see every account event in the notification bell, not only by email.
--
-- Until now the bell (internal.list_my_frontend_notices, read by the website's
-- /api/notifications) listed only what was written to private.notifications:
-- enquiries, organisation and partner events, moderation notices, business
-- checks and returned ID checks. Many other events queued an email in
-- private.outbox_events and never reached the bell: an accepted ID check
-- ("you are verified"), a confirmed mobile number, payments received, reversed
-- or under review, the introductory allowance, the post lifecycle notices
-- (expired, sold, kept, draft deletion warning, deleted) and the slot renewal
-- reminder. A member whose ID was accepted saw nothing on the website. Post
-- moderation, a staff-issued invoice and a held post shown again after review
-- told the member nothing at all.
--
-- From this update:
-- 1. A new trigger on private.outbox_events (internal.notify_member_of_outbox_event)
--    adds a notice of the same kind for each of those 12 email kinds, through
--    internal.notify_account (which also signals the member's live inbox). It
--    fires only for a row actually inserted, so the outbox's dedupe keys
--    ("on conflict do nothing") and its unlinked-payment skip also keep the bell
--    free of repeats. Kinds that already add their own notice are left alone.
--    It leaves out: notices about a rejected edit's copy (the live post stays;
--    the owner was told the changes were rejected), the second and later lines
--    of one payment reversal, and "payment received" for a payment that could
--    not be applied (its payment_reconciliation_required notice says so). A
--    post notice links its post (and goes when the post is deleted), except
--    post_deleted, written just before the post is removed, which keeps only
--    the post's id as its subject. The trigger never fails the event that
--    caused it: an owner without an account gets no notice. post_expiry_reminder
--    is not mirrored: nothing queues it any more.
-- 2. A new trigger on private.moderation_log (internal.notify_post_moderation)
--    tells the post's owner of each decision: post_approved / post_rejected for
--    a new post, post_changes_approved / post_changes_rejected for an edit. The
--    notice stores no reason; the owner's posts page shows it.
-- 3. A new trigger on private.customer_invoices (internal.notify_invoice_issued)
--    tells the member when staff issue an invoice to their account
--    (invoice_issued), and one on private.frontend_content_holds
--    (internal.notify_content_restored) when a held post is shown again after
--    review (content_restored).
-- 4. internal.notify_frontend_business_check also signals the member's live
--    inbox, so a business check notice appears at once instead of at the next
--    minute's poll.
-- 5. The enquiry-inbox reads (internal.list_my_notifications and
--    internal.list_my_frontend_notifications) list an allowed set of kinds (the
--    eight enquiry, organisation and partner kinds) instead of leaving out the
--    account notices one by one, so no new account notice can reach them.
-- 6. The closed list of notification kinds gains the 18 new kinds.
-- No API signature, grant or command changes. Events before the update are
-- not notified afterwards.
--
-- ORDER: apply this update only once the website release that knows these
-- kinds (the pull request that adds this file) is live. That release works
-- without the update; the website before it cannot read the new notices and
-- would show a member who has one an error instead of their notifications. If
-- that release is ever reverted, run the rollback first. The precondition
-- accepts the reviewed bodies or this update's own, so a repeated run changes
-- nothing.
-- Read-only preflight: ../preflight/20261117140533_member_notices_in_app.check.sql.
-- Rollback: ../rollback/20261117140533_member_notices_in_app.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: every body replaced below is the reviewed one (or already
-- this update's), and the kind list is the reviewed one (or already this
-- update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure)
      not in('7defb01cc11b56fcfc1417dd25127653','7ecfbc9b0bbb788b862f78f6cdfda399') then
    raise exception 'notification list drift: internal.list_my_notifications is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure)
      not in('c6961ccad51ed7b788a43a1c5a4fb505','e397d8e39f9939146339f5b1b368a51c') then
    raise exception 'notification list drift: internal.list_my_frontend_notifications is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_frontend_business_check()'::regprocedure)
      not in('b2b0c8f2ee524951767db095c96f383d','5efb7f8b5ac8b062492d64397a34b1a4') then
    raise exception 'business check notice drift: internal.notify_frontend_business_check is not the reviewed body' using errcode='55000';
  end if;
  if to_regprocedure('internal.notify_member_of_outbox_event()') is not null
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_member_of_outbox_event()'))<>'d05128b61979c38b64b79f94f4d78fa1' then
    raise exception 'internal.notify_member_of_outbox_event exists with another body' using errcode='55000';
  end if;
  if to_regprocedure('internal.notify_post_moderation()') is not null
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_post_moderation()'))<>'910884e45c0034cb341a553c92276833' then
    raise exception 'internal.notify_post_moderation exists with another body' using errcode='55000';
  end if;
  if to_regprocedure('internal.notify_invoice_issued()') is not null
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_invoice_issued()'))<>'5567380db94629f630d381178b8bc36c' then
    raise exception 'internal.notify_invoice_issued exists with another body' using errcode='55000';
  end if;
  if to_regprocedure('internal.notify_content_restored()') is not null
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_content_restored()'))<>'16b6daeb3cb591198347f3ddef44bfda' then
    raise exception 'internal.notify_content_restored exists with another body' using errcode='55000';
  end if;
  if not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','verification_returned']::text[]
      or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','content_restored','draft_deletion_warning','enquiry_received','identity_accepted','invoice_issued','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_kept','post_rejected','post_sold','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[]) then
    raise exception 'kind drift: private.notifications kinds are not the reviewed list' using errcode='55000';
  end if;
end$$;

-- The five tables are locked first, in one order and without waiting: if any
-- is busy (a page reading notifications, the email job, a moderation decision,
-- an invoice or a content hold)
-- the update stops at once, holding nothing, and can simply be run again; it
-- may take a few attempts. Until it commits (well under a second) notifications,
-- queued emails, moderation decisions, invoices and holds can be neither read
-- nor written.
lock table private.notifications,private.outbox_events,private.moderation_log,private.customer_invoices,
  private.frontend_content_holds in access exclusive mode nowait;

alter table private.notifications drop constraint notifications_kind_check,
  add constraint notifications_kind_check check(kind=any(array['enquiry_received'::text,
    'organisation_application_received'::text,'organisation_application_decided'::text,
    'organisation_affiliation_ended'::text,'organisation_sponsorship_activated'::text,
    'organisation_sponsorship_ended'::text,'partner_commission_approved'::text,
    'partner_commission_reversed'::text,'account_warning'::text,'content_hidden'::text,
    'account_suspended'::text,'account_banned'::text,'appeal_decided'::text,
    'business_check_update'::text,'verification_returned'::text,
    'identity_accepted'::text,'verification_phone_confirmed'::text,'payment_completed'::text,
    'payment_reversed'::text,'payment_reconciliation_required'::text,'trial_started'::text,
    'post_expired'::text,'draft_deletion_warning'::text,
    'post_deleted'::text,'post_sold'::text,'post_kept'::text,'slot_renewal_reminder'::text,
    'post_approved'::text,'post_rejected'::text,'post_changes_approved'::text,
    'post_changes_rejected'::text,'invoice_issued'::text,'content_restored'::text]));

CREATE OR REPLACE FUNCTION internal.notify_member_of_outbox_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts;
begin
  -- Only the email kinds that add no notice of their own; enquiries, account
  -- notices, business checks and returned ID checks already do.
  if new.kind not in('identity_accepted','verification_phone_confirmed','payment_completed','payment_reversed',
      'payment_reconciliation_required','trial_started','post_expired','draft_deletion_warning','post_deleted',
      'post_sold','post_kept','slot_renewal_reminder') then
    return null;
  end if;
  -- A notice never fails the event that caused it.
  if not exists(select 1 from auth.users u where u.id=new.owner_id) then return null; end if;
  if new.kind in('post_expired','draft_deletion_warning','post_deleted','post_sold','post_kept') then
    select p.* into post from private.posts p where p.id=new.subject_id;
    -- A rejected edit's copy is warned about and deleted like a post, but the
    -- live post stays; its owner was already told the changes were rejected.
    if post.edit_of is not null then return null; end if;
  end if;
  -- Reversing several lines of one payment queues one email per line: one
  -- notice is enough.
  if new.kind='payment_reversed' and exists(select 1 from private.notifications n where n.account_id=new.owner_id
      and n.kind='payment_reversed' and n.subject_id=new.subject_id and n.created_at>=transaction_timestamp()) then
    return null;
  end if;
  -- A payment that could not be applied also queues payment_reconciliation_required:
  -- "payment received" would contradict it.
  if new.kind='payment_completed' and exists(select 1 from private.payments y where y.id=new.subject_id
      and y.fulfillment_status='needs_reconciliation') then
    return null;
  end if;
  -- A post notice links its post, so it goes with the post. post_deleted is
  -- written just before its post is removed: it keeps the id as subject only.
  perform internal.notify_account(new.owner_id,new.kind,new.subject_id,
    case when new.kind<>'post_deleted' then post.id end,null);
  return null;
end;
$function$;
alter function internal.notify_member_of_outbox_event() owner to postgres;
revoke all on function internal.notify_member_of_outbox_event() from public;
drop trigger if exists notify_member_of_outbox_event on private.outbox_events;
create trigger notify_member_of_outbox_event after insert on private.outbox_events
  for each row execute function internal.notify_member_of_outbox_event();

CREATE OR REPLACE FUNCTION internal.notify_post_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare owner uuid;
begin
  -- post_id is the live post (for an edit, the post the edit changes).
  select p.owner_id into owner from private.posts p where p.id=new.post_id;
  if owner is null or not exists(select 1 from auth.users u where u.id=owner) then return null; end if;
  perform internal.notify_account(owner,
    case when new.edit_id is null then case when new.decision='approve' then 'post_approved' else 'post_rejected' end
      else case when new.decision='approve' then 'post_changes_approved' else 'post_changes_rejected' end end,
    coalesce(new.edit_id,new.post_id),new.post_id,null);
  return null;
end;
$function$;
alter function internal.notify_post_moderation() owner to postgres;
revoke all on function internal.notify_post_moderation() from public;
drop trigger if exists notify_post_moderation on private.moderation_log;
create trigger notify_post_moderation after insert on private.moderation_log
  for each row execute function internal.notify_post_moderation();

CREATE OR REPLACE FUNCTION internal.notify_invoice_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Staff issue an invoice to a member's account: the member is asked to pay it.
  if new.account_id is null or new.status<>'issued' then return null; end if;
  perform internal.notify_account(new.account_id,'invoice_issued',new.id,null,null);
  return null;
end;
$function$;
alter function internal.notify_invoice_issued() owner to postgres;
revoke all on function internal.notify_invoice_issued() from public;
drop trigger if exists notify_invoice_issued on private.customer_invoices;
create trigger notify_invoice_issued after insert on private.customer_invoices
  for each row execute function internal.notify_invoice_issued();

CREATE OR REPLACE FUNCTION internal.notify_content_restored()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Staff released a hold and the hidden post is shown again (the member was
  -- told it was hidden by a content_hidden notice).
  if not new.restored or old.restored or new.post_id is null
    or not exists(select 1 from private.posts p where p.id=new.post_id and p.owner_id=new.account_id) then
    return null;
  end if;
  perform internal.notify_account(new.account_id,'content_restored',new.id,new.post_id,null);
  return null;
end;
$function$;
alter function internal.notify_content_restored() owner to postgres;
revoke all on function internal.notify_content_restored() from public;
drop trigger if exists notify_content_restored on private.frontend_content_holds;
create trigger notify_content_restored after update of restored on private.frontend_content_holds
  for each row execute function internal.notify_content_restored();

CREATE OR REPLACE FUNCTION internal.notify_frontend_business_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare x private.frontend_business_checks;event_id uuid:=gen_random_uuid();
begin
  if tg_table_name='frontend_business_check_messages' then
    if new.author_role<>'staff' then return new;end if;
    select * into x from private.frontend_business_checks where id=new.check_id and status in('pending','info_requested');
    if not found then return new;end if;
  else
    x:=new;
    if not ((new.status is distinct from old.status and (new.status in('approved','rejected') or new.revoked_at is not null))
      or new.scheduled_for is distinct from old.scheduled_for) then return new;end if;
  end if;
  insert into private.notifications(account_id,kind,subject_id,post_id) values(x.owner_id,'business_check_update',event_id,x.business_id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('business_check_update',event_id,x.owner_id,'business_check_update:'||event_id);
  perform internal.signal_owner_inbox(x.owner_id);
  return new;
end$function$;
alter function internal.notify_frontend_business_check() owner to postgres;
revoke all on function internal.notify_frontend_business_check() from public;

CREATE OR REPLACE FUNCTION internal.list_my_notifications(p_before_created timestamp with time zone, p_before_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); items jsonb; last private.notifications; unread integer;
begin
  perform internal.inbox_page_limit(p_limit,p_before_created,p_before_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,
      'organisation_name',o.name,'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc),'[]')
    into items
  from (select * from private.notifications n where n.account_id=actor and n.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
      order by n.created_at desc,n.id desc limit p_limit) n
  left join private.posts p on p.id=n.post_id
  left join private.organisations o on o.id=n.organisation_id;
  select n.* into last from private.notifications n where n.account_id=actor and n.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
    and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
    order by n.created_at desc,n.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id) and n.read_at is null;
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.notifications y where y.account_id=actor and y.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed') and not exists(select 1 from private.notification_dismissals d where d.notification_id=y.id)
        and (y.created_at,y.id)<(last.created_at,last.id))
      then jsonb_build_object('before_created',last.created_at,'before_id',last.id) end);
end;
$function$;
alter function internal.list_my_notifications(timestamp with time zone,uuid,integer) owner to postgres;
revoke all on function internal.list_my_notifications(timestamp with time zone,uuid,integer) from public;
grant execute on function internal.list_my_notifications(timestamp with time zone,uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION internal.list_my_frontend_notifications(p_limit integer, p_unread boolean, p_before timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_unread is null then raise exception 'invalid notification query' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'kind',n.kind,'post_id',n.post_id,'post_title',p.title,'organisation_name',o.name,'organisation_slug',o.slug,
    'created_at',n.created_at,'read_at',n.read_at) order by n.created_at desc,n.id desc)
    from (select * from private.notifications n where n.account_id=actor and n.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed')
      and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (not p_unread or n.read_at is null) and (p_before is null or n.created_at<p_before)
      order by n.created_at desc,n.id desc limit p_limit) n
    left join private.posts p on p.id=n.post_id left join private.organisations o on o.id=n.organisation_id),'[]'::jsonb),
    'unread_count',(select count(*) from private.notifications n where n.account_id=actor and n.kind in('enquiry_received','organisation_application_received','organisation_application_decided','organisation_affiliation_ended','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed') and n.read_at is null)) into result;
  perform internal.price_draft_actor(); return result;
end;
$function$;
alter function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) owner to postgres;
revoke all on function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) from public;
grant execute on function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) to authenticated;

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure)<>'7ecfbc9b0bbb788b862f78f6cdfda399'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure)<>'e397d8e39f9939146339f5b1b368a51c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_frontend_business_check()'::regprocedure)<>'5efb7f8b5ac8b062492d64397a34b1a4'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_member_of_outbox_event()'::regprocedure)<>'d05128b61979c38b64b79f94f4d78fa1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_post_moderation()'::regprocedure)<>'910884e45c0034cb341a553c92276833'
    or not exists(select 1 from pg_trigger where tgname='notify_member_of_outbox_event' and tgrelid='private.outbox_events'::regclass)
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_invoice_issued()'::regprocedure)<>'5567380db94629f630d381178b8bc36c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_content_restored()'::regprocedure)<>'16b6daeb3cb591198347f3ddef44bfda'
    or not exists(select 1 from pg_trigger where tgname='notify_post_moderation' and tgrelid='private.moderation_log'::regclass)
    or not exists(select 1 from pg_trigger where tgname='notify_invoice_issued' and tgrelid='private.customer_invoices'::regclass)
    or not exists(select 1 from pg_trigger where tgname='notify_content_restored' and tgrelid='private.frontend_content_holds'::regclass) then
    raise exception 'member notices in app were not applied';
  end if;
end$$;
commit;
