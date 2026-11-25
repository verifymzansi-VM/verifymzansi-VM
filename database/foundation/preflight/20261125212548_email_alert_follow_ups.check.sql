-- Read-only preflight for updates/20261125212548_email_alert_follow_ups.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.claim_lost_email_alert,
-- internal.staff_email_due and internal.queue_staff_deadline_emails have
-- their reviewed bodies (update not applied) or this update's (already
-- applied), and counts:
-- - "lost emails": queued emails and privacy request notices unsent after
--   their last attempt whose lease has ended (one still within its lease is
--   being tried for the 8th time and is not lost yet), not yet in an alert;
-- - "alerts sent over 400 days ago": deleted by the next alert run after the
--   update;
-- - "staff without an authenticator app": staff whose role gets deadline
--   emails but who have no verified authenticator app (they get none after
--   the update);
-- - "staff emails queued today": staff deadline emails of the last 24 hours,
--   privacy requests / appeals and reports (only appeals and reports count
--   towards the cap of 30 after the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.claim_lost_email_alert(integer)',
      '25fee44314e2556ef9bea1f44e05c9bc', '174244d1d29cb28747f23b7a72c9b22e'),
    ('internal.staff_email_due(text,uuid,uuid)',
      '33aed641726695e14ea1f64c4b0ba2eb', '81cdbb19b32d10b7e0edb1a9b8b82ba3'),
    ('internal.queue_staff_deadline_emails()',
      '69ea078b94ffc5d1116dcfbd63e50744', '9dc8c0a562a998d41bec910dc740e717')
  ) v(sig, reviewed, updated)
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
  'email alert follow-ups: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; lost emails: '
    || ((select count(*) from private.outbox_events o where o.processed_at is null and o.delivery_attempts >= 8
          and o.lost_alert_id is null and (o.delivery_until is null or o.delivery_until < clock_timestamp()))
      + (select count(*) from private.privacy_notice_jobs j where j.delivered_at is null and j.attempts >= 8
          and j.lost_alert_id is null and (j.locked_until is null or j.locked_until < clock_timestamp())))
    || '; alerts sent over 400 days ago: '
    || (select count(*) from private.lost_email_alerts a where a.sent_at < clock_timestamp() - interval '400 days')
    || '; staff without an authenticator app: '
    || (select count(distinct r.user_id) from private.staff_roles r
        join private.staff_capabilities c on c.role = r.role
          and c.capability in ('dsar:manage', 'appeal:decide', 'report:resolve')
        where r.revoked_at is null
          and not exists(select 1 from auth.mfa_factors f where f.user_id = r.user_id
            and f.factor_type = 'totp' and f.status = 'verified'))
    || '; staff emails queued today: '
    || (select count(*) filter (where o.kind = 'staff_privacy_request') || ' / '
          || count(*) filter (where o.kind in ('staff_appeal', 'staff_report'))
        from private.outbox_events o
        where o.kind in ('staff_privacy_request', 'staff_appeal', 'staff_report')
          and o.created_at > statement_timestamp() - interval '24 hours') as detail
from state s
union all
select kind, detail from problems;
