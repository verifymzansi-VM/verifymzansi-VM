-- Read-only preflight for updates/20261122111209_term_ending_notice.sql.
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
-- - "paid terms of 180 days or more running": active paid grants that run 180
--   days or more from their start to their end and have not ended;
-- - "ending within 84 days": those of them whose end is at most 84 days away
--   (the ones from 63 to 84 days away get a notice at the next minute job);
-- - "notices queued": term-ending notices in the outbox (always 0 before the
--   update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.claim_supported_notification_outbox(text[],integer)',
      'c7206aab3ac04b1f9d9b6ce2dc47bd0f', 'd7bce6d6994095f93fb3ca5dac54e3e6'),
    ('api.run_slot_renewals(integer)',
      'b78dc0ac9c98fd46da971c17a3f07a43', '64c3c57229ca6fe6b8163fd8d57dbfcc'),
    ('internal.term_ending_notice_due(uuid,uuid)',
      'absent', 'db5cfe64a62f97b249b9348d34599ce8'),
    ('internal.queue_term_ending_notices(integer)',
      'absent', '70a197a68c46e8cb4a1fbc53056e0d86')
  ) v(sig, reviewed, updated)
  union all
  select 'outbox_events_kind_check', '2680543d010bccf4d2035c154f680430', '3680e8be14065608e4f18ffd2a041fd3',
    coalesce((select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
      where c.conrelid = 'private.outbox_events'::regclass and c.conname = 'outbox_events_kind_check'), 'absent')
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
terms as (
  select g.ends_at from private.entitlements g
    join private.payments pay on pay.id = g.payment_id
  where g.source = 'retail_paid' and g.status = 'active' and pay.status = 'complete'
    and g.ends_at - g.starts_at >= interval '180 days' and g.ends_at > statement_timestamp()
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'term ending notice: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; paid terms of 180 days or more running: ' || (select count(*) from terms)
    || '; ending within 84 days: '
    || (select count(*) from terms t where t.ends_at <= statement_timestamp() + interval '84 days')
    || '; notices queued: '
    || (select count(*) from private.outbox_events o where o.kind = 'term_ending_notice') as detail
from state s
union all
select kind, detail from problems;
