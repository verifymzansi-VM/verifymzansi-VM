-- The lost-email alert and the staff deadline emails (launch checklist item
-- 28).
--
-- 1. The lost-email alert, kept in the database. A queued email is lost when
--    it is still unsent after its last attempt: an outbox email with 8
--    attempts (private.outbox_events) or a privacy request notice with 8
--    attempts (private.privacy_notice_jobs), once its lease has ended. Until
--    now the email job alerted staff only from memory, so a lost email went
--    unreported when the job was cut off or the alert could not be sent, and a
--    lost privacy notice was never reported.
--    - New table private.lost_email_alerts: one row per alert email, holding
--      the copy of what it lists (source, queue id, kind, attempts, queued
--      time and last error; never an address or the content). Its id is the
--      claim token and the email's key.
--    - New column lost_alert_id on both queues: the alert that reported the
--      row. Rows with it set are never reported again.
--    - api.claim_lost_email_alert(p_limit) (service role): an alert whose
--      send failed is offered again unchanged (same id, same list); otherwise,
--      unless an alert is being sent or one was sent in the last 15 minutes,
--      every lost row not yet reported goes into a new alert that lists the
--      oldest p_limit (1 to 50) and counts them all. Sent alerts are deleted
--      after 400 days.
--    - api.complete_lost_email_alert(p_claim, p_sent) (service role): marks the
--      alert sent, or gives it back for the next run.
-- 2. Staff deadline emails. New outbox kinds staff_privacy_request,
--    staff_appeal and staff_report. A new privacy request, appeal or public
--    report queues one email to each staff member whose role holds the
--    capability that handles it (dsar:manage, appeal:decide, report:resolve),
--    with a confirmed address, except the person who submitted it and the
--    person a report is about. At most 30 staff deadline emails are queued in
--    any 24 hours, all staff and kinds together (an advisory lock makes
--    overlapping submissions queue one at a time); later items are still in
--    the staff queues. Staff duplicate-event reports queue none.
--    internal.claim_supported_notification_outbox (full body) accepts the new
--    kinds (26 kinds, each once) and hands each to its staff member only while
--    the staff member can still sign in and still holds the capability and the
--    item is still open, and never for a report about or by that staff member
--    (otherwise it is finished as skipped), with what the
--    email shows: the type (request type, appeal kind or report reason), the
--    report's severity, when it was received and its deadline. Deadlines: a
--    privacy request's effective due date; an appeal 3 business days and a
--    report 2 business days after it was received (weekends are skipped, public
--    holidays are not, so the date shown is never later than the real one).
--    No name, address, description or reason text is handed out.
--
-- The website release from the same pull request claims the new kinds and the
-- alert. Safe in either order for the queue: an earlier website never claims
-- the new kinds (the emails wait). The deploy gate needs the two new commands,
-- so ORDER: apply first, then merge.
-- It refuses with 55000 unless the claim has its reviewed body (or this
-- update's), the outbox kind check is the reviewed one (or this update's) and
-- the new functions are all absent or all present.
-- Read-only preflight: ../preflight/20261125131322_lost_email_alert_staff_deadlines.check.sql.
-- Rollback: ../rollback/20261125131322_lost_email_alert_staff_deadlines.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare claim_body text; kind_check text; present integer;
begin
  select coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
      where p.oid=to_regprocedure('internal.claim_supported_notification_outbox(text[],integer)')),'absent')
    into claim_body;
  if claim_body not in ('f659e9ebf7dcf269e4759879537a10f0','368f515805291682c74f28b163c50687') then
    raise exception 'lost email alert precondition: internal.claim_supported_notification_outbox(text[],integer) % is not a reviewed body',
      claim_body using errcode='55000';
  end if;
  select md5(pg_get_constraintdef(c.oid)) into kind_check from pg_constraint c
    where c.conrelid='private.outbox_events'::regclass and c.conname='outbox_events_kind_check';
  if kind_check is null or kind_check not in ('8f88842810c8e4240cb89176f9398bb6','3dd36603eb690443cc2af09e976e6d56') then
    raise exception 'lost email alert precondition: the outbox kind check is not the reviewed one (md5 %)',
      coalesce(kind_check,'missing') using errcode='55000';
  end if;
  select (to_regprocedure('internal.staff_email_capability(text)') is not null)::integer
    + (to_regprocedure('internal.staff_due_after(timestamp with time zone,integer)') is not null)::integer
    + (to_regprocedure('internal.staff_email_due(text,uuid,uuid)') is not null)::integer
    + (to_regprocedure('internal.queue_staff_deadline_emails()') is not null)::integer
    + (to_regprocedure('internal.claim_lost_email_alert(integer)') is not null)::integer
    + (to_regprocedure('api.claim_lost_email_alert(integer)') is not null)::integer
    + (to_regprocedure('internal.complete_lost_email_alert(uuid,boolean)') is not null)::integer
    + (to_regprocedure('api.complete_lost_email_alert(uuid,boolean)') is not null)::integer
    into present;
  if present not in (0,8) then
    raise exception 'lost email alert precondition: % of 8 new functions exist', present using errcode='55000';
  end if;
