-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_operations(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare auth_audit integer; outbox integer; drafts integer; invites integer; applications integer;
  notes integer; events integer; tickets integer; owner_invites integer; flag_events integer; mode_events integer;
begin
  delete from auth.audit_log_entries where id in(select a.id from auth.audit_log_entries a
    where a.created_at<statement_timestamp()-interval '30 days' order by a.created_at limit p_limit);
  get diagnostics auth_audit=row_count;
  delete from private.outbox_events where id in(select o.id from private.outbox_events o
    where o.processed_at<statement_timestamp()-interval '30 days' order by o.processed_at limit p_limit for update skip locked);
  get diagnostics outbox=row_count;
  delete from private.listing_price_drafts where owner_id in(select d.owner_id from private.listing_price_drafts d
    where d.expires_at<=statement_timestamp() order by d.expires_at limit p_limit for update skip locked);
  get diagnostics drafts=row_count;
  delete from private.organisation_invites where id in(select i.id from private.organisation_invites i
    where coalesce(i.accepted_at,i.revoked_at,i.expires_at)<statement_timestamp()-interval '30 days'
    order by i.created_at limit p_limit for update skip locked);
  get diagnostics invites=row_count;
  delete from private.organisation_applications where id in(select a.id from private.organisation_applications a
    where a.status in('approved','declined','withdrawn')
      and coalesce(a.decision_at,a.updated_at)<statement_timestamp()-interval '2 years'
    order by a.updated_at limit p_limit for update skip locked);
  get diagnostics applications=row_count;
  delete from private.organisation_notes where id in(select n.id from private.organisation_notes n
    where n.created_at<statement_timestamp()-interval '2 years' order by n.created_at limit p_limit);
  get diagnostics notes=row_count;
  delete from private.organisation_events where id in(select e.id from private.organisation_events e
    where e.created_at<statement_timestamp()-interval '2 years' order by e.created_at limit p_limit);
  get diagnostics events=row_count;
  -- Contact-form messages: 12 months after they were resolved (their last
  -- 'resolved' status, or when they arrived if none). Open ones stay in the
  -- staff inbox until resolved.
  delete from private.support_tickets where id in(select t.id from private.support_tickets t
    where t.status='resolved'
      and coalesce((select max(e.created_at) from private.support_ticket_events e
        where e.ticket_id=t.id and e.status='resolved'),t.created_at)<statement_timestamp()-interval '12 months'
    order by t.created_at limit p_limit for update skip locked);
  get diagnostics tickets=row_count;
  -- Owner administrator invitations: 12 months after they were revoked. A
  -- claimed one is the owner's approval of that administrator, so it stays
  -- until 12 months after the claimant's account was erased.
  delete from private.owner_admin_invitations where email in(select i.email from private.owner_admin_invitations i
    where i.revoked_at<statement_timestamp()-interval '12 months'
      or exists(select 1 from private.account_erasures e where e.user_id=i.claimed_by
        and e.erased_at<statement_timestamp()-interval '12 months')
    order by i.created_at limit p_limit for update skip locked);
  get diagnostics owner_invites=row_count;
  -- Change logs of the runtime switches and the sign-up mode: 5 years.
  delete from private.frontend_feature_flag_events where id in(select e.id from private.frontend_feature_flag_events e
    where e.created_at<statement_timestamp()-interval '5 years' order by e.created_at limit p_limit);
  get diagnostics flag_events=row_count;
  delete from private.signup_mode_events where id in(select e.id from private.signup_mode_events e
    where e.changed_at<statement_timestamp()-interval '5 years' order by e.changed_at limit p_limit);
  get diagnostics mode_events=row_count;
  return jsonb_build_object('auth_audit_log',auth_audit,'outbox_events',outbox,'listing_price_drafts',drafts,
    'organisation_invites',invites,'organisation_applications',applications,'organisation_notes',notes,
    'organisation_events',events,'support_tickets',tickets,'owner_admin_invitations',owner_invites,
    'feature_flag_events',flag_events,'signup_mode_events',mode_events);
end;
$function$;
alter function internal.retention_operations(integer) owner to postgres;
revoke all on function internal.retention_operations(integer) from public;
