-- Three small lifecycle rules (launch checklist item 40).
--
-- 1. Free events at most 12 months ahead. The website already refuses an
--    event that starts more than 365 days ahead; the database checked only the
--    90-day length, so a direct call could store a start years ahead. A new
--    trigger on private.event_details refuses a start more than 365 days after
--    now when a row is inserted or its start changes (22023, detail
--    event_too_far_ahead). Copies, edit copies and templates keep working: a
--    stored start was within 365 days when it was set and only gets closer.
-- 2. A sticker renewal reminder. A CIPC registered or Seen by VerifyMzansi
--    sticker lasts 365 days and ended without warning. Its owner now gets one
--    email 30 days before it ends, through the reminder path the free credit
--    reminder (20261122182304_free_credit_reminder.sql) uses: the minute job
--    queues an outbox email and the email job claims and words it.
--    - New outbox kind sticker_renewal_reminder (the kind check gains it).
--    - internal.sticker_renewal_reminder_key(check, owner) returns the
--      reminder's dedupe key, sticker_renewal_reminder:<check id>:<end, in
--      whole seconds since 1970>, while a reminder is due: the check is an
--      approved CIPC or Seen check ending within 30 days, it is still its
--      business's latest decision of that kind (no later approval or
--      withdrawal) and no check of that kind is waiting for review (a
--      renewal already asked for), the business is the owner's own, not an
--      edit copy, and not archived or sold, and the owner can sign in now
--      (private.current_account_access); otherwise null. A sticker linked
--      from another profile (cipc_link) renews with that profile and gets
--      none. The key names the end, so a renewed sticker gets its own
--      reminder 30 days before its new end.
--    - internal.queue_sticker_renewal_reminders(p_limit) queues one email per
--      key.
--    - api.run_slot_renewals (full body; the minute job the website already
--      runs) also runs that step and adds its count to its result as
--      sticker_renewal_reminders. internal.run_slot_renewals is unchanged.
--    - internal.claim_supported_notification_outbox (full body) accepts the
--      new kind (27 kinds, each once) and hands it out to a confirmed,
--      non-anonymous address only while its key is still the check's current
--      one (otherwise it is finished as skipped without a send), with the
--      sticker's kind, its end and its business. Nothing is renewed or
--      charged. No in-app notice is added.
-- 3. A reported post cannot be deleted before staff look. internal.delete_post
--    (full body; the only owner deletion, behind api.delete_post and
--    execute_my_frontend_post_action) refuses while any report on the post is
--    open (PT409, detail post_report_open), the same rule the scheduled
--    clean-up already follows (internal.post_report_deferred). The owner can
--    still hide the post meanwhile.
--
-- No API command is added or removed. The website release from the same pull
-- request claims and words the new kind, and words the new refusal. Safe in
-- either order: an earlier website never claims the new kind (the emails
-- wait) and shows its general "reload" message for the refusal; a website
-- release before this update finds the kind refused and drops it until the
-- update is applied (src/lib/foundation/operation-jobs.ts, laterKinds).
-- ORDER: apply first, then merge.
-- It refuses with 55000 unless each function it replaces has its reviewed
-- body (or this update's), the new functions are absent (or this update's),
-- the outbox kind check is the reviewed one (or this update's) and no stored
-- event starts more than 365 days ahead.
-- Read-only preflight: ../preflight/20261125150215_small_lifecycle_rules.check.sql.
-- Rollback: ../rollback/20261125150215_small_lifecycle_rules.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text; kind_check text; far integer;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_supported_notification_outbox(text[],integer)'),
      ('api.run_slot_renewals(integer)'),('internal.delete_post(uuid,integer)'),
      ('internal.sticker_renewal_reminder_key(uuid,uuid)'),('internal.queue_sticker_renewal_reminders(integer)'),
      ('internal.event_start_within_a_year()')) v(sig)
  loop
    if shape not in (
        'internal.claim_supported_notification_outbox(text[],integer) 368f515805291682c74f28b163c50687',
        'internal.claim_supported_notification_outbox(text[],integer) 407d5c969a5cf466602555fedb7b23df',
        'api.run_slot_renewals(integer) 2dc453b1de85fbdb169b983c42109c5f',
        'api.run_slot_renewals(integer) 72556cba7602b4191dd1e2ee5811915f',
        'internal.delete_post(uuid,integer) 2aa04c741c9dee2e414be6ae1f03f73d',
        'internal.delete_post(uuid,integer) ba5e05f4803ab918135a4aa6dbf05ba1',
        'internal.sticker_renewal_reminder_key(uuid,uuid) absent',
        'internal.sticker_renewal_reminder_key(uuid,uuid) f0296fa207968b44d2249cbe31f02f1c',
        'internal.queue_sticker_renewal_reminders(integer) absent',
        'internal.queue_sticker_renewal_reminders(integer) 79ac584983c94b27efed334fe332ef1b',
        'internal.event_start_within_a_year() absent',
        'internal.event_start_within_a_year() 5e66f9025f39b986c066ee4de6ae464e') then
      raise exception 'small lifecycle rules precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
  select md5(pg_get_constraintdef(c.oid)) into kind_check from pg_constraint c
    where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check';
  if kind_check is null or kind_check not in ('3dd36603eb690443cc2af09e976e6d56','89576322fd690701d0f4a17756fb366d') then
    raise exception 'small lifecycle rules precondition: the outbox kind check is not the reviewed one (md5 %)',
      coalesce(kind_check,'missing') using errcode='55000';
  end if;
  select count(*) into far from private.event_details e where e.starts_at>clock_timestamp()+interval '365 days';
  if far>0 then
    raise exception 'small lifecycle rules precondition: % events start more than 365 days ahead', far
      using errcode='55000';
  end if;
