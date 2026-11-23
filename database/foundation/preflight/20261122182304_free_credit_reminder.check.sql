-- Read-only preflight for updates/20261122182304_free_credit_reminder.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.claim_supported_notification_outbox and
-- api.run_slot_renewals have their reviewed bodies, the two new functions are
-- absent and the outbox kind check is the reviewed one (update not applied),
-- or everything is the update's (already applied), and counts:
-- - "free credits running": active free credits that have not ended;
-- - "ending within 3 days": those of them whose end is at most 3 days away
--   (their members get a reminder at the next minute job, unless banned,
--   suspended or closed);
-- - "reminders queued": free credit reminders in the outbox (always 0 before
--   the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.claim_supported_notification_outbox(text[],integer)',
      '9a4c68c8ba330364831aac3bdf66b2aa', 'f659e9ebf7dcf269e4759879537a10f0'),
    ('api.run_slot_renewals(integer)',
      '64c3c57229ca6fe6b8163fd8d57dbfcc', '2dc453b1de85fbdb169b983c42109c5f'),
    ('internal.free_credit_reminder_key(uuid,uuid)',
      'absent', '7031f3b16ccc65060e6b1082d07341d3'),
    ('internal.queue_free_credit_reminders(integer)',
      'absent', '11040161aaa93a255c2a153c476d1d55')
  ) v(sig, reviewed, updated)
  union all
  select 'outbox_events_kind_check', '3680e8be14065608e4f18ffd2a041fd3', '8f88842810c8e4240cb89176f9398bb6',
    coalesce((select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
      where c.conrelid = 'private.outbox_events'::regclass and c.conname = 'outbox_events_kind_check'), 'absent')
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
gifts as (
  select g.ends_at from private.entitlements g
  where g.source = 'free_credit' and g.status = 'active' and g.ends_at > statement_timestamp()
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'free credit reminder: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; free credits running: ' || (select count(*) from gifts)
    || '; ending within 3 days: '
    || (select count(*) from gifts g where g.ends_at <= statement_timestamp() + interval '3 days')
    || '; reminders queued: '
    || (select count(*) from private.outbox_events o where o.kind = 'free_credit_reminder') as detail
from state s
union all
select kind, detail from problems;
