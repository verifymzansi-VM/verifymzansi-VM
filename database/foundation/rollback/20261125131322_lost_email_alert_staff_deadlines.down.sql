-- Reviewed rollback for updates/20261125131322_lost_email_alert_staff_deadlines.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier body of internal.claim_supported_notification_outbox
-- byte for byte (same signature, grants and owner; that of
-- 20261122182304_free_credit_reminder.sql), drops the three staff deadline
-- triggers, the eight new functions, private.lost_email_alerts (with the
-- alerts already sent), the two lost_alert_id columns and the three new
-- indexes, deletes the staff deadline emails (notifications only: the
-- requests, appeals and reports stay in their staff queues; never-claimed
-- ones first), and puts back the earlier outbox kind check. A website from the
-- update's pull request then needs the two alert commands: roll the website
-- back first. It refuses (55000) unless the functions have this update's
-- bodies (a later update changed one: undo that update first), and while a
-- lost-email alert is not sent yet (let the email job send it first).
begin;
set local lock_timeout='5s';

do $$
declare shape text; recorded integer;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_supported_notification_outbox(text[],integer)'),
      ('internal.staff_email_capability(text)'),('internal.staff_due_after(timestamp with time zone,integer)'),
      ('internal.staff_email_due(text,uuid,uuid)'),('internal.queue_staff_deadline_emails()'),
      ('internal.claim_lost_email_alert(integer)'),('api.claim_lost_email_alert(integer)'),
      ('internal.complete_lost_email_alert(uuid,boolean)'),('api.complete_lost_email_alert(uuid,boolean)')) v(sig)
  loop
    if shape not in (
        'internal.claim_supported_notification_outbox(text[],integer) 368f515805291682c74f28b163c50687',
        'internal.staff_email_capability(text) dcb7b5e6846f24efe17eb7800184dd59',
        'internal.staff_due_after(timestamp with time zone,integer) b755ae0538f37eaf91c6d6818584db91',
        'internal.staff_email_due(text,uuid,uuid) 33aed641726695e14ea1f64c4b0ba2eb',
        'internal.queue_staff_deadline_emails() 69ea078b94ffc5d1116dcfbd63e50744',
        'internal.claim_lost_email_alert(integer) 25fee44314e2556ef9bea1f44e05c9bc',
        'api.claim_lost_email_alert(integer) 70303c452ab6cda4848c333b1247efd3',
        'internal.complete_lost_email_alert(uuid,boolean) 5575975a22aab2cf647d7bccafe2c8a2',
        'api.complete_lost_email_alert(uuid,boolean) 636b85615798a2f3f923f9dc25d4934a') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  select count(*) into recorded from private.lost_email_alerts where sent_at is null;
  if recorded > 0 then
    raise exception 'lost email alert rollback: % lost-email alerts are not sent yet; let the email job send them first', recorded
      using errcode='55000';
  end if;
end$$;

-- The staff deadline emails: never-claimed ones first, then the rest.
delete from private.outbox_events
  where kind in('staff_privacy_request','staff_appeal','staff_report') and delivery_attempts=0;
delete from private.outbox_events
  where kind in('staff_privacy_request','staff_appeal','staff_report');

drop trigger queue_staff_deadline_email on private.privacy_requests;
drop trigger queue_staff_deadline_email on private.frontend_appeals;
drop trigger queue_staff_deadline_email on private.reports;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 23 kinds since the free credit reminder.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 23 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice','free_credit_reminder')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','verification_returned') or not exists(select 1 from private.account_closures c where c.user_id=u.id))
      and (o.kind<>'slot_renewal_reminder' or internal.slot_renewal_due(o.subject_id,o.owner_id))
      and (o.kind<>'term_ending_notice' or internal.term_ending_notice_due(o.subject_id,o.owner_id))
      and (o.kind<>'free_credit_reminder' or o.dedupe_key=internal.free_credit_reminder_key(o.subject_id,o.owner_id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end,
    'trial_ends_at',tr.ends_at,
    'trial_funds_post',case when tr.id is not null then exists(select 1 from private.post_activations a
      join private.posts fp on fp.id=a.post_id where a.entitlement_id=tr.id and a.released_at is null and fp.status='live') end,
    -- The renewal reminder: when the slot ends, and whether more than one of
    -- the member's slots ends unrenewed within 7 days ("Renew all").
    'slot_ends_at',sg.ends_at,
    'renewal_kind',case when sg.id is not null then 'individual' end,
    'slot_renew_all',case when sg.id is not null then (select count(*)>1 from private.entitlements x
      where x.owner_id=o.owner_id and x.status='active' and x.ends_at<=statement_timestamp()+interval '7 days'
        and internal.slot_renewal_due(x.id,o.owner_id)) end,
    -- The term-ending notice: when the term ends, what it is, whether the
    -- member can sign in now (not while banned or suspended) and, for an
    -- Individual slot, whether the Multi-listing package its post moves into
    -- when it ends (internal.slot_package_now) runs past that end.
    'term_ends_at',tg.ends_at,
    'term_has_access',case when tg.id is not null then exists(select 1 from private.current_account_access a where a.id=o.owner_id) end,
    'term_kind',case when tg.id is null then null when tg.package_id is not null then 'package'
      when exists(select 1 from private.payment_lines l join private.plan_versions v on v.id=l.plan_version_id
        where l.id=tg.payment_line_id and internal.individual_slot_plan(v.plan_code)) then 'individual'
      else 'other' end,
    'term_package_continues',case when tg.id is not null and tg.package_id is null
      and exists(select 1 from private.payment_lines l join private.plan_versions v on v.id=l.plan_version_id
        where l.id=tg.payment_line_id and internal.individual_slot_plan(v.plan_code))
      then exists(select 1 from internal.slot_package_now(o.owner_id) n where n.ends_at>tg.ends_at) end,
    -- The free credit reminder: when the gift ends.
    'credit_ends_at',fc.ends_at) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id
    left join private.entitlements tg on o.kind='term_ending_notice' and tg.id=o.subject_id and tg.owner_id=o.owner_id
    left join private.entitlements fc on o.kind='free_credit_reminder' and fc.id=o.subject_id and fc.owner_id=o.owner_id
      and fc.source='free_credit';
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

drop function internal.queue_staff_deadline_emails();
drop function internal.staff_email_due(text,uuid,uuid);
drop function internal.staff_due_after(timestamp with time zone,integer);
drop function internal.staff_email_capability(text);
drop function api.complete_lost_email_alert(uuid,boolean);
drop function internal.complete_lost_email_alert(uuid,boolean);
drop function api.claim_lost_email_alert(integer);
drop function internal.claim_lost_email_alert(integer);
-- Every alert left is sent (checked above).
drop table private.lost_email_alerts;
drop index private.outbox_staff_recent_idx;
drop index private.outbox_lost_unreported_idx;
drop index private.privacy_notices_lost_unreported_idx;
alter table private.outbox_events drop column lost_alert_id;
alter table private.privacy_notice_jobs drop column lost_alert_id;

alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder']));

notify pgrst,'reload schema';
commit;
