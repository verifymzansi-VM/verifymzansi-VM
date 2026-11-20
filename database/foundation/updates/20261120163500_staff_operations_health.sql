-- Staff operations health (launch checklist item 8, roadmap M5.5 part 1).
--
-- The staff page /admin/operations read job, incident and retention records
-- that only the retired backend had. This update gives it one staff read over
-- what the foundation holds, and makes every scheduled job record when it last
-- ran, so a job that stops running shows as late.
--
-- From this update:
-- 1. New table private.scheduled_job_runs (job, last_run_at): one row per
--    scheduled job, the time its command last finished. No account data. No
--    API role has access; row level security is on.
-- 2. internal.scheduled_job_catalogue(): the closed list of scheduled jobs,
--    how often each runs and after how long without a run it counts as late.
--    The jobs are the commands the three timed Workers start through the
--    website (wrangler.ops-jobs.toml every minute, wrangler.retention-cleanup.toml
--    every 5 minutes, wrangler.payment-cleanup.toml every 10 minutes and daily
--    at 05:15 UTC):
--      every minute (late after 10 minutes): slot_renewals, post_lifecycle,
--        sponsorships, inbox_purge, intro_trials, commissions,
--        bank_transfer_expiry, package_add_invoices, email_delivery,
--        payment_alerts, privacy_notices;
--      every 5 minutes (late after 30 minutes): retention, form_drafts,
--        evidence_cleanup, media_cleanup;
--      every 10 minutes (late after 40 minutes): payment_checks;
--      every day (late after 26 hours): refund_check.
-- 3. internal.note_scheduled_job_run(job, result): records that `job` ran
--    and returns `result` unchanged. It refuses a job outside the catalogue.
--    At most one write per job every 20 seconds (a later call in that window
--    reads the row and writes nothing), so the email claims, which run several
--    times a minute, do not rewrite the row each time. It never stores a time
--    later than now: a stored time in the future (written by hand) is pulled
--    back to now on the next run, and the read shows it as late meanwhile.
--    Executable by service_role only (the job commands run as service_role).
-- 4. Fifteen service-only job commands keep their signature, return type,
--    owner and grants; each now passes its result through
--    internal.note_scheduled_job_run. The record is written in the same
--    transaction as the job's work, after it: a command that fails records
--    nothing.
--      api.run_slot_renewals            -> slot_renewals
--      api.run_post_lifecycle           -> post_lifecycle
--      api.sweep_sponsorships           -> sponsorships
--      api.purge_expired_inbox          -> inbox_purge
--      api.reconcile_intro_trials       -> intro_trials
--      api.approve_due_commissions      -> commissions
--      api.expire_waiting_bank_transfers -> bank_transfer_expiry
--      api.void_ended_package_add_invoices -> package_add_invoices
--      api.claim_supported_notification_outbox -> email_delivery
--      api.claim_payment_alerts         -> payment_alerts
--      api.claim_frontend_privacy_notice -> privacy_notices
--      api.run_retention                -> retention
--      api.purge_frontend_form_drafts   -> form_drafts
--      api.claim_evidence_cleanup       -> evidence_cleanup
--      api.claim_media_cleanup          -> media_cleanup
--    Only the api wrappers change; the internal functions they call (for
--    example internal.run_retention) are untouched.
--    The two payment jobs run several steps in the website, so one command
--    finishing does not mean the run succeeded. For them the website calls
--    the new service-only command api.record_scheduled_job_run(job) after the
--    whole run succeeded: payment_checks (the 10-minute payment status check,
--    no payment failed) and refund_check (the daily refund check, Ozow's list
--    read in full). It accepts only those two jobs (22023 otherwise).
-- 5. New staff read api.get_staff_operations_health() (internal twin
--    internal.get_staff_operations_health()): staff with audit:view (governor
--    and admin, with a recent authenticator code, like every staff command).
--    Read only. It returns
--    - jobs: every catalogued job with how often it runs, its last run and
--      whether it is late;
--    - emails: queued emails not sent after their last attempt (8) or still
--      unsent a day after they were queued (stuck), and the whole unsent
--      queue (waiting), with at most 50 stuck ones (kind, attempts, queued
--      time, error code);
--    - notices: privacy request notices in the same state (stuck), at most 50
--      (kind, attempts, queued time), counting only notices the notice job can
--      still send; notices it can never send (the request was minimised, or
--      the account's address is gone or no longer confirmed) are counted
--      apart (undeliverable);
--    - payments: payment problems seen in the past 7 days and paid payments
--      that could not be activated, with at most 50 problems (an 8-character
--      payment reference, reason, source, first and last seen, how often,
--      whether staff were alerted);
--    - deletions: account deletions held back (blocked), file deletions stuck
--      for over a day, file deletions queued, ID evidence past its deletion
--      date (outside legal and fraud holds) and accounts on legal hold, with
--      at most 50 held-back account deletions (reason, since when, the
--      deletion date, who closed the account);
--    - incidents: open (unacknowledged) cost alarms, at most 50 (metric,
--      level, period, raised).
--    No account id, name, email, phone or message text.
--
-- New command only, and the job commands' signatures are unchanged. Websites
-- deployed before the update work with it (they never call the read); the
-- website that reads it shows "could not be loaded" until the update is
-- applied, and its page stays switched off (SHOW_STAFF_OPERATIONS) until
-- launch. ORDER: apply first, then merge, as usual.
-- Read-only preflight: ../preflight/20261120163500_staff_operations_health.check.sql.
-- Rollback: ../rollback/20261120163500_staff_operations_health.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and
-- every job command has its reviewed body (or this update's).
do $$
declare present integer; drift text;
begin
  select (to_regclass('private.scheduled_job_runs') is not null)::integer
    + (to_regprocedure('internal.scheduled_job_catalogue()') is not null)::integer
    + (to_regprocedure('internal.note_scheduled_job_run(text,anyelement)') is not null)::integer
    + (to_regprocedure('internal.get_staff_operations_health()') is not null)::integer
    + (to_regprocedure('internal.record_scheduled_job_run(text)') is not null)::integer
    + (to_regprocedure('api.record_scheduled_job_run(text)') is not null)::integer
    + (to_regprocedure('api.get_staff_operations_health()') is not null)::integer
  into present;
  if present not in (0, 7) then
    raise exception 'operations health precondition: % of 7 objects exist', present using errcode='55000';
  end if;
  select string_agg(v.sig, ', ' order by v.sig) into drift
  from (values
    ('api.run_slot_renewals(integer)', 'b4e29cfe085196212c3e710c09631de2', 'b78dc0ac9c98fd46da971c17a3f07a43'),
    ('api.run_post_lifecycle(integer)', '3deb53dea49377d22fb4bacf2931ccf8', 'fdc95d2c2e7d7af8411c18e809370cac'),
    ('api.sweep_sponsorships(integer)', '3aa601d7753db12172a8d6783e97c4f5', '4368e3adf7f855a1e677ccb97ad4bb4e'),
    ('api.purge_expired_inbox(integer)', '5b30f6186c05e11a858e8921ae531706', '93aaff6a107125239a173cf5c2c8a2ba'),
    ('api.reconcile_intro_trials(integer)', '7329f1acde5d835684dc1cdfbfb6c59f', 'd0b4dee427e3a6aa0e9be5587d70cae6'),
    ('api.approve_due_commissions(integer)', '840f50cb418a3bd415116ade462b59d0', '44f02582e6b1486ec52dbfd627b77f6f'),
    ('api.expire_waiting_bank_transfers(integer)', '3d191c823e4c8ea01e137dc4cb3b059f', '0b4654bc20b9c08641d06a1780bafec8'),
    ('api.void_ended_package_add_invoices(integer)', 'ff2882aa42979545ada32c671ff1a408', '10c5e610ad372770fce06e5feaf569e3'),
    ('api.claim_supported_notification_outbox(text[],integer)', '70f1b18f7bf830831f1e791eeb054fbc', 'b0dd2ef0c8fa21aa0c07a3b0f530e90e'),
    ('api.claim_payment_alerts(integer)', 'cc0dafa479115c493baf59f491fd79d4', '524e92211a80e57582a04785bd94df5e'),
    ('api.claim_frontend_privacy_notice()', '6d278e3c44af8b191bc8edc5c6dd711b', '05ad93776187bff58e72d43c5f6be3d0'),
    ('api.run_retention(integer)', '149599bb34980837be83753e3b622e01', 'af45cfe715c12bc7e772a7ef3ecf3475'),
    ('api.purge_frontend_form_drafts(integer)', '13c798a36d3441ec17ad532a16b7eb98', 'a41ca813762071f9b0b963d54cf3155a'),
    ('api.claim_evidence_cleanup(integer)', '9837e370cf687084e2e2f492ed6f9053', '9d3d5b7f73ee0100006f71657ff6f79c'),
    ('api.claim_media_cleanup(integer)', '4f8aa155ea7c2a35333d2dce7fe8d10d', '5b146b7b0c1f348bf1713c0f23bfd901')
  ) v(sig, reviewed, updated)
  where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
    is distinct from v.reviewed
    and (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig))
    is distinct from v.updated;
  if drift is not null then
    raise exception 'operations health drift: not the reviewed body: %', drift using errcode='55000';
  end if;
end$$;

create table if not exists private.scheduled_job_runs (
  job text not null,
  last_run_at timestamp with time zone not null,
  constraint scheduled_job_runs_pkey primary key (job),
  constraint scheduled_job_runs_job_check check (job ~ '^[a-z_]{1,40}$')
);
alter table private.scheduled_job_runs owner to postgres;
alter table private.scheduled_job_runs enable row level security;
revoke all on private.scheduled_job_runs from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.scheduled_job_catalogue()
 RETURNS TABLE(job text, every text, late_after interval, ord integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The timed Workers' schedules: wrangler.ops-jobs.toml (every minute),
  -- wrangler.retention-cleanup.toml (every 5 minutes) and
  -- wrangler.payment-cleanup.toml (every 10 minutes; the refund check daily).
  select v.job, v.every, v.late_after, v.ord from (values
    (1, 'slot_renewals', 'minute', interval '10 minutes'),
    (2, 'post_lifecycle', 'minute', interval '10 minutes'),
    (3, 'sponsorships', 'minute', interval '10 minutes'),
    (4, 'inbox_purge', 'minute', interval '10 minutes'),
    (5, 'intro_trials', 'minute', interval '10 minutes'),
    (6, 'commissions', 'minute', interval '10 minutes'),
    (7, 'bank_transfer_expiry', 'minute', interval '10 minutes'),
    (8, 'package_add_invoices', 'minute', interval '10 minutes'),
    (9, 'email_delivery', 'minute', interval '10 minutes'),
    (10, 'payment_alerts', 'minute', interval '10 minutes'),
    (11, 'privacy_notices', 'minute', interval '10 minutes'),
    (12, 'retention', '5_minutes', interval '30 minutes'),
    (13, 'form_drafts', '5_minutes', interval '30 minutes'),
    (14, 'evidence_cleanup', '5_minutes', interval '30 minutes'),
    (15, 'media_cleanup', '5_minutes', interval '30 minutes'),
    (16, 'payment_checks', '10_minutes', interval '40 minutes'),
    (17, 'refund_check', 'day', interval '26 hours')
  ) v(ord, job, every, late_after)
$function$;
alter function internal.scheduled_job_catalogue() owner to postgres;
revoke all on function internal.scheduled_job_catalogue() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.note_scheduled_job_run(p_job text, p_result anyelement)
 RETURNS anyelement
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_job is null or not exists(select 1 from internal.scheduled_job_catalogue() c where c.job=p_job) then
    raise exception 'scheduled job required' using errcode='22023';
  end if;
  -- At most one write per job every 20 seconds; a later run moves the time on.
  -- Never later than now: a time in the future is pulled back to now.
  if not exists(select 1 from private.scheduled_job_runs r where r.job=p_job
      and r.last_run_at between clock_timestamp()-interval '20 seconds' and clock_timestamp()) then
    insert into private.scheduled_job_runs as r (job,last_run_at) values (p_job,clock_timestamp())
    on conflict (job) do update
      set last_run_at=least(greatest(r.last_run_at,excluded.last_run_at),clock_timestamp());
  end if;
  return p_result;
end
$function$;
alter function internal.note_scheduled_job_run(text,anyelement) owner to postgres;
revoke all on function internal.note_scheduled_job_run(text,anyelement) from public,anon,authenticated,service_role;
grant execute on function internal.note_scheduled_job_run(text,anyelement) to service_role;

CREATE OR REPLACE FUNCTION api.run_slot_renewals(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('slot_renewals', internal.run_slot_renewals(p_limit));
$function$;
alter function api.run_slot_renewals(integer) owner to postgres;
revoke all on function api.run_slot_renewals(integer) from public;
grant execute on function api.run_slot_renewals(integer) to service_role;

CREATE OR REPLACE FUNCTION api.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('post_lifecycle', internal.run_post_lifecycle(p_limit));
$function$;
alter function api.run_post_lifecycle(integer) owner to postgres;
revoke all on function api.run_post_lifecycle(integer) from public;
grant execute on function api.run_post_lifecycle(integer) to service_role;

CREATE OR REPLACE FUNCTION api.sweep_sponsorships(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('sponsorships', internal.sweep_sponsorships(p_limit));
$function$;
alter function api.sweep_sponsorships(integer) owner to postgres;
revoke all on function api.sweep_sponsorships(integer) from public;
grant execute on function api.sweep_sponsorships(integer) to service_role;

CREATE OR REPLACE FUNCTION api.purge_expired_inbox(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('inbox_purge', internal.purge_expired_inbox(p_limit));
$function$;
alter function api.purge_expired_inbox(integer) owner to postgres;
revoke all on function api.purge_expired_inbox(integer) from public;
grant execute on function api.purge_expired_inbox(integer) to service_role;

CREATE OR REPLACE FUNCTION api.reconcile_intro_trials(p_limit integer DEFAULT 20)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('intro_trials', internal.reconcile_intro_trials(p_limit));
$function$;
alter function api.reconcile_intro_trials(integer) owner to postgres;
revoke all on function api.reconcile_intro_trials(integer) from public;
grant execute on function api.reconcile_intro_trials(integer) to service_role;

CREATE OR REPLACE FUNCTION api.approve_due_commissions(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('commissions', internal.approve_due_commissions(p_limit));
$function$;
alter function api.approve_due_commissions(integer) owner to postgres;
revoke all on function api.approve_due_commissions(integer) from public;
grant execute on function api.approve_due_commissions(integer) to service_role;

CREATE OR REPLACE FUNCTION api.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('bank_transfer_expiry', internal.expire_waiting_bank_transfers(p_limit));
$function$;
alter function api.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function api.expire_waiting_bank_transfers(integer) from public;
grant execute on function api.expire_waiting_bank_transfers(integer) to service_role;

CREATE OR REPLACE FUNCTION api.void_ended_package_add_invoices(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('package_add_invoices', internal.void_ended_package_add_invoices(p_limit));
$function$;
alter function api.void_ended_package_add_invoices(integer) owner to postgres;
revoke all on function api.void_ended_package_add_invoices(integer) from public;
grant execute on function api.void_ended_package_add_invoices(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('email_delivery', internal.claim_supported_notification_outbox(p_supported_kinds,p_limit));
$function$;
alter function api.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function api.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function api.claim_supported_notification_outbox(text[],integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_payment_alerts(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('payment_alerts', internal.claim_payment_alerts(p_limit));
$function$;
alter function api.claim_payment_alerts(integer) owner to postgres;
revoke all on function api.claim_payment_alerts(integer) from public;
grant execute on function api.claim_payment_alerts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('privacy_notices', internal.claim_frontend_privacy_notice());
$function$;
alter function api.claim_frontend_privacy_notice() owner to postgres;
revoke all on function api.claim_frontend_privacy_notice() from public;
grant execute on function api.claim_frontend_privacy_notice() to service_role;

CREATE OR REPLACE FUNCTION api.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('retention', internal.run_retention(p_limit));
$function$;
alter function api.run_retention(integer) owner to postgres;
revoke all on function api.run_retention(integer) from public;
grant execute on function api.run_retention(integer) to service_role;

CREATE OR REPLACE FUNCTION api.purge_frontend_form_drafts(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('form_drafts', internal.purge_frontend_form_drafts(p_limit));
$function$;
alter function api.purge_frontend_form_drafts(integer) owner to postgres;
revoke all on function api.purge_frontend_form_drafts(integer) from public;
grant execute on function api.purge_frontend_form_drafts(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_evidence_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('evidence_cleanup', internal.claim_evidence_cleanup(p_limit));
$function$;
alter function api.claim_evidence_cleanup(integer) owner to postgres;
revoke all on function api.claim_evidence_cleanup(integer) from public;
grant execute on function api.claim_evidence_cleanup(integer) to service_role;

CREATE OR REPLACE FUNCTION api.claim_media_cleanup(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('media_cleanup', internal.claim_media_cleanup(p_limit));
$function$;
alter function api.claim_media_cleanup(integer) owner to postgres;
revoke all on function api.claim_media_cleanup(integer) from public;
grant execute on function api.claim_media_cleanup(integer) to service_role;

CREATE OR REPLACE FUNCTION internal.record_scheduled_job_run(p_job text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Only the jobs whose success the website decides.
  if p_job is null or p_job not in ('payment_checks', 'refund_check') then
    raise exception 'scheduled job recorded by the website required' using errcode='22023';
  end if;
  return internal.note_scheduled_job_run(p_job, true);
end
$function$;
alter function internal.record_scheduled_job_run(text) owner to postgres;
revoke all on function internal.record_scheduled_job_run(text) from public,anon,authenticated,service_role;
grant execute on function internal.record_scheduled_job_run(text) to service_role;

CREATE OR REPLACE FUNCTION api.record_scheduled_job_run(p_job text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_scheduled_job_run(p_job);
$function$;
alter function api.record_scheduled_job_run(text) owner to postgres;
revoke all on function api.record_scheduled_job_run(text) from public,anon,authenticated,service_role;
grant execute on function api.record_scheduled_job_run(text) to service_role;

CREATE OR REPLACE FUNCTION internal.get_staff_operations_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('audit:view'); now_at timestamptz := statement_timestamp();
  result jsonb;
begin
  select jsonb_build_object(
    'generated_at', now_at,
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('job', c.job, 'every', c.every,
        'last_run_at', r.last_run_at,
        -- A time in the future (written by hand) is not trusted: late.
        'late', r.last_run_at is null or r.last_run_at < now_at - c.late_after
          or r.last_run_at > clock_timestamp())
        order by c.ord), '[]'::jsonb)
      from internal.scheduled_job_catalogue() c
        left join private.scheduled_job_runs r on r.job = c.job),
    -- Unsent after the last of 8 attempts, or unsent a day after queuing.
    'emails', (select jsonb_build_object(
        'waiting', (select count(*) from private.outbox_events o where o.processed_at is null),
        'stuck', (select count(*) from private.outbox_events o where o.processed_at is null
          and (o.delivery_attempts >= 8 or o.created_at < now_at - interval '1 day')),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind,
            'attempts', x.delivery_attempts, 'queued_at', x.created_at, 'last_error', x.delivery_error)
            order by x.created_at, x.id), '[]'::jsonb)
          from (select o.id, o.kind, o.delivery_attempts, o.created_at, o.delivery_error
              from private.outbox_events o where o.processed_at is null
                and (o.delivery_attempts >= 8 or o.created_at < now_at - interval '1 day')
              order by o.created_at, o.id limit 50) x))),
    -- Notices the notice job can still send (internal.claim_frontend_privacy_notice's
    -- own rule: the request is not minimised, and it was checked by hand, or
    -- belongs to an erased account, or its address is the account's confirmed
    -- one) are stuck after the last of 8 attempts or a day after queuing; the
    -- others can never be sent and are only counted.
    'notices', (with waiting as (
        select j.id, j.kind, j.attempts, j.created_at,
          r.minimised_at is null
            and (r.identity_check = 'manual'
              or exists(select 1 from private.account_erasure_requests l where l.request_id = r.id)
              or exists(select 1 from auth.users u where u.id = r.subject_user_id
                and u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null
                and lower(u.email) = lower(r.requester_email))) as deliverable
        from private.privacy_notice_jobs j join private.privacy_requests r on r.id = j.request_id
        where j.delivered_at is null)
      select jsonb_build_object(
        'stuck', count(*) filter (where w.deliverable
          and (w.attempts >= 8 or w.created_at < now_at - interval '1 day')),
        'undeliverable', count(*) filter (where not w.deliverable),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'attempts', x.attempts,
            'queued_at', x.created_at) order by x.created_at, x.id), '[]'::jsonb)
          from (select w2.id, w2.kind, w2.attempts, w2.created_at from waiting w2
              where w2.deliverable and (w2.attempts >= 8 or w2.created_at < now_at - interval '1 day')
              order by w2.created_at, w2.id limit 50) x))
      from waiting w),
    'payments', (select jsonb_build_object(
        'problems', (select count(*) from private.payment_problems p
          where p.last_seen_at > now_at - interval '7 days'),
        'not_activated', (select count(*) from private.payments p
          where p.fulfillment_status = 'needs_reconciliation'),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'payment_ref', left(x.payment_id::text, 8), 'reason', x.reason, 'source', x.source,
            'first_seen_at', x.first_seen_at, 'last_seen_at', x.last_seen_at,
            'occurrences', x.occurrences, 'alerted', x.alerted_at is not null)
            order by x.last_seen_at desc, x.id), '[]'::jsonb)
          from (select p.* from private.payment_problems p where p.last_seen_at > now_at - interval '7 days'
              order by p.last_seen_at desc, p.id limit 50) x))),
    'deletions', (select jsonb_build_object(
        'accounts_blocked', (select count(*) from private.account_erasures e
          where e.erased_at is null and e.blocked_at is not null),
        'files_stuck', (select count(*) from private.media_objects m where m.state = 'cleanup_required'
            and m.state_changed_at < now_at - interval '1 day')
          + (select count(*) from private.evidence_artifacts a where a.state = 'cleanup_required'
            and a.state_changed_at < now_at - interval '1 day'),
        'files_queued', (select count(*) from private.media_objects m where m.state = 'cleanup_required')
          + (select count(*) from private.evidence_artifacts a where a.state = 'cleanup_required'),
        -- Due for deletion over a day ago (the cleanup claim's own rule) and
        -- not kept by a legal or fraud hold.
        'evidence_overdue', (select count(*) from private.evidence_artifacts a
          where a.state in ('uploaded', 'clean', 'rejected')
            and coalesce(a.retain_until, a.created_at + interval '90 days') < now_at - interval '1 day'
            and not exists(select 1 from private.legal_holds h where h.subject_id = a.owner_id
              and h.released_at is null)
            and not internal.evidence_fraud_held(a.case_id)),
        'legal_holds', (select count(distinct h.subject_id) from private.legal_holds h
          where h.released_at is null),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('reason', x.blocked_reason,
            'blocked_at', x.blocked_at, 'erase_after', x.erase_after, 'closed_by', x.closed_by)
            order by x.blocked_at, x.user_id), '[]'::jsonb)
          from (select e.user_id, e.blocked_reason, e.blocked_at, e.erase_after, e.closed_by
              from private.account_erasures e where e.erased_at is null and e.blocked_at is not null
              order by e.blocked_at, e.user_id limit 50) x))),
    'incidents', (select jsonb_build_object(
        'open', (select count(*) from private.cost_alarms a where a.acknowledged_at is null),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('metric', x.metric, 'level', x.level,
            'period', x.period, 'raised_at', x.raised_at) order by x.raised_at desc, x.id), '[]'::jsonb)
          from (select a.id, a.metric, a.level, a.period, a.raised_at from private.cost_alarms a
              where a.acknowledged_at is null order by a.raised_at desc, a.id limit 50) x))))
  into result;
  if internal.staff_actor('audit:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_operations_health() owner to postgres;
revoke all on function internal.get_staff_operations_health() from public,anon,authenticated,service_role;
grant execute on function internal.get_staff_operations_health() to authenticated;

CREATE OR REPLACE FUNCTION api.get_staff_operations_health()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_operations_health();
$function$;
alter function api.get_staff_operations_health() owner to postgres;
revoke all on function api.get_staff_operations_health() from public,anon,authenticated,service_role;
grant execute on function api.get_staff_operations_health() to authenticated;

notify pgrst,'reload schema';
commit;
