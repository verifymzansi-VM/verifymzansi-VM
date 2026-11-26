-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_privacy_requests(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare minimised integer; purged integer;
begin
  with closed as (
    select r.id, coalesce(r.completed_at,
        (select max(e.occurred_at) from private.privacy_request_events e where e.request_id = r.id),
        r.created_at) as closed_at
    from private.privacy_requests r
    where r.status in ('completed', 'rejected') and r.minimised_at is null
  ), due as (
    select c.id from closed c
    where c.closed_at < statement_timestamp() - interval '30 days'
      or not exists (select 1 from private.privacy_notice_jobs j where j.request_id = c.id and j.delivered_at is null)
    order by c.closed_at limit p_limit
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
      -- The minimised proof of a closed request: 3 years.
      and coalesce(x.completed_at, x.minimised_at) < statement_timestamp() - interval '3 years'
    order by x.minimised_at limit p_limit for update skip locked);
  get diagnostics purged = row_count;
  return jsonb_build_object('minimised', minimised, 'purged', purged);
end;
$function$;
alter function internal.retention_privacy_requests(integer) owner to postgres;
revoke all on function internal.retention_privacy_requests(integer) from public;
