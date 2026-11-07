-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_queue_items(p_queue text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:claim'); allowed integer; r record;
  c private.queue_claims; items jsonb := '[]'::jsonb;
begin
  if p_queue is null or p_queue not in ('content', 'reports') then
    raise exception 'unknown queue' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'claim between 1 and 25 items' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  actor := internal.staff_actor('queue:claim'); -- authority after the holder guard wait
  allowed := least(p_limit, 20 - (select count(*) from private.queue_claims q
    where q.claimed_by = actor and q.claim_expires_at > clock_timestamp())::integer);
  if allowed <= 0 then return items; end if;
  -- Scan with headroom: a row another claimer committed after this scan began
  -- is skipped by take_queue_claim, and the next row takes its place.
  if p_queue = 'content' then
    for r in
      select p.id from private.posts p
      where p.status = 'pending_moderation' and p.owner_id <> actor
        and not exists (select 1 from private.queue_claims q where q.post_id = p.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by p.submitted_at, p.id limit allowed * 2
      for update of p skip locked
    loop
      c := internal.take_queue_claim(actor, r.id, null);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  else
    for r in
      select x.id from private.reports x
      where x.status = 'open' and not internal.current_report_proposal(x.active_proposal_id) and not internal.queue_conflict(actor,null,x.id)
        and not exists (select 1 from private.queue_claims q where q.report_id = x.id
          and q.claimed_by is not null and q.claim_expires_at > clock_timestamp())
      order by (x.severity = 'high') desc, x.created_at, x.id limit allowed * 2
      for update of x skip locked
    loop
      c := internal.take_queue_claim(actor, null, r.id);
      if c.id is not null then items := items || jsonb_build_array(internal.queue_claim_view(c)); end if;
      exit when jsonb_array_length(items) >= allowed;
    end loop;
  end if;
  perform internal.staff_actor('queue:claim'); -- authority after any claim-row wait
  return items;
end;
$function$;
alter function internal.claim_queue_items(text,integer) owner to postgres;
revoke all on function internal.claim_queue_items(text,integer) from public;
grant execute on function internal.claim_queue_items(text,integer) to authenticated;
