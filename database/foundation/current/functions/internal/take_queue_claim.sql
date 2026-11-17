-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.take_queue_claim(p_actor uuid, p_post_id uuid, p_report_id uuid)
 RETURNS private.queue_claims
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare c private.queue_claims;
begin
  if p_post_id is not null then
    insert into private.queue_claims (post_id) values (p_post_id) on conflict (post_id) do nothing;
  else
    insert into private.queue_claims (report_id) values (p_report_id) on conflict (report_id) do nothing;
  end if;
  c := internal.lock_queue_claim(p_post_id, p_report_id);
  if c.claimed_by is not null and c.claim_expires_at > clock_timestamp() then
    if c.claimed_by <> p_actor then return null; end if;
    -- The holder may rotate the tuple; the lease and renewals stay as they are.
    update private.queue_claims set claim_generation = claim_generation + 1, claim_nonce = pg_catalog.gen_random_uuid()
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  else
    update private.queue_claims set claimed_by = p_actor, claim_generation = claim_generation + 1,
      claim_nonce = pg_catalog.gen_random_uuid(), claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '15 minutes', renewals = 0
    where id = c.id and claim_generation < 9223372036854775807 returning * into c;
  end if;
  if c.id is null then raise exception 'claim generation exhausted' using errcode = 'PT409'; end if;
  return c;
end;
$function$;
alter function internal.take_queue_claim(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.take_queue_claim(uuid,uuid,uuid) from public;
