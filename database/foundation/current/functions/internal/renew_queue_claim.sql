-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.renew_queue_claim(p_subject text, p_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('queue:claim'); s record; c private.queue_claims;
begin
  -- Renewals can turn an apparently expired committed claim into a live one.
  -- Serialize that capacity change with acquisition and reassignment, before
  -- taking subject/claim row locks, including when renewal later rolls back.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1201));
  select * into s from internal.lock_queue_subject(p_subject, p_id);
  c := internal.lock_queue_claim(s.post_id, s.report_id);
  actor := internal.staff_actor('queue:claim');
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  if c.renewals >= 4 then
    raise exception 'renewal limit reached; claim the item again after it expires' using errcode = 'PT409';
  end if;
  update private.queue_claims set claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = renewals + 1
  where id = c.id returning * into c;
  return internal.queue_claim_view(c);
end;
$function$;
alter function internal.renew_queue_claim(text,uuid,text,uuid) owner to postgres;
revoke all on function internal.renew_queue_claim(text,uuid,text,uuid) from public;
grant execute on function internal.renew_queue_claim(text,uuid,text,uuid) to authenticated;
