-- Read-only preflight for updates/20261125225855_lifecycle_rule_follow_ups.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.delete_post and
-- internal.sticker_renewal_reminder_key have the bodies of
-- 20261125150215_small_lifecycle_rules.sql (update not applied) or this
-- update's (already applied), and counts:
-- - "posts with an open report": posts with any open report (public or a
--   staff duplicate flag);
-- - "of which the owner may delete after the update": those with no open
--   public report that is under 7 days old or still within the clean-up's
--   waiting time (internal.post_report_deferred);
-- - "reminders waiting": sticker renewal reminders not yet sent;
-- - "of which the owner's ID is not reviewed": those the email job will finish
--   as skipped once the update is applied.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.delete_post(uuid,integer)',
      'ba5e05f4803ab918135a4aa6dbf05ba1', '009322bbbd81a75ceaa3ec8fe3f4fef3'),
    ('internal.sticker_renewal_reminder_key(uuid,uuid)',
      'f0296fa207968b44d2249cbe31f02f1c', '122a9d4ca00a7b25bf47909b88d43901')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
reported as (
  select p.id,
    exists(select 1 from private.reports r where r.post_id = p.id and r.status = 'open' and r.report_origin = 'public'
      and (internal.post_report_deferred(p) or r.created_at > clock_timestamp() - interval '7 days')) as held
  from private.posts p
  where exists(select 1 from private.reports r where r.post_id = p.id and r.status = 'open')
),
waiting as (
  select o.owner_id from private.outbox_events o
  where o.kind = 'sticker_renewal_reminder' and o.processed_at is null
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'lifecycle rule follow-ups: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; posts with an open report: ' || (select count(*) from reported)
    || ' (of which the owner may delete after the update: ' || (select count(*) from reported where not held)
    || '); reminders waiting: ' || (select count(*) from waiting)
    || ' (of which the owner''s ID is not reviewed: '
    || (select count(*) from waiting w where not internal.frontend_business_identity_reviewed(w.owner_id))
    || ')' as detail
from state s
union all
select kind, detail from problems;
