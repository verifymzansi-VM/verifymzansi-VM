-- Follow-ups to the lost-email alert and the staff deadline emails (launch
-- checklist item 56, batch B; 20261125131322_lost_email_alert_staff_deadlines.sql).
--
-- 1. The lost-email alert. internal.claim_lost_email_alert (full body):
--    - Sent alerts are deleted 400 days after sending on every run. Until now
--      they were deleted only when a new alert was made, so they stayed longer
--      while nothing was lost.
--    - New column private.lost_email_alerts.payments: how many of ALL the lost
--      emails an alert reports are payment emails (kind payment_...), not only
--      of those it lists. The claim returns it as "payments" (an alert offered
--      again returns the stored number; one made before this update returns
--      null). The website's subject line counts payments from it.
--    internal.complete_lost_email_alert is unchanged: the alert's id is both
--    the claim and the email's key and stays the same when an alert is
--    offered again, so giving an alert back cannot tell its holders apart.
--    That is safe: the hold lasts 5 minutes while a run ends within a minute,
--    and the email's key stops a second delivery.
-- 2. The staff deadline emails.
--    - Staff without a verified authenticator app get none: they cannot use
--      any staff page (internal.staff_actor). internal.queue_staff_deadline_emails
--      (full body) leaves them out, and internal.staff_email_due (full body;
--      the email job's check before each send) skips them.
--    - An appeal is not emailed to the staff who took, approved or reported
--      the decision appealed against: they may not decide that appeal
--      (internal.resolve_frontend_appeal). Same two functions.
--    - A privacy request is always emailed: it has a legal deadline, so it
--      is outside the cap. Appeals and reports keep the shared cap of 30 in
--      any 24 hours (now counting appeals and reports only). The cap's count
--      is correct only at read committed (the isolation level of every
--      website and job call); at a stricter level an appeal or report queues
--      no email (it is still in the staff queue).
--
-- No API command is added or removed; the claim's result gains one optional
-- field. The website release from the same pull request reads it and falls
-- back to the listed payments when it is missing, so either order is safe.
-- ORDER: apply first, then merge.
-- It refuses with 55000 unless each function it replaces has its reviewed
-- body (or this update's).
-- Read-only preflight: ../preflight/20261125212548_email_alert_follow_ups.check.sql.
-- Rollback: ../rollback/20261125212548_email_alert_follow_ups.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.claim_lost_email_alert(integer)'),('internal.staff_email_due(text,uuid,uuid)'),
      ('internal.queue_staff_deadline_emails()')) v(sig)
  loop
    if shape not in (
        'internal.claim_lost_email_alert(integer) 25fee44314e2556ef9bea1f44e05c9bc',
        'internal.staff_email_due(text,uuid,uuid) 33aed641726695e14ea1f64c4b0ba2eb',
        'internal.queue_staff_deadline_emails() 69ea078b94ffc5d1116dcfbd63e50744',
        'internal.claim_lost_email_alert(integer) 174244d1d29cb28747f23b7a72c9b22e',
        'internal.staff_email_due(text,uuid,uuid) 81cdbb19b32d10b7e0edb1a9b8b82ba3',
        'internal.queue_staff_deadline_emails() 9dc8c0a562a998d41bec910dc740e717') then
      raise exception 'email alert follow-ups precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
end$$;

-- 1. The lost-email alert.
alter table private.lost_email_alerts add column if not exists payments integer;
alter table private.lost_email_alerts drop constraint if exists lost_email_alerts_payments_check;
alter table private.lost_email_alerts add constraint lost_email_alerts_payments_check
  check (payments between 0 and total);

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
  lost_payments integer;
  listed jsonb;
  nothing constant jsonb := jsonb_build_object('claim',null,'total',0,'items','[]'::jsonb);
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid lost email alert limit' using errcode='22023'; end if;
  -- One email job at a time takes or makes an alert.
  perform pg_advisory_xact_lock(hashtextextended('private.lost_email_alerts',0));
  -- Sent alerts are kept 400 days after sending, also while nothing is lost.
  delete from private.lost_email_alerts where sent_at<now_at-interval '400 days';
  -- An alert whose send failed (its lease ended or was given back) is offered
  -- again first, unchanged: same id, same list.
  update private.lost_email_alerts a set claimed_until=now_at+interval '5 minutes'
    where a.id=(select x.id from private.lost_email_alerts x where x.sent_at is null and x.claimed_until<=now_at
      order by x.created_at,x.id limit 1)
    returning a.* into batch;
  if found then
    return jsonb_build_object('claim',batch.id,'total',batch.total,'payments',batch.payments,'items',batch.items);
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
    -- The payment emails among all of them, listed or not.
    (select count(*) from lost l where starts_with(l.item->>'kind','payment_')),
    coalesce((select jsonb_agg(l.item order by l.created_at,l.id)
      from (select * from lost order by created_at,id limit p_limit) l),'[]'::jsonb)
    into lost_total, lost_payments, listed;
  if lost_total=0 then return nothing; end if;
  insert into private.lost_email_alerts(id,created_at,claimed_until,items,total,payments)
    values(batch_id,now_at,now_at+interval '5 minutes',listed,lost_total,lost_payments);
  return jsonb_build_object('claim',batch_id,'total',lost_total,'payments',lost_payments,'items',listed);
end;
$function$;
alter function internal.claim_lost_email_alert(integer) owner to postgres;
revoke all on function internal.claim_lost_email_alert(integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_lost_email_alert(integer) to service_role;

-- 2. The staff deadline emails.
-- A staff deadline email is still due: its staff member can sign in, has a
-- verified authenticator app, still holds the capability, and the item is
-- still open.
CREATE OR REPLACE FUNCTION internal.staff_email_due(p_kind text, p_item uuid, p_staff uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.staff_roles r join private.staff_capabilities c on c.role=r.role
      where r.user_id=p_staff and r.revoked_at is null and c.capability=internal.staff_email_capability(p_kind))
    and exists(select 1 from private.current_account_access a where a.id=p_staff)
    -- Every staff page needs one (internal.staff_actor).
    and exists(select 1 from auth.mfa_factors f where f.user_id=p_staff and f.factor_type='totp' and f.status='verified')
    and case p_kind
      when 'staff_privacy_request' then exists(select 1 from private.privacy_requests x where x.id=p_item
        and x.status in('submitted','identity_pending','in_progress') and x.minimised_at is null)
      -- Never to whoever took, approved or reported the decision appealed
      -- against: they may not decide the appeal.
      when 'staff_appeal' then exists(select 1 from private.frontend_appeals x where x.id=p_item and x.status='submitted'
        and not exists(select 1 from private.frontend_appealable_actions d where d.id=x.action_id
          and d.account_id=x.appellant_id and p_staff in(d.actor_id,d.approver_id,d.reporter_id)))
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
  -- Whoever took, approved or reported the decision appealed against may not
  -- decide the appeal.
  if email_kind='staff_appeal' then
    submitters := submitters||coalesce((select array_agg(b) from private.frontend_appealable_actions d
      cross join lateral unnest(array[d.actor_id,d.approver_id,d.reporter_id]) b
      where d.id=(item->>'action_id')::uuid and d.account_id=(item->>'appellant_id')::uuid and b is not null),
      '{}'::uuid[]);
  end if;
  -- A privacy request is always emailed: it has a legal deadline. Appeals and
  -- reports: at most 30 in any 24 hours together, so the email provider's
  -- daily allowance keeps room for members' emails; items past it are still
  -- in the staff queues. Submissions queue one at a time, so overlapping ones
  -- cannot pass the cap; that holds only at read committed (each statement
  -- sees what committed before it), so at a stricter level none is queued.
  if email_kind<>'staff_privacy_request' then
    if current_setting('transaction_isolation')<>'read committed' then return null; end if;
    perform pg_advisory_xact_lock(hashtextextended('private.staff_deadline_emails',0));
    room := 30-(select count(*) from private.outbox_events o
      where o.kind in('staff_appeal','staff_report')
        and o.created_at>statement_timestamp()-interval '24 hours');
    if room<=0 then return null; end if;
  end if;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
  select email_kind,new.id,r.user_id,email_kind||':'||new.id::text||':'||r.user_id::text
  from private.staff_roles r
  join private.staff_capabilities c on c.role=r.role and c.capability=needed
  join auth.users u on u.id=r.user_id
  where r.revoked_at is null and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
    and not (r.user_id=any(submitters))
    -- Every staff page needs one (internal.staff_actor).
    and exists(select 1 from auth.mfa_factors f where f.user_id=r.user_id and f.factor_type='totp' and f.status='verified')
  order by r.granted_at,r.user_id
  limit room
  on conflict (dedupe_key) do nothing;
  return null;
end;
$function$;
alter function internal.queue_staff_deadline_emails() owner to postgres;
revoke all on function internal.queue_staff_deadline_emails() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
