-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_queue_claim(p_claim private.queue_claims, p_actor uuid, p_generation text, p_nonce uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_generation is null or p_generation !~ '^[1-9][0-9]{0,18}$' or p_nonce is null then
    raise exception 'current claim generation and nonce required' using errcode = '22023';
  end if;
  if p_claim.id is null or p_claim.claimed_by is distinct from p_actor
    or p_claim.claim_generation::text is distinct from p_generation or p_claim.claim_nonce is distinct from p_nonce
    or p_claim.claim_expires_at is null or p_claim.claim_expires_at <= clock_timestamp() then
    raise exception 'current live queue claim required' using errcode = '42501';
  end if;
end;
$function$;
alter function internal.assert_queue_claim(private.queue_claims,uuid,text,uuid) owner to postgres;
revoke all on function internal.assert_queue_claim(private.queue_claims,uuid,text,uuid) from public;
