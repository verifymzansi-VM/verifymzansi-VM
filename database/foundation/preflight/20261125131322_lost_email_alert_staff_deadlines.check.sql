-- Read-only preflight for updates/20261125131322_lost_email_alert_staff_deadlines.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.claim_supported_notification_outbox has
-- its reviewed body, the eight new functions are absent and the outbox kind
-- check is the reviewed one (update not applied), or everything is the
-- update's (already applied), and counts:
-- - "lost emails": queued emails and privacy request notices unsent after
--   their last attempt (the first alert after the update lists them all);
-- - "open privacy requests", "open appeals", "open reports": waiting now (the
--   update emails staff about new ones only);
-- - "staff emails queued": staff deadline emails in the outbox (always 0
--   before the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.claim_supported_notification_outbox(text[],integer)',
      'f659e9ebf7dcf269e4759879537a10f0', '368f515805291682c74f28b163c50687'),
    ('internal.staff_email_capability(text)', 'absent', 'dcb7b5e6846f24efe17eb7800184dd59'),
    ('internal.staff_due_after(timestamp with time zone,integer)', 'absent', 'b755ae0538f37eaf91c6d6818584db91'),
    ('internal.staff_email_due(text,uuid,uuid)', 'absent', '33aed641726695e14ea1f64c4b0ba2eb'),
    ('internal.queue_staff_deadline_emails()', 'absent', '69ea078b94ffc5d1116dcfbd63e50744'),
    ('internal.claim_lost_email_alert(integer)', 'absent', '25fee44314e2556ef9bea1f44e05c9bc'),
    ('api.claim_lost_email_alert(integer)', 'absent', '70303c452ab6cda4848c333b1247efd3'),
    ('internal.complete_lost_email_alert(uuid,boolean)', 'absent', '5575975a22aab2cf647d7bccafe2c8a2'),
    ('api.complete_lost_email_alert(uuid,boolean)', 'absent', '636b85615798a2f3f923f9dc25d4934a')
  ) v(sig, reviewed, updated)
  union all
  select 'outbox_events_kind_check', '8f88842810c8e4240cb89176f9398bb6', '3dd36603eb690443cc2af09e976e6d56',
    coalesce((select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
      where c.conrelid = 'private.outbox_events'::regclass and c.conname = 'outbox_events_kind_check'), 'absent')
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'lost email alert: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; lost emails: '
    || ((select count(*) from private.outbox_events o where o.processed_at is null and o.delivery_attempts >= 8)
      + (select count(*) from private.privacy_notice_jobs j where j.delivered_at is null and j.attempts >= 8))
    || '; open privacy requests: '
    || (select count(*) from private.privacy_requests r where r.status in ('submitted', 'identity_pending', 'in_progress'))
    || '; open appeals: '
    || (select count(*) from private.frontend_appeals a where a.status = 'submitted')
    || '; open reports: '
    || (select count(*) from private.reports r where r.status = 'open')
    || '; staff emails queued: '
    || (select count(*) from private.outbox_events o
      where o.kind in ('staff_privacy_request', 'staff_appeal', 'staff_report')) as detail
from state s
union all
select kind, detail from problems;
