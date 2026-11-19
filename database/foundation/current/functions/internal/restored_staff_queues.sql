-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.restored_staff_queues()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view'); reports jsonb; kyc jsonb; content jsonb; business jsonb;
begin
  select jsonb_build_object('open',count(*),'oldest_at',min(r.created_at),
    'breached',count(*) filter(where r.created_at<statement_timestamp()-case when r.severity='high' then interval '4 hours' else interval '24 hours' end),
    'claimed',(select count(*) from private.queue_claims q join private.reports r2 on r2.id=q.report_id
      where r2.status='open' and q.claim_expires_at>statement_timestamp())) into reports
    from private.reports r where r.status='open';
  -- ID checks: only cases the queue lists (internal.get_frontend_staff_verification_queue):
  -- open, a current submission at the case's version, an active account.
  select jsonb_build_object('pending',count(*),'oldest_at',min(s.created_at),
    'high_risk',count(*) filter(where s.risk_score>50),
    'claimed',count(*) filter(where e.claim_expires_at>statement_timestamp())) into kyc
    from private.evidence_cases e
      join private.verification_current_submissions v on v.case_id=e.id
      join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=e.version
      where e.kind='kyc' and e.status='open' and e.subject_id<>actor
        and exists(select 1 from private.profiles p where p.account_id=e.subject_id)
        and exists(select 1 from private.current_account_access u where u.id=e.subject_id);
  select jsonb_build_object('pending',count(*),'oldest_at',min(p.submitted_at),
    'claimed',(select count(*) from private.queue_claims q join private.posts p2 on p2.id=q.post_id
      where p2.status='pending_moderation' and q.claim_expires_at>statement_timestamp())) into content
    from private.posts p where p.status='pending_moderation';
  select jsonb_build_object('pending',count(*),'oldest_at',min(e.created_at),
    'breached',count(*) filter(where e.created_at<statement_timestamp()-interval '24 hours'),
    'claimed',count(*) filter(where e.claim_expires_at>statement_timestamp())) into business
    from private.evidence_cases e where e.kind='business' and e.status='open';
  return jsonb_build_object('restored_queues',jsonb_build_object(
    'reports',reports,'kyc',kyc,'content',content,'business_kyc',business,'support',null));
end;
$function$;
alter function internal.restored_staff_queues() owner to postgres;
revoke all on function internal.restored_staff_queues() from public;
