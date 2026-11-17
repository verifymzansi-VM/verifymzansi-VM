-- Members whose ID was sent back are told, and can read why (BL-12).
--
-- Until now, when staff sent an identity case back (internal.
-- return_identity_submission, called by the identity review through
-- internal.return_frontend_identity_step), the reviewer's reason was stored in
-- private.verification_return_requests and nothing told the member: no notice
-- in the account and no email. The website now shows the stored reason on the
-- verification page; this update adds the notice and the email.
--
-- From this update:
-- 1. Sending an identity (kyc) case back adds a notification of the new kind
--    'verification_returned' for the member (through internal.notify_account,
--    which also signals the member's live inbox) and queues an email of the same
--    kind in the outbox. Both refer to the return request by id only: neither
--    stores the reason or any identity detail, and the email asks the member to
--    sign in to see why. Business and restriction cases are unchanged.
-- 2. The closed lists of notification and outbox kinds gain
--    'verification_returned'.
-- 3. internal.claim_supported_notification_outbox accepts the new kind (lists
--    of up to 20 kinds) and, like the other account notices, gives no recipient
--    for a closed account.
-- 4. The enquiry-inbox reads (internal.list_my_notifications and
--    internal.list_my_frontend_notifications) leave the new kind out, as they do
--    the other account notices; internal.list_my_frontend_notices, which the
--    website's notifications page reads, lists it.
-- No API signature, grant or owner changes, and no new command. Returns made
-- before the update are not notified afterwards.
--
-- Needs 20261110045944_intro_trial_at_first_approval.sql (it changed the mail
-- claim this update replaces).
--
-- ORDER: apply this update only once the website release that knows the
-- 'verification_returned' kind (the pull request that adds this file) is live.
-- That release works without the update; the website before it cannot read the
-- new notice and would show a member who has one an error instead of their
-- notifications. If that release is ever reverted, run the rollback first. The precondition accepts the reviewed bodies or
-- this update's own, so a repeated run changes nothing.
-- Read-only preflight:
-- ../preflight/20261110173012_verification_returned_notice.check.sql.
-- Rollback: ../rollback/20261110173012_verification_returned_notice.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: every body replaced below is the reviewed one (or already
-- this update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)
      not in('f0a000c6709e523e5aa2ef59af2f1948','13d3edc000634dfd830ffd1baa846381') then
    raise exception 'apply 20261110045944_intro_trial_at_first_approval.sql first, or mail claim drift: internal.claim_supported_notification_outbox is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.return_identity_submission(uuid,integer,text,uuid,text)'::regprocedure)
      not in('8f14802233e3eabd10580aee3ff923a7','bc4304d1f5191cae942d30780ce0c29c') then
    raise exception 'identity return drift: internal.return_identity_submission is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure)
      not in('73580f30d3e3e417244d51c67e77e349','7defb01cc11b56fcfc1417dd25127653') then
    raise exception 'notification list drift: internal.list_my_notifications is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure)
      not in('c362f120c59bf8a4fe0b5c56b33abf95','c6961ccad51ed7b788a43a1c5a4fb505') then
    raise exception 'notification list drift: internal.list_my_frontend_notifications is not the reviewed body' using errcode='55000';
  end if;
  -- The kind lists are the reviewed ones, so no later kind is dropped.
  if not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed']::text[] or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.notifications'::regclass and c.conname='notifications_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','enquiry_received','organisation_affiliation_ended','organisation_application_decided','organisation_application_received','organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed','verification_returned']::text[]) then
    raise exception 'kind drift: private.notifications kinds are not the reviewed list' using errcode='55000';
  end if;
  if not ((select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','payment_completed','payment_reconciliation_required','payment_reversed','post_deleted','post_expired','post_expiry_reminder','post_kept','post_sold','trial_started','verification_phone_confirmed']::text[] or (select array_agg(m[1] order by m[1])::text[] from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid),'''([a-z_]+)''','g') m where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check') is not distinct from array['account_banned','account_suspended','account_warning','appeal_decided','business_check_update','content_hidden','draft_deletion_warning','enquiry_received','identity_accepted','payment_completed','payment_reconciliation_required','payment_reversed','post_deleted','post_expired','post_expiry_reminder','post_kept','post_sold','trial_started','verification_phone_confirmed','verification_returned']::text[]) then
    raise exception 'kind drift: private.outbox_events kinds are not the reviewed list' using errcode='55000';
  end if;
end$$;

-- Both tables are locked first, in one order and without waiting: if either is
-- busy (a page reading notifications, the email job) the update stops at once,
-- holding nothing, and can simply be run again; it may take a few attempts.
-- Until it commits (well under a second) notifications and queued emails can be
-- neither read nor written.
lock table private.notifications,private.outbox_events in access exclusive mode nowait;

alter table private.notifications drop constraint notifications_kind_check,
  add constraint notifications_kind_check check(kind=any(array['enquiry_received'::text,
    'organisation_application_received'::text,'organisation_application_decided'::text,
    'organisation_affiliation_ended'::text,'organisation_sponsorship_activated'::text,
    'organisation_sponsorship_ended'::text,'partner_commission_approved'::text,
    'partner_commission_reversed'::text,'account_warning'::text,'content_hidden'::text,
    'account_suspended'::text,'account_banned'::text,'appeal_decided'::text,
    'business_check_update'::text,'verification_returned'::text]));
alter table private.outbox_events drop constraint outbox_events_kind_check,
  add constraint outbox_events_kind_check check(kind=any(array['payment_completed'::text,'payment_reversed'::text,
    'payment_reconciliation_required'::text,'trial_started'::text,'post_expired'::text,'post_expiry_reminder'::text,
    'draft_deletion_warning'::text,'post_deleted'::text,'verification_phone_confirmed'::text,'identity_accepted'::text,
    'enquiry_received'::text,'account_warning'::text,'content_hidden'::text,'account_suspended'::text,
    'account_banned'::text,'appeal_decided'::text,'business_check_update'::text,'post_sold'::text,'post_kept'::text,
    'verification_returned'::text]));

CREATE OR REPLACE FUNCTION internal.return_identity_submission(p_case uuid, p_expected_version integer, p_claim_generation text, p_claim_nonce uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('verification:decide_routine'); c private.evidence_cases; subject uuid; reason text; returned uuid;
begin
  reason:=internal.retention_reason(p_reason);
  select e.subject_id into subject from private.evidence_cases e where e.id=p_case;
  if not found then raise exception 'case unavailable' using errcode='22023'; end if;
  perform internal.lock_verification_subject(subject);
  select e.* into c from private.evidence_cases e where e.id=p_case for update;
  perform internal.assert_evidence_claim(c,actor,p_claim_generation,p_claim_nonce);
  if c.version<>p_expected_version or c.version>=2147483647 or c.subject_id=actor
    or exists(select 1 from private.decisions d where d.case_id=c.id and d.status='proposed') then raise exception 'reviewed case changed' using errcode='PT409'; end if;
  update private.evidence_cases set version=version+1,claimed_by=null,claim_expires_at=null,claim_nonce=null where id=c.id returning * into c;
  update private.evidence_artifacts set retain_until=statement_timestamp()+interval '90 days' where case_id=c.id and state in('clean','uploaded','rejected') and retain_until is null;
  insert into private.verification_return_requests(case_id,case_version,reason,reviewer_id) values(c.id,c.version,reason,actor) returning id into returned;
  -- The member is told: a notice in the account and an email. Neither carries
  -- the reason or any identity detail; the member reads the reason on the
  -- verification page after signing in.
  if c.kind='kyc' then
    perform internal.notify_account(c.subject_id,'verification_returned',returned,null,null);
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('verification_returned',returned,c.subject_id,'verification_returned:'||returned);
  end if;
  return jsonb_build_object('case_id',c.id,'version',c.version,'status','needs_resubmission');
end;
$function$;
alter function internal.return_identity_submission(uuid,integer,text,uuid,text) owner to postgres;
revoke all on function internal.return_identity_submission(uuid,integer,text,uuid,text) from public;
grant execute on function internal.return_identity_submission(uuid,integer,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 20 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') or not exists(select 1 from private.account_closures c where c.user_id=u.id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end,
    'trial_ends_at',tr.ends_at,
    'trial_funds_post',case when tr.id is not null then exists(select 1 from private.post_activations a
      join private.posts fp on fp.id=a.post_id where a.entitlement_id=tr.id and a.released_at is null and fp.status='live') end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active';
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

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
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)<>'13d3edc000634dfd830ffd1baa846381'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.return_identity_submission(uuid,integer,text,uuid,text)'::regprocedure)<>'bc4304d1f5191cae942d30780ce0c29c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_notifications(timestamp with time zone,uuid,integer)'::regprocedure)<>'7defb01cc11b56fcfc1417dd25127653'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamp with time zone)'::regprocedure)<>'c6961ccad51ed7b788a43a1c5a4fb505' then
    raise exception 'verification returned notice was not applied';
  end if;
end$$;
commit;
