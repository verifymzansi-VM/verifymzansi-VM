-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_privacy_requests(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare minimised integer; purged integer; cleared integer;
begin
  with due as (
    select r.id from private.privacy_requests r
      cross join lateral (select coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at) c
    where r.status in ('completed', 'rejected') and r.minimised_at is null
      and (c.closed_at < statement_timestamp() - interval '30 days'
        or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = r.id and j.delivered_at is null))
      -- Never while an access export may still be telling the member: an
      -- export in the last 24 hours, or its email still being tried.
      and not exists (select 1 from private.privacy_request_events e where e.request_id = r.id
        and e.action = 'exported' and e.occurred_at > statement_timestamp() - interval '24 hours')
      and not exists (select 1 from private.privacy_notice_jobs j where j.request_id = r.id
        and j.kind = 'exported' and j.delivered_at is null and j.attempts < 8)
    order by c.closed_at limit p_limit
    -- A request an export holds is left for the next run.
    for update of r skip locked
  )
  update private.privacy_requests r
    set requester_email = 'removed',
      requester_phone = 'not_provided', description = 'Removed after the request was closed.',
      minimised_at = statement_timestamp()
  from due where r.id = due.id;
  get diagnostics minimised = row_count;
  delete from private.privacy_requests r where r.id in (select x.id from private.privacy_requests x
    where x.minimised_at is not null
      -- Never while it explains an erasure that has not run (a rejection).
      and not exists (select 1 from private.account_erasure_requests l join private.account_erasures e on e.user_id = l.user_id
        where l.request_id = x.id and e.erased_at is null)
      and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '5 years'
    order by x.minimised_at limit p_limit for update skip locked);
  get diagnostics purged = row_count;
  -- The digest of a prepared access export that was never confirmed, a day
  -- after the export expired (15 minutes after it was prepared).
  update private.privacy_request_events e set export_digest = null
  where e.id in (select p.id from private.privacy_request_events p
    where p.action = 'export_prepared' and p.export_digest is not null
      and p.occurred_at < statement_timestamp() - interval '1 day 15 minutes'
      and not exists (select 1 from private.privacy_request_events x
        where x.export_id = p.export_id and x.action = 'exported')
    order by p.occurred_at limit p_limit);
  get diagnostics cleared = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged, 'export_digests_cleared', cleared);
end;
$function$;
alter function internal.retention_privacy_requests(integer) owner to postgres;
revoke all on function internal.retention_privacy_requests(integer) from public;
