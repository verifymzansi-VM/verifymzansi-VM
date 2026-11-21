-- Reviewed rollback for updates/20261121100028_post_performance_stats.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix; to stop recording, switch
-- SHOW_ENGAGEMENT_TOTALS off instead.
--
-- It drops the three new commands (api.record_post_activity,
-- api.get_my_post_performance, api.purge_post_engagement), their internal
-- functions, the table private.post_activity_days and the column
-- private.post_engagement_totals.engaged_views, and puts back the earlier
-- bodies of the retention job, the engagement clean-up and the scheduled job
-- catalogue byte for byte (the retention job again runs the engagement
-- clean-up). Revert and deploy the website release first: the rollback
-- removes commands that release calls. It refuses (55000) unless every part of
-- the update is present with this update's bodies, and once any activity or
-- engaged view is recorded, since those cannot be restored.
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  if to_regclass('private.post_activity_days') is null
    or not exists(select 1 from pg_attribute a where a.attrelid = 'private.post_engagement_totals'::regclass
      and a.attname = 'engaged_views' and not a.attisdropped)
    or to_regprocedure('internal.record_post_activity(uuid[],text[],uuid,uuid)') is null
    or to_regprocedure('api.record_post_activity(uuid[],text[],uuid,uuid)') is null
    or to_regprocedure('internal.get_my_post_performance()') is null
    or to_regprocedure('api.get_my_post_performance()') is null
    or to_regprocedure('api.purge_post_engagement()') is null then
    raise exception 'rollback precondition: post performance stats are not fully present'
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.run_retention(integer)'), ('internal.purge_post_engagement()'),
      ('internal.scheduled_job_catalogue()')) v(sig)
  loop
    if shape not in (
        'internal.run_retention(integer) 135e5c77e403b724fdcd48844a994938',
        'internal.purge_post_engagement() bf66fca749e26139b57022aaaeb3d7bd',
        'internal.scheduled_job_catalogue() 64487ac2aa106de196e413992e126488') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from private.post_activity_days)
    or exists(select 1 from private.post_engagement_totals t where t.engaged_views > 0) then
    raise exception 'rollback precondition: activity or engaged views are recorded and would be lost'
      using errcode='55000';
  end if;
end$$;

drop function api.purge_post_engagement();
drop function api.get_my_post_performance();
drop function internal.get_my_post_performance();
drop function api.record_post_activity(uuid[],text[],uuid,uuid);
drop function internal.record_post_activity(uuid[],text[],uuid,uuid);
drop table private.post_activity_days;
alter table private.post_engagement_totals drop constraint post_engagement_totals_engaged_views_check;
alter table private.post_engagement_totals drop column engaged_views;
-- The job's run record goes with the job.
delete from private.scheduled_job_runs r where r.job = 'engagement_purge';

CREATE OR REPLACE FUNCTION internal.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  salts integer; marks integer := 0; batch integer; rounds integer := 0; released integer;
begin
  delete from private.post_view_salts s where s.day < today - 1;
  get diagnostics salts = row_count;
  loop
    delete from private.post_view_marks m where m.mark in (select x.mark from private.post_view_marks x
      where x.seen_at < statement_timestamp() - interval '24 hours' limit 10000);
    get diagnostics batch = row_count;
    marks := marks + batch;
    rounds := rounds + 1;
    exit when batch < 10000 or rounds >= 20;
  end loop;
  -- Posts in id order, each locked through its totals row, as the like command does.
  with due as (
    select l.post_id from private.post_likes l where l.waiting and l.counts_from <= statement_timestamp()
    group by l.post_id order by l.post_id limit 1000
  ), locked as (
    select t.post_id from private.post_engagement_totals t join due on due.post_id = t.post_id
    order by t.post_id for update of t
  )
  update private.post_likes l set waiting = false from locked
    where l.post_id = locked.post_id and l.waiting and l.counts_from <= statement_timestamp();
  get diagnostics released = row_count;
  return jsonb_build_object('salts', salts, 'marks', marks, 'likes_released', released);
end;
$function$;
alter function internal.purge_post_engagement() owner to postgres;
revoke all on function internal.purge_post_engagement() from public, anon, authenticated, service_role;

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

CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement(),
    'member_invitations',internal.purge_member_invitations(p_limit),
    'capture_handoffs',internal.purge_capture_handoffs(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

notify pgrst,'reload schema';
commit;
