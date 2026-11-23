-- A reminder email 3 days before a free credit ends (launch checklist item
-- 70b).
--
-- A free credit (20261122130744_free_credits.sql, source 'free_credit') gives a
-- member 1 to 6 posts for up to 30 days and can be extended 30 days at a time.
-- Its member is told once, 3 days before it ends, through the reminder path the
-- renewal reminder (20261114093742_renew_slots_early.sql) and the term-ending
-- notice (20261122111209_term_ending_notice.sql) already use: the minute job
-- queues an outbox email and the email job claims and words it.
--
-- From this update, in one transaction:
-- 1. New outbox kind free_credit_reminder (the kind check gains it).
-- 2. internal.free_credit_reminder_key(gift, owner) returns the reminder's
--    dedupe key, free_credit_reminder:<gift id>:<end, in whole seconds since
--    1970>, while a reminder is due: the gift is active (not ended early), its
--    end is at most 3 days away and the account can sign in now
--    (private.current_account_access: not banned, suspended or closed, the
--    same check as term_has_access); otherwise null.
--    internal.queue_free_credit_reminders(p_limit) queues one email per key.
--    The key names the end, so a gift extended after its reminder gets a new
--    reminder 3 days before its new end, and the email for one end is queued
--    at most once whatever the retries (the retention job removes a sent email
--    30 days after sending, long after that end has passed).
-- 3. api.run_slot_renewals (full body; the minute job the website already
--    runs) also runs that step and adds its count to its result as
--    free_credit_reminders. internal.run_slot_renewals is unchanged.
-- 4. internal.claim_supported_notification_outbox (full body) accepts the new
--    kind (23 kinds, each once) and hands it out to a confirmed, non-anonymous
--    address only while its key is still the gift's current one (otherwise it
--    is finished as skipped without a send: the gift ended early, was
--    extended, or the member was banned, suspended or closed since), with the
--    gift's end (credit_ends_at). The reminder is a service notice about the
--    member's own posts; the optional marketing choices do not apply. No
--    in-app notice is added. Nothing is charged or renewed.
--
-- The website release from the same pull request claims and words the new
-- kind. Safe in either order: an earlier website never claims it (the queued
-- emails wait); a website release before this update finds the kind refused
-- and drops it until the update is applied (src/lib/foundation/
-- operation-jobs.ts, laterKinds). ORDER: apply first, then merge.
-- It refuses with 55000 unless each function it replaces has its reviewed
-- body (or this update's), the new functions are absent (or this update's)
-- and the kind check is the reviewed one (or this update's).
-- Read-only preflight: ../preflight/20261122182304_free_credit_reminder.check.sql.
-- Rollback: ../rollback/20261122182304_free_credit_reminder.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text; kind_check text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_supported_notification_outbox(text[],integer)'),
      ('api.run_slot_renewals(integer)'),('internal.free_credit_reminder_key(uuid,uuid)'),
      ('internal.queue_free_credit_reminders(integer)')) v(sig)
  loop
    if shape not in (
        'internal.claim_supported_notification_outbox(text[],integer) 9a4c68c8ba330364831aac3bdf66b2aa',
        'internal.claim_supported_notification_outbox(text[],integer) f659e9ebf7dcf269e4759879537a10f0',
        'api.run_slot_renewals(integer) 64c3c57229ca6fe6b8163fd8d57dbfcc',
        'api.run_slot_renewals(integer) 2dc453b1de85fbdb169b983c42109c5f',
        'internal.free_credit_reminder_key(uuid,uuid) absent',
        'internal.free_credit_reminder_key(uuid,uuid) 7031f3b16ccc65060e6b1082d07341d3',
        'internal.queue_free_credit_reminders(integer) absent',
        'internal.queue_free_credit_reminders(integer) 11040161aaa93a255c2a153c476d1d55') then
      raise exception 'free credit reminder precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
  select md5(pg_get_constraintdef(c.oid)) into kind_check from pg_constraint c
    where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check';
  if kind_check is null or kind_check not in ('3680e8be14065608e4f18ffd2a041fd3','8f88842810c8e4240cb89176f9398bb6') then
    raise exception 'free credit reminder precondition: the outbox kind check is not the reviewed one (md5 %)',
      coalesce(kind_check,'missing') using errcode='55000';
  end if;
end$$;

-- 1. The reminder's outbox kind.
alter table private.outbox_events drop constraint if exists outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder']));

-- 2. The reminder's key while it is due: an active gift (never ended early) of
-- an account that can sign in now (not banned, suspended or closed), ending
-- within 3 days. The key names the gift and its end, so an extension gives the
-- new end a reminder of its own.
CREATE OR REPLACE FUNCTION internal.free_credit_reminder_key(p_entitlement uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'free_credit_reminder:'||g.id||':'||floor(extract(epoch from g.ends_at))::bigint
  from private.entitlements g
  where g.id=p_entitlement and g.owner_id=p_owner and g.source='free_credit' and g.status='active'
    and g.ends_at>clock_timestamp() and g.ends_at<=clock_timestamp()+interval '3 days'
    and exists(select 1 from private.current_account_access a where a.id=g.owner_id);
$function$;
alter function internal.free_credit_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.free_credit_reminder_key(uuid,uuid) from public,anon,authenticated,service_role;

-- Queues one reminder per gift end within 3 days. Called by
-- api.run_slot_renewals, after the same p_limit is checked there (1 to 5000);
-- read by date (entitlements_active_ends_idx).
CREATE OR REPLACE FUNCTION internal.queue_free_credit_reminders(p_limit integer)
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
    select 'free_credit_reminder', d.id, d.owner_id, d.dedupe_key from (
      select g.id, g.owner_id, g.ends_at, internal.free_credit_reminder_key(g.id, g.owner_id) as dedupe_key
      from private.entitlements g
      where g.status='active' and g.source='free_credit'
        and g.ends_at>statement_timestamp() and g.ends_at<=statement_timestamp()+interval '3 days'
    ) d
    where d.dedupe_key is not null
      and not exists(select 1 from private.outbox_events o where o.dedupe_key=d.dedupe_key)
    order by d.ends_at, d.id limit p_limit
    on conflict (dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$function$;
alter function internal.queue_free_credit_reminders(integer) owner to postgres;
revoke all on function internal.queue_free_credit_reminders(integer) from public,anon,authenticated,service_role;
grant execute on function internal.queue_free_credit_reminders(integer) to service_role;

-- 3. The minute job also queues the reminders.
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

-- 4. The email job claims the reminder.
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

notify pgrst,'reload schema';
commit;
