-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_operations(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare auth_audit integer; outbox integer; drafts integer; invites integer; applications integer;
  notes integer; events integer;
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
  return jsonb_build_object('auth_audit_log',auth_audit,'outbox_events',outbox,'listing_price_drafts',drafts,
    'organisation_invites',invites,'organisation_applications',applications,'organisation_notes',notes,
    'organisation_events',events);
end;
$function$;
alter function internal.retention_operations(integer) owner to postgres;
revoke all on function internal.retention_operations(integer) from public;
