-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.consume_queue_claim(p_subject text, p_id uuid, p_actor uuid, p_generation text, p_nonce uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare c private.queue_claims;
begin
  c := internal.lock_queue_claim(case when p_subject = 'post' then p_id end, case when p_subject = 'report' then p_id end);
  perform internal.assert_queue_claim(c, p_actor, p_generation, p_nonce);
  update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
    claim_expires_at = null, renewals = 0
  where id = c.id;
end;
$function$;
alter function internal.consume_queue_claim(text,uuid,uuid,text,uuid) owner to postgres;
revoke all on function internal.consume_queue_claim(text,uuid,uuid,text,uuid) from public;
