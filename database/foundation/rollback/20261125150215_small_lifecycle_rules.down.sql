-- Reviewed rollback for updates/20261125150215_small_lifecycle_rules.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier bodies of internal.claim_supported_notification_outbox,
-- api.run_slot_renewals and internal.delete_post byte for byte (same
-- signatures, grants and owners; those of
-- 20261125131322_lost_email_alert_staff_deadlines.sql,
-- 20261122182304_free_credit_reminder.sql and
-- 20261104101932_restored_owner_post_actions.sql), drops the event start
-- trigger and its function, internal.queue_sticker_renewal_reminders and
-- internal.sticker_renewal_reminder_key, deletes the sticker renewal reminders
-- (emails only: the stickers are unchanged) and puts back the earlier outbox
-- kind check. A website from the update's pull request keeps working: the
-- earlier claim refuses the new kind and the email job drops it (laterKinds).
-- It refuses (55000) unless the six functions have this update's bodies (a
-- later update changed one: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_supported_notification_outbox(text[],integer)'),
      ('api.run_slot_renewals(integer)'),('internal.delete_post(uuid,integer)'),
      ('internal.sticker_renewal_reminder_key(uuid,uuid)'),('internal.queue_sticker_renewal_reminders(integer)'),
      ('internal.event_start_within_a_year()')) v(sig)
  loop
    if shape not in (
        'internal.claim_supported_notification_outbox(text[],integer) 407d5c969a5cf466602555fedb7b23df',
        'api.run_slot_renewals(integer) 72556cba7602b4191dd1e2ee5811915f',
        'internal.delete_post(uuid,integer) ba5e05f4803ab918135a4aa6dbf05ba1',
        'internal.sticker_renewal_reminder_key(uuid,uuid) f0296fa207968b44d2249cbe31f02f1c',
        'internal.queue_sticker_renewal_reminders(integer) 79ac584983c94b27efed334fe332ef1b',
        'internal.event_start_within_a_year() 5e66f9025f39b986c066ee4de6ae464e') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 3. Owner deletion without the open-report rule.
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
$function$;
alter function internal.delete_post(uuid,integer) owner to postgres;
revoke all on function internal.delete_post(uuid,integer) from public,anon,service_role;
grant execute on function internal.delete_post(uuid,integer) to authenticated;

-- 2. The minute job and the claim without the sticker renewal reminder.
CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('slot_renewals', internal.run_slot_renewals(p_limit)
    || jsonb_build_object('term_ending_notices', internal.queue_term_ending_notices(p_limit),
      'free_credit_reminders', internal.queue_free_credit_reminders(p_limit)));
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 26 kinds since the staff deadline emails.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 26 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice','free_credit_reminder','staff_privacy_request','staff_appeal','staff_report')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
      and (o.kind<>'free_credit_reminder' or o.dedupe_key=internal.free_credit_reminder_key(o.subject_id,o.owner_id))
      and (o.kind not in('staff_privacy_request','staff_appeal','staff_report') or internal.staff_email_due(o.kind,o.subject_id,o.owner_id)) then u.email end,
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
    'credit_ends_at',fc.ends_at,
    -- The staff deadline emails: the request type, appeal kind or report
    -- reason, the report's severity, when it was received and its deadline
    -- (an appeal 3 and a report 2 business days after it was received).
    'staff_item_type',case o.kind when 'staff_privacy_request' then sp.type when 'staff_appeal' then sa.kind
      when 'staff_report' then coalesce(sr.frontend_reason,sr.category) end,
    'staff_severity',sr.severity,
    'staff_received_at',coalesce(sp.received_at,sa.created_at,sr.created_at),
    'staff_due_at',case o.kind when 'staff_privacy_request' then sp.effective_due_at
      when 'staff_appeal' then internal.staff_due_after(sa.created_at,3)
      when 'staff_report' then internal.staff_due_after(sr.created_at,2) end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on o.kind not in('staff_privacy_request','staff_appeal','staff_report')
      and p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id
    left join private.entitlements tg on o.kind='term_ending_notice' and tg.id=o.subject_id and tg.owner_id=o.owner_id
    left join private.entitlements fc on o.kind='free_credit_reminder' and fc.id=o.subject_id and fc.owner_id=o.owner_id
      and fc.source='free_credit'
    left join private.privacy_requests sp on o.kind='staff_privacy_request' and sp.id=o.subject_id
    left join private.frontend_appeals sa on o.kind='staff_appeal' and sa.id=o.subject_id
    left join private.reports sr on o.kind='staff_report' and sr.id=o.subject_id;
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

drop function internal.queue_sticker_renewal_reminders(integer);
drop function internal.sticker_renewal_reminder_key(uuid,uuid);
delete from private.outbox_events where kind='sticker_renewal_reminder';
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder','staff_privacy_request','staff_appeal','staff_report']));

-- 1. No start limit on events.
drop trigger event_start_within_a_year on private.event_details;
drop function internal.event_start_within_a_year();

notify pgrst,'reload schema';
commit;
