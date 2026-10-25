-- Staff overview for the production foundation UI. No actor selector or
-- browser/service table grants; the live caller and TOTP policy are mandatory.
create function internal.staff_dashboard_overview()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view'); staff_role text; claims jsonb;
begin
  select r.role into strict staff_role from private.staff_roles r
    where r.user_id=actor and r.revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'subject_id',c.subject_id,'kind',c.kind,'expires_at',c.expires_at)
    order by c.expires_at,c.subject_id),'[]'::jsonb) into claims
  from (
    select coalesce(q.post_id,q.report_id) as subject_id,
      case when q.post_id is not null then 'content' else 'report' end as kind,
      q.claim_expires_at as expires_at
    from private.queue_claims q where q.claimed_by=actor and q.claim_expires_at>statement_timestamp()
    union all
    select e.id,'identity',e.claim_expires_at from private.evidence_cases e
      where e.claimed_by=actor and e.claim_expires_at>statement_timestamp()
    order by expires_at,subject_id limit 40
  ) c;
  return jsonb_build_object(
    'version',1,'role',staff_role,'generated_at',statement_timestamp(),
    'counts',jsonb_build_object(
      'reports',(select count(*) from private.reports r where r.status='open'),
      'content',(select count(*) from private.posts p where p.status='pending_moderation'),
      'kyc',(select count(*) from private.evidence_cases e where e.status='open' and e.kind='kyc'),
      'business_kyc',(select count(*) from private.evidence_cases e where e.status='open' and e.kind='business'),
      'decisions',(select count(*) from private.decisions d where d.status='proposed')),
    'claims',claims,
    'platform',case when staff_role='admin' then jsonb_build_object(
      'jobs_waiting',(select count(*) from private.outbox_events o where o.processed_at is null),
      'cost_alarms',(select count(*) from private.cost_alarms a where a.acknowledged_at is null),
      'active_staff',(select count(*) from private.staff_roles r where r.revoked_at is null)) else null end
  );
end;
$$;
revoke all on function internal.staff_dashboard_overview() from public,anon,authenticated,service_role;
grant execute on function internal.staff_dashboard_overview() to authenticated;
create function api.get_staff_dashboard()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.staff_dashboard_overview();
$$;
revoke all on function api.get_staff_dashboard() from public,anon,authenticated,service_role;
grant execute on function api.get_staff_dashboard() to authenticated;