end$$;

-- 1. The lost-email alerts.
create table if not exists private.lost_email_alerts (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  claimed_until timestamptz not null,
  items jsonb not null check (jsonb_typeof(items)='array'),
  total integer not null check (total>0),
  sent_at timestamptz
);
create index if not exists lost_email_alerts_unsent_idx on private.lost_email_alerts(created_at,id) where sent_at is null;
alter table private.lost_email_alerts owner to postgres;
alter table private.lost_email_alerts enable row level security;
revoke all on private.lost_email_alerts from public, anon, authenticated, service_role;

-- The alert that reported a lost row (no foreign key: deleting an old alert
-- must not make its rows reportable again).
alter table private.outbox_events add column if not exists lost_alert_id uuid;
alter table private.privacy_notice_jobs add column if not exists lost_alert_id uuid;
create index if not exists outbox_lost_unreported_idx on private.outbox_events(created_at,id)
  where processed_at is null and delivery_attempts>=8 and lost_alert_id is null;
create index if not exists privacy_notices_lost_unreported_idx on private.privacy_notice_jobs(created_at,id)
  where delivered_at is null and attempts>=8 and lost_alert_id is null;

CREATE OR REPLACE FUNCTION internal.claim_lost_email_alert(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  now_at timestamptz := clock_timestamp();
  batch private.lost_email_alerts;
  batch_id uuid;
  lost_total integer;
  listed jsonb;
  nothing constant jsonb := jsonb_build_object('claim',null,'total',0,'items','[]'::jsonb);
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid lost email alert limit' using errcode='22023'; end if;
  -- One email job at a time takes or makes an alert.
  perform pg_advisory_xact_lock(hashtextextended('private.lost_email_alerts',0));
  -- An alert whose send failed (its lease ended or was given back) is offered
  -- again first, unchanged: same id, same list.
  update private.lost_email_alerts a set claimed_until=now_at+interval '5 minutes'
    where a.id=(select x.id from private.lost_email_alerts x where x.sent_at is null and x.claimed_until<=now_at
      order by x.created_at,x.id limit 1)
    returning a.* into batch;
  if found then
    return jsonb_build_object('claim',batch.id,'total',batch.total,'items',batch.items);
  end if;
  -- An alert still being sent, or one sent in the last 15 minutes: wait, so
  -- many losses at once give one email.
  if exists(select 1 from private.lost_email_alerts x
      where x.sent_at is null or x.sent_at>now_at-interval '15 minutes') then
    return nothing;
  end if;
  -- Every lost row not yet reported: unsent after its last attempt, with its
  -- lease ended.
  batch_id := pg_catalog.gen_random_uuid();
  with outbox as (
    update private.outbox_events o set lost_alert_id=batch_id
      where o.processed_at is null and o.delivery_attempts>=8 and o.lost_alert_id is null
        and (o.delivery_until is null or o.delivery_until<now_at)
      returning o.id,o.created_at,jsonb_build_object('source','outbox','id',o.id,'kind',o.kind,
        'attempts',o.delivery_attempts,'queued_at',o.created_at,'last_error',o.delivery_error) as item),
  notices as (
    update private.privacy_notice_jobs j set lost_alert_id=batch_id
      where j.delivered_at is null and j.attempts>=8 and j.lost_alert_id is null
        and (j.locked_until is null or j.locked_until<now_at)
      returning j.id,j.created_at,jsonb_build_object('source','privacy_notice','id',j.id,
        'kind','privacy_notice_'||j.kind,'attempts',j.attempts,'queued_at',j.created_at,'last_error',null) as item),
  lost as (select * from outbox union all select * from notices)
  select (select count(*) from lost),
    coalesce((select jsonb_agg(l.item order by l.created_at,l.id)
      from (select * from lost order by created_at,id limit p_limit) l),'[]'::jsonb)
    into lost_total, listed;
  if lost_total=0 then return nothing; end if;
  delete from private.lost_email_alerts where sent_at<now_at-interval '400 days';
  insert into private.lost_email_alerts(id,created_at,claimed_until,items,total)
    values(batch_id,now_at,now_at+interval '5 minutes',listed,lost_total);
  return jsonb_build_object('claim',batch_id,'total',lost_total,'items',listed);
end;
$function$;
alter function internal.claim_lost_email_alert(integer) owner to postgres;
revoke all on function internal.claim_lost_email_alert(integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_lost_email_alert(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_lost_email_alert(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_lost_email_alert(p_limit);
$function$;
alter function api.claim_lost_email_alert(integer) owner to postgres;
revoke all on function api.claim_lost_email_alert(integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_lost_email_alert(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.complete_lost_email_alert(p_claim uuid, p_sent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_claim is null or p_sent is null then
    raise exception 'invalid lost email alert claim' using errcode='22023'; end if;
  -- Sent: never offered again. Given back: offered again, unchanged, on the
  -- next run.
  update private.lost_email_alerts
    set sent_at=case when p_sent then clock_timestamp() end,
      claimed_until=case when p_sent then claimed_until else clock_timestamp() end
    where id=p_claim and sent_at is null;
  return found;
end;
$function$;
alter function internal.complete_lost_email_alert(uuid,boolean) owner to postgres;
revoke all on function internal.complete_lost_email_alert(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.complete_lost_email_alert(uuid,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.complete_lost_email_alert(p_claim uuid, p_sent boolean)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_lost_email_alert(p_claim,p_sent);
$function$;
alter function api.complete_lost_email_alert(uuid,boolean) owner to postgres;
revoke all on function api.complete_lost_email_alert(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function api.complete_lost_email_alert(uuid,boolean) to service_role;

-- 2. The staff deadline emails' outbox kinds.
alter table private.outbox_events drop constraint if exists outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check (kind = any (array['payment_completed',
  'payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder',
  'draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update',
  'post_sold','post_kept','verification_returned','slot_renewal_reminder','term_ending_notice',
  'free_credit_reminder','staff_privacy_request','staff_appeal','staff_report']));

-- The staff deadline emails of the last 24 hours, for their shared cap.
create index if not exists outbox_staff_recent_idx on private.outbox_events(created_at)
  where kind in('staff_privacy_request','staff_appeal','staff_report');

-- The capability that handles what a staff deadline email is about.
CREATE OR REPLACE FUNCTION internal.staff_email_capability(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_kind when 'staff_privacy_request' then 'dsar:manage' when 'staff_appeal' then 'appeal:decide'
    when 'staff_report' then 'report:resolve' end;
$function$;
alter function internal.staff_email_capability(text) owner to postgres;
revoke all on function internal.staff_email_capability(text) from public,anon,authenticated,service_role;

-- p_days business days after p_from, South African time: each day counted is
-- a Monday to Friday; public holidays are counted too, so the result is never
-- later than a deadline that skips them.
CREATE OR REPLACE FUNCTION internal.staff_due_after(p_from timestamp with time zone, p_days integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare local_at timestamp; counted integer := 0;
begin
  if p_from is null or p_days is null then return null; end if;
  local_at := p_from at time zone 'Africa/Johannesburg';
  while counted<p_days loop
    local_at := local_at+interval '1 day';
    if extract(isodow from local_at)<6 then counted := counted+1; end if;
  end loop;
  return local_at at time zone 'Africa/Johannesburg';
end;
$function$;
alter function internal.staff_due_after(timestamp with time zone,integer) owner to postgres;
revoke all on function internal.staff_due_after(timestamp with time zone,integer) from public,anon,authenticated,service_role;

-- A staff deadline email is still due: its staff member can sign in, still
-- holds the capability, and the item is still open.
CREATE OR REPLACE FUNCTION internal.staff_email_due(p_kind text, p_item uuid, p_staff uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.staff_roles r join private.staff_capabilities c on c.role=r.role
      where r.user_id=p_staff and r.revoked_at is null and c.capability=internal.staff_email_capability(p_kind))
    and exists(select 1 from private.current_account_access a where a.id=p_staff)
    and case p_kind
      when 'staff_privacy_request' then exists(select 1 from private.privacy_requests x where x.id=p_item
        and x.status in('submitted','identity_pending','in_progress') and x.minimised_at is null)
      when 'staff_appeal' then exists(select 1 from private.frontend_appeals x where x.id=p_item and x.status='submitted')
      -- Never to the person the report is about or its reporter.
      when 'staff_report' then exists(select 1 from private.reports x where x.id=p_item and x.status='open'
        and x.subject_account_id<>p_staff and x.reporter_id is distinct from p_staff)
      else false end;
$function$;
alter function internal.staff_email_due(text,uuid,uuid) owner to postgres;
revoke all on function internal.staff_email_due(text,uuid,uuid) from public,anon,authenticated,service_role;

-- Queues the staff deadline emails of a new privacy request, appeal or report
-- (the trigger argument names the kind). Never fails the insert that caused it.
CREATE OR REPLACE FUNCTION internal.queue_staff_deadline_emails()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  item jsonb := to_jsonb(new);
  email_kind text := tg_argv[0];
  needed text := internal.staff_email_capability(tg_argv[0]);
  submitters uuid[];
  room bigint;
begin
  if needed is null then raise exception 'unknown staff email kind' using errcode='22023'; end if;
  -- A staff duplicate-event report: the staff member raised it.
  if email_kind='staff_report' and item->>'report_origin' is distinct from 'public' then return null; end if;
  -- Whoever submitted it already knows: the member, the staff member who
  -- recorded a request received another way, the appellant, the reporter.
  -- The person a report is about is never told of it.
  submitters := array_remove(array[(item->>'subject_user_id')::uuid,(item->>'intake_by')::uuid,
    (item->>'appellant_id')::uuid,(item->>'reporter_id')::uuid,(item->>'subject_account_id')::uuid],null);
  -- At most 30 staff deadline emails in any 24 hours, all staff and kinds
  -- together, so the email provider's daily allowance keeps room for members'
  -- emails; items past it are still in the staff queues. Submissions queue one
  -- at a time, so overlapping ones cannot pass the cap.
  perform pg_advisory_xact_lock(hashtextextended('private.staff_deadline_emails',0));
  room := 30-(select count(*) from private.outbox_events o
    where o.kind in('staff_privacy_request','staff_appeal','staff_report')
      and o.created_at>statement_timestamp()-interval '24 hours');
  if room<=0 then return null; end if;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
  select email_kind,new.id,r.user_id,email_kind||':'||new.id::text||':'||r.user_id::text
  from private.staff_roles r
  join private.staff_capabilities c on c.role=r.role and c.capability=needed
  join auth.users u on u.id=r.user_id
  where r.revoked_at is null and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and not (r.user_id=any(submitters))
  order by r.granted_at,r.user_id
  limit room
  on conflict (dedupe_key) do nothing;
  return null;
end;
$function$;
alter function internal.queue_staff_deadline_emails() owner to postgres;
revoke all on function internal.queue_staff_deadline_emails() from public,anon,authenticated,service_role;

create or replace trigger queue_staff_deadline_email after insert on private.privacy_requests
  for each row execute function internal.queue_staff_deadline_emails('staff_privacy_request');
create or replace trigger queue_staff_deadline_email after insert on private.frontend_appeals
  for each row execute function internal.queue_staff_deadline_emails('staff_appeal');
create or replace trigger queue_staff_deadline_email after insert on private.reports
  for each row execute function internal.queue_staff_deadline_emails('staff_report');

-- 3. The email job claims the staff deadline emails.
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

notify pgrst,'reload schema';
commit;
