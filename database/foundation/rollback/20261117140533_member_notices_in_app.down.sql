-- Reviewed rollback for updates/20261117140533_member_notices_in_app.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It drops the two new triggers and
-- their functions, restores the previous bodies of internal.list_my_notifications,
-- internal.list_my_frontend_notifications and
-- internal.notify_frontend_business_check byte for byte, and the previous
-- closed list of notification kinds. To restore that list it deletes every
-- notification of the 17 new kinds (and their dismissals): members lose those
-- notices. Queued emails are untouched. Events after the rollback reach the
-- bell only as they did before the update.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure) is distinct from '7ecfbc9b0bbb788b862f78f6cdfda399'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure) is distinct from 'e397d8e39f9939146339f5b1b368a51c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_frontend_business_check()'::regprocedure) is distinct from '5efb7f8b5ac8b062492d64397a34b1a4'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_member_of_outbox_event()')) is distinct from '5b7257d168070e6be5d8ba1a0893989a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.notify_post_moderation()')) is distinct from '910884e45c0034cb341a553c92276833' then
    raise exception 'rollback precondition: the member notices in app update is not applied' using errcode='55000';
  end if;
  -- The kind list is this update's, so no later kind is dropped.
  if (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','payment_completed','payment_reconciliation_required','payment_reversed','post_approved','post_changes_approved','post_changes_rejected','post_deleted','post_expired','post_expiry_reminder','post_kept','post_rejected','post_sold','slot_renewal_reminder','trial_started','verification_phone_confirmed','verification_returned']::text[] then
    raise exception 'rollback precondition: private.notifications kinds are not the reviewed list' using errcode='55000';
  end if;
end$$;

lock table private.notifications,private.outbox_events,private.moderation_log in access exclusive mode nowait;

drop trigger notify_member_of_outbox_event on private.outbox_events;
drop trigger notify_post_moderation on private.moderation_log;
drop function internal.notify_member_of_outbox_event();
drop function internal.notify_post_moderation();
delete from private.notifications where kind in('identity_accepted','verification_phone_confirmed','payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','post_sold','post_kept','slot_renewal_reminder','post_approved',
  'post_rejected','post_changes_approved','post_changes_rejected');
alter table private.notifications drop constraint notifications_kind_check,
  add constraint notifications_kind_check check(kind=any(array['enquiry_received'::text,
    'organisation_application_received'::text,'organisation_application_decided'::text,
    'organisation_affiliation_ended'::text,'organisation_sponsorship_activated'::text,
    'organisation_sponsorship_ended'::text,'partner_commission_approved'::text,
    'partner_commission_reversed'::text,'account_warning'::text,'content_hidden'::text,
    'account_suspended'::text,'account_banned'::text,'appeal_decided'::text,
    'business_check_update'::text,'verification_returned'::text]));

-- The bodies as they were before the update.
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
  from (select * from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
      order by n.created_at desc,n.id desc limit p_limit) n
  left join private.posts p on p.id=n.post_id
  left join private.organisations o on o.id=n.organisation_id;
  select n.* into last from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
    and (p_before_created is null or (n.created_at,n.id)<(p_before_created,p_before_id))
    order by n.created_at desc,n.id desc offset p_limit-1 limit 1;
  select count(*) into unread from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id) and n.read_at is null;
  return jsonb_build_object('items',items,'unread_count',unread,
    'next_cursor',case when last.id is not null and exists(select 1 from private.notifications y where y.account_id=actor and y.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') and not exists(select 1 from private.notification_dismissals d where d.notification_id=y.id)
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
    from (select * from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned')
      and not exists(select 1 from private.notification_dismissals d where d.notification_id=n.id)
      and (not p_unread or n.read_at is null) and (p_before is null or n.created_at<p_before)
      order by n.created_at desc,n.id desc limit p_limit) n
    left join private.posts p on p.id=n.post_id left join private.organisations o on o.id=n.organisation_id),'[]'::jsonb),
    'unread_count',(select count(*) from private.notifications n where n.account_id=actor and n.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') and n.read_at is null)) into result;
  perform internal.price_draft_actor(); return result;
end;
$function$;
alter function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) owner to postgres;
revoke all on function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) from public;
grant execute on function internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone) to authenticated;

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure)<>'7defb01cc11b56fcfc1417dd25127653'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure)<>'c6961ccad51ed7b788a43a1c5a4fb505'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.notify_frontend_business_check()'::regprocedure)<>'b2b0c8f2ee524951767db095c96f383d'
    or to_regprocedure('internal.notify_member_of_outbox_event()') is not null
    or to_regprocedure('internal.notify_post_moderation()') is not null then
    raise exception 'member notices in app rollback was not applied';
  end if;
end$$;
commit;
