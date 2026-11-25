-- Reviewed rollback for updates/20261125212548_email_alert_follow_ups.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier bodies of internal.claim_lost_email_alert,
-- internal.staff_email_due and internal.queue_staff_deadline_emails byte for
-- byte (same signatures, grants and owners; those of
-- 20261125131322_lost_email_alert_staff_deadlines.sql) and drops the column
-- private.lost_email_alerts.payments with its check. Queued emails and alerts
-- stay: staff privacy request emails queued past the cap are still sent, and
-- an alert offered again then has no payment count. A website from the
-- update's pull request keeps working: it falls back to counting the listed
-- payments. It refuses (55000) unless the three functions have this update's
-- bodies (a later update changed one: undo that update first).
begin;
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
        'internal.claim_lost_email_alert(integer) 174244d1d29cb28747f23b7a72c9b22e',
        'internal.staff_email_due(text,uuid,uuid) 81cdbb19b32d10b7e0edb1a9b8b82ba3',
        'internal.queue_staff_deadline_emails() 9dc8c0a562a998d41bec910dc740e717') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

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

alter table private.lost_email_alerts drop constraint if exists lost_email_alerts_payments_check;
alter table private.lost_email_alerts drop column if exists payments;

notify pgrst,'reload schema';
commit;
