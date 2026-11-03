-- Additive DTO for the selected staff home. Keep every native field and every
-- existing command grant. Source-only queues stay explicitly unavailable.
begin;
do $migration$
declare body text; marker text := E'  -- Selected frontend queue presentation, from canonical private records.\n  return internal.restored_staff_queues() ||';
begin
  select prosrc into strict body from pg_proc where oid='internal.staff_dashboard_overview()'::regprocedure;
  if position(marker in body)>0 then
    if md5(replace(body,marker,'  return'))<>'1ec2fe375431a1787f44f4d313511178' then
      raise exception 'Unknown updated staff dashboard function'; end if;
    return;
  end if;
  if md5(body)<>'1ec2fe375431a1787f44f4d313511178' then
    raise exception 'Unknown staff dashboard function'; end if;
  body:=replace(body,'  return jsonb_build_object(',marker||' jsonb_build_object(');
  execute format('create or replace function internal.staff_dashboard_overview() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',body);
end;
$migration$;

create or replace function internal.restored_staff_queues()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view'); reports jsonb; kyc jsonb; content jsonb; business jsonb;
begin
  select jsonb_build_object('open',count(*),'oldest_at',min(r.created_at),
    'breached',count(*) filter(where r.created_at<statement_timestamp()-case when r.severity='high' then interval '4 hours' else interval '24 hours' end),
    'claimed',(select count(*) from private.queue_claims q join private.reports r2 on r2.id=q.report_id
      where r2.status='open' and q.claim_expires_at>statement_timestamp())) into reports
    from private.reports r where r.status='open';
  select jsonb_build_object('pending',count(*),'oldest_at',min(e.created_at),
    'high_risk',count(*) filter(where exists(select 1 from private.verification_current_submissions c
      join private.verification_identity_submissions s on s.id=c.submission_id
      where s.case_id=e.id and s.risk_score>50)),
    'claimed',count(*) filter(where e.claim_expires_at>statement_timestamp())) into kyc
    from private.evidence_cases e where e.kind='kyc' and e.status='open';
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
$$;
revoke all on function internal.restored_staff_queues() from public,anon,authenticated,service_role;
commit;
