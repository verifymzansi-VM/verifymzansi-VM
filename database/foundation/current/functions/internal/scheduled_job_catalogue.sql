-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
    (17, 'refund_check', 'day', interval '26 hours'),
    (18, 'engagement_purge', 'minute', interval '10 minutes')
  ) v(ord, job, every, late_after)
$function$;
alter function internal.scheduled_job_catalogue() owner to postgres;
revoke all on function internal.scheduled_job_catalogue() from public;
