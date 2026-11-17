-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_queue_item(p_subject text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  actor := internal.staff_actor('queue:claim'); -- authority after any lock wait
  if internal.queue_conflict(actor, s.post_id, s.report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  if (select count(*) from private.queue_claims q where q.claimed_by = actor and q.claim_expires_at > clock_timestamp()
      and not (q.post_id is not distinct from s.post_id and q.report_id is not distinct from s.report_id)) >= 20 then
    raise exception 'claim limit of 20 items reached' using errcode = 'PT429';
  end if;
  c := internal.take_queue_claim(actor, s.post_id, s.report_id);
  if c.id is null then raise exception 'item claimed by another reviewer' using errcode = 'PT409'; end if;
  perform internal.staff_actor('queue:claim'); -- authority after the claim-row wait
  return internal.queue_claim_view(c);
end;
$function$;
alter function internal.claim_queue_item(text,uuid) owner to postgres;
revoke all on function internal.claim_queue_item(text,uuid) from public;
grant execute on function internal.claim_queue_item(text,uuid) to authenticated;
