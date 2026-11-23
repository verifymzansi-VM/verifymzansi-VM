-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
        -- Only the last 30 days: retention minimises a closed request after
        -- 30 days, while its notice rows stay for years.
        'undeliverable', count(*) filter (where not w.deliverable
          and w.created_at >= now_at - interval '30 days'),
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
        -- Due for deletion over a day ago (the cleanup claim's own rule: a
        -- selfie whose identity record is kept is not due) and not kept by a
        -- legal or fraud hold.
        'evidence_overdue', (select count(*) from private.evidence_artifacts a
          where a.state in ('uploaded', 'clean', 'rejected')
            and coalesce(a.retain_until, a.created_at + interval '90 days') < now_at - interval '1 day'
            and not exists(select 1 from private.verification_identity_submissions s
              where s.selfie_artifact_id = a.id and internal.identity_record_kept(s.id))
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
revoke all on function internal.get_staff_operations_health() from public;
grant execute on function internal.get_staff_operations_health() to authenticated;
