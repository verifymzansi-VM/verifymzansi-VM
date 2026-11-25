-- Read-only preflight for updates/20261125150215_small_lifecycle_rules.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.claim_supported_notification_outbox,
-- api.run_slot_renewals and internal.delete_post have their reviewed bodies,
-- the three new functions are absent and the outbox kind check is the
-- reviewed one (update not applied), or everything is the update's (already
-- applied), and counts:
-- - "events starting over 365 days ahead": must be 0 (the update refuses
--   otherwise);
-- - "stickers ending within 30 days": approved CIPC or Seen checks whose end
--   is at most 30 days away (their owners may get a reminder at the next
--   minute job);
-- - "posts with an open report": posts their owners cannot delete until staff
--   have looked at the report;
-- - "reminders queued": sticker renewal reminders in the outbox (always 0
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
      '368f515805291682c74f28b163c50687', '407d5c969a5cf466602555fedb7b23df'),
    ('api.run_slot_renewals(integer)',
      '2dc453b1de85fbdb169b983c42109c5f', '72556cba7602b4191dd1e2ee5811915f'),
    ('internal.delete_post(uuid,integer)',
      '2aa04c741c9dee2e414be6ae1f03f73d', 'ba5e05f4803ab918135a4aa6dbf05ba1'),
    ('internal.sticker_renewal_reminder_key(uuid,uuid)',
      'absent', 'f0296fa207968b44d2249cbe31f02f1c'),
    ('internal.queue_sticker_renewal_reminders(integer)',
      'absent', '79ac584983c94b27efed334fe332ef1b'),
    ('internal.event_start_within_a_year()',
      'absent', '5e66f9025f39b986c066ee4de6ae464e')
  ) v(sig, reviewed, updated)
  union all
  select 'outbox_events_kind_check', '3dd36603eb690443cc2af09e976e6d56', '89576322fd690701d0f4a17756fb366d',
    coalesce((select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
      where c.conrelid = 'private.outbox_events'::regclass and c.conname = 'outbox_events_kind_check'), 'absent')
  union all
  select 'trigger event_start_within_a_year', 'absent', 'present',
    case when exists(select 1 from pg_trigger t where t.tgrelid = 'private.event_details'::regclass
      and t.tgname = 'event_start_within_a_year') then 'present' else 'absent' end
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
far as (
  select count(*) as n from private.event_details e where e.starts_at > clock_timestamp() + interval '365 days'
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
  union all
  select 'problem', n || ' events start more than 365 days ahead; the update would refuse' from far where n > 0
)
select 'summary' as kind,
  'small lifecycle rules: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; events starting over 365 days ahead: ' || (select n from far)
    || '; stickers ending within 30 days: '
    || (select count(*) from private.frontend_business_checks c where c.status = 'approved' and c.kind in ('cipc', 'seen')
         and c.expires_at > statement_timestamp() and c.expires_at <= statement_timestamp() + interval '30 days')
    || '; posts with an open report: '
    || (select count(distinct r.post_id) from private.reports r where r.status = 'open' and r.post_id is not null)
    || '; reminders queued: '
    || (select count(*) from private.outbox_events o where o.kind = 'sticker_renewal_reminder') as detail
from state s
union all
select kind, detail from problems;
