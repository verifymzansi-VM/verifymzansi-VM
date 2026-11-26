-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_staff_records(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare access_log integer; decisions integer; moderation integer; queue_events integer; reports integer;
  restriction_cases integer:=0; fraud_holds integer; roles integer; holds integer; candidate record; due uuid[];
  appeals integer; content_holds integer; role_changes integer; claim_events integer; slot_limits integer;
begin
  delete from private.evidence_access_log where id in(select l.id from private.evidence_access_log l
    where l.accessed_at<statement_timestamp()-interval '2 years' order by l.accessed_at limit p_limit);
  get diagnostics access_log=row_count;

  select coalesce(array_agg(x.id),'{}') into due from (select d.id from private.decisions d
    where d.status<>'proposed' and coalesce(d.approved_at,d.withdrawn_at)<statement_timestamp()-interval '2 years'
      and not (d.status='approved' and d.action='restrict_account')
      and not exists(select 1 from private.accepted_identity_facts f where f.decision_id=d.id)
      and not exists(select 1 from private.identity_ban_bindings b where b.decision_id=d.id)
      and not exists(select 1 from private.banned_identities b where b.decision_id=d.id)
    order by coalesce(d.approved_at,d.withdrawn_at) limit p_limit for update skip locked) x;
  delete from private.identity_review_proposals where decision_id=any(due);
  delete from private.identity_ban_proposal_requests where decision_id=any(due);
  delete from private.decisions where id=any(due);
  get diagnostics decisions=row_count;

  delete from private.moderation_log where id in(select m.id from private.moderation_log m
    where m.decided_at<statement_timestamp()-interval '2 years' order by m.decided_at limit p_limit);
  get diagnostics moderation=row_count;
  delete from private.queue_claim_events where id in(select e.id from private.queue_claim_events e
    where e.created_at<statement_timestamp()-interval '2 years' order by e.created_at limit p_limit);
  get diagnostics queue_events=row_count;
  delete from private.reports where id in(select r.id from private.reports r
    where r.status<>'open' and r.resolved_at<statement_timestamp()-interval '2 years'
      -- Never while an appeal against a warning it gave still waits.
      and not exists(select 1 from private.frontend_report_action_receipts c join private.frontend_appeals a on a.action_id=c.id
        where c.report_id=r.id and a.status='submitted')
    order by r.resolved_at limit p_limit for update skip locked);
  get diagnostics reports=row_count;

  -- Restriction cases opened only to browse identity history, never decided.
  for candidate in
    select c.id,c.subject_id from private.evidence_cases c
    where c.kind='restriction' and c.created_at<statement_timestamp()-interval '2 years'
      and (c.claim_expires_at is null or c.claim_expires_at<=clock_timestamp())
      and not exists(select 1 from private.decisions d where d.case_id=c.id)
      and not exists(select 1 from private.evidence_access_log l where l.case_id=c.id)
      and not exists(select 1 from private.evidence_artifacts a where a.case_id=c.id)
      and not exists(select 1 from private.evidence_fraud_holds h where h.case_id=c.id)
    order by c.created_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.subject_id::text,2408)) then continue; end if;
    delete from private.evidence_cases c where c.id=candidate.id
      and not exists(select 1 from private.decisions d where d.case_id=c.id)
      and not exists(select 1 from private.evidence_access_log l where l.case_id=c.id);
    restriction_cases:=restriction_cases+1;
  end loop;

  delete from private.evidence_fraud_holds where id in(select h.id from private.evidence_fraud_holds h
    where h.closed_at<statement_timestamp()-interval '2 years' order by h.closed_at limit p_limit for update skip locked);
  get diagnostics fraud_holds=row_count;
  delete from private.staff_roles where id in(select r.id from private.staff_roles r
    where r.revoked_at<statement_timestamp()-interval '5 years' order by r.revoked_at limit p_limit for update skip locked);
  get diagnostics roles=row_count;
  delete from private.legal_holds where id in(select h.id from private.legal_holds h
    where h.released_at<statement_timestamp()-interval '5 years' order by h.released_at limit p_limit for update skip locked);
  get diagnostics holds=row_count;
  -- Decided appeals: 2 years, like reports, once the decision appealed is
  -- gone (while it stands, its appeal stops a second one). Released content
  -- holds: 2 years, never while an appeal against them waits.
  delete from private.frontend_appeals where id in(select a.id from private.frontend_appeals a
    where a.resolved_at<statement_timestamp()-interval '2 years'
      and not exists(select 1 from private.frontend_appealable_actions x where x.id=a.action_id)
    order by a.resolved_at limit p_limit for update skip locked);
  get diagnostics appeals=row_count;
  delete from private.frontend_content_holds where id in(select h.id from private.frontend_content_holds h
    where h.released_at<statement_timestamp()-interval '2 years'
      and not exists(select 1 from private.frontend_appeals a where a.action_id=h.id and a.status='submitted')
    order by h.released_at limit p_limit for update skip locked);
  get diagnostics content_holds=row_count;
  -- Staff role change proposals: 5 years after they were decided or
  -- expired, like staff roles.
  delete from private.frontend_staff_role_changes where id in(select c.id from private.frontend_staff_role_changes c
    where coalesce(c.decided_at,c.expires_at)<statement_timestamp()-interval '5 years'
    order by c.created_at limit p_limit for update skip locked);
  get diagnostics role_changes=row_count;
  -- Evidence case claims: 2 years, like queue claims.
  delete from private.frontend_evidence_claim_events where id in(select e.id from private.frontend_evidence_claim_events e
    where e.created_at<statement_timestamp()-interval '2 years' order by e.created_at limit p_limit);
  get diagnostics claim_events=row_count;
  -- Raised slot limits: 2 years after they ended or were ended early.
  delete from private.individual_slot_limits where id in(select l.id from private.individual_slot_limits l
    where coalesce(l.revoked_at,l.ends_at)<statement_timestamp()-interval '2 years'
    order by l.ends_at limit p_limit for update skip locked);
  get diagnostics slot_limits=row_count;
  return jsonb_build_object('evidence_access_log',access_log,'decisions',decisions,'moderation_log',moderation,
    'queue_claim_events',queue_events,'reports',reports,'restriction_cases',restriction_cases,
    'fraud_holds',fraud_holds,'staff_roles',roles,'legal_holds',holds,'appeals',appeals,
    'content_holds',content_holds,'staff_role_changes',role_changes,'evidence_claim_events',claim_events,
    'slot_limits',slot_limits);
end;
$function$;
alter function internal.retention_staff_records(integer) owner to postgres;
revoke all on function internal.retention_staff_records(integer) from public;