end$$;

-- 1. Free events at most 12 months ahead.
CREATE OR REPLACE FUNCTION internal.event_start_within_a_year()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only a new start is checked: a stored one was within 365 days when set.
  if tg_op='UPDATE' and new.starts_at is not distinct from old.starts_at then return new; end if;
  if new.starts_at>clock_timestamp()+interval '365 days' then
    raise exception 'events can start at most 12 months ahead' using errcode='22023',detail='event_too_far_ahead';
  end if;
  return new;
end;
$function$;
alter function internal.event_start_within_a_year() owner to postgres;
revoke all on function internal.event_start_within_a_year() from public,anon,authenticated,service_role;
drop trigger if exists event_start_within_a_year on private.event_details;
create trigger event_start_within_a_year before insert or update of starts_at on private.event_details
  for each row execute function internal.event_start_within_a_year();

-- 2. The sticker renewal reminder's outbox kind.
alter table private.outbox_events drop constraint if exists outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder','staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder']));

-- The reminder's key while it is due (see the header).
CREATE OR REPLACE FUNCTION internal.sticker_renewal_reminder_key(p_check uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'sticker_renewal_reminder:'||c.id||':'||floor(extract(epoch from c.expires_at))::bigint
  from private.frontend_business_checks c
  join private.posts b on b.id=c.business_id and b.owner_id=c.owner_id and b.kind='business'
    and b.edit_of is null and b.status not in('archived','sold')
  where c.id=p_check and c.owner_id=p_owner and c.kind in('cipc','seen') and c.status='approved'
    and c.expires_at>clock_timestamp() and c.expires_at<=clock_timestamp()+interval '30 days'
    and not exists(select 1 from private.frontend_business_checks x where x.business_id=c.business_id and x.id<>c.id
      and (x.kind=c.kind or (c.kind='cipc' and x.kind='cipc_link'))
      and (x.status in('pending','info_requested')
        or ((x.status='approved' or x.revoked_at is not null) and (x.decided_at,x.id)>(c.decided_at,c.id))))
    and exists(select 1 from private.current_account_access a where a.id=c.owner_id);
$function$;
alter function internal.sticker_renewal_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.sticker_renewal_reminder_key(uuid,uuid) from public,anon,authenticated,service_role;

-- Queues one reminder per sticker end within 30 days. Called by
-- api.run_slot_renewals, after the same p_limit is checked there (1 to 5000).
CREATE OR REPLACE FUNCTION internal.queue_sticker_renewal_reminders(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare queued integer;
begin
  if p_limit is null or p_limit < 1 then
    return 0;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
    select 'sticker_renewal_reminder', d.id, d.owner_id, d.dedupe_key from (
      select c.id, c.owner_id, c.expires_at, internal.sticker_renewal_reminder_key(c.id, c.owner_id) as dedupe_key
      from private.frontend_business_checks c
      where c.status='approved' and c.kind in('cipc','seen')
        and c.expires_at>statement_timestamp() and c.expires_at<=statement_timestamp()+interval '30 days'
    ) d
    where d.dedupe_key is not null
      and not exists(select 1 from private.outbox_events o where o.dedupe_key=d.dedupe_key)
    order by d.expires_at, d.id limit p_limit
    on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$function$;
alter function internal.queue_sticker_renewal_reminders(integer) owner to postgres;
revoke all on function internal.queue_sticker_renewal_reminders(integer) from public,anon,authenticated,service_role;
grant execute on function internal.queue_sticker_renewal_reminders(integer) to service_role;

-- The minute job also queues the reminders.
CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('slot_renewals', internal.run_slot_renewals(p_limit)
    || jsonb_build_object('term_ending_notices', internal.queue_term_ending_notices(p_limit),
      'free_credit_reminders', internal.queue_free_credit_reminders(p_limit),
      'sticker_renewal_reminders', internal.queue_sticker_renewal_reminders(p_limit)));
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

-- The email job claims the reminder.
CREATE OR REPLACE FUNCTION internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  -- Each kind once; 27 kinds since the sticker renewal reminder.
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 27 or coalesce(array_ndims(p_supported_kinds),0)<>1
    or (select count(distinct coalesce(k,'')) from unnest(p_supported_kinds) k)<>cardinality(p_supported_kinds) then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice','free_credit_reminder','staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
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
      and (o.kind not in('staff_privacy_request','staff_appeal','staff_report') or internal.staff_email_due(o.kind,o.subject_id,o.owner_id))
      and (o.kind<>'sticker_renewal_reminder' or o.dedupe_key=internal.sticker_renewal_reminder_key(o.subject_id,o.owner_id)) then u.email end,
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
      when 'staff_report' then internal.staff_due_after(sr.created_at,2) end,
    -- The sticker renewal reminder: which sticker, when it ends and its
    -- business (the email links to that business's verification page).
    'sticker_kind',sc.kind,
    'sticker_expires_at',sc.expires_at,
    'sticker_business_id',sc.business_id) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on o.kind not in('staff_privacy_request','staff_appeal','staff_report','sticker_renewal_reminder')
      and p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end
    left join private.entitlements tr on o.kind='trial_started' and tr.id=o.subject_id and tr.source='intro_trial'
      and tr.owner_id=o.owner_id and tr.status='active'
    left join private.entitlements sg on o.kind='slot_renewal_reminder' and sg.id=o.subject_id and sg.owner_id=o.owner_id
    left join private.entitlements tg on o.kind='term_ending_notice' and tg.id=o.subject_id and tg.owner_id=o.owner_id
    left join private.entitlements fc on o.kind='free_credit_reminder' and fc.id=o.subject_id and fc.owner_id=o.owner_id
      and fc.source='free_credit'
    left join private.privacy_requests sp on o.kind='staff_privacy_request' and sp.id=o.subject_id
    left join private.frontend_appeals sa on o.kind='staff_appeal' and sa.id=o.subject_id
    left join private.reports sr on o.kind='staff_report' and sr.id=o.subject_id
    left join private.frontend_business_checks sc on o.kind='sticker_renewal_reminder' and sc.id=o.subject_id
      and sc.owner_id=o.owner_id and sc.kind in('cipc','seen');
  return result;
end;
$function$;
alter function internal.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

-- 3. A reported post waits for staff before its owner can delete it.
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
  -- A post with an open report waits until staff have looked at it, the same
  -- rule the scheduled clean-up follows (internal.post_report_deferred). The
  -- owner can still hide it.
  if exists (select 1 from private.reports r where r.post_id = post.id and r.status = 'open') then
    raise exception 'a reported post cannot be deleted until staff have looked at the report'
      using errcode = 'PT409', detail = 'post_report_open';
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

notify pgrst,'reload schema';
commit;
