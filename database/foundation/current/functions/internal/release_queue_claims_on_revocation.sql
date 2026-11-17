-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_queue_claims_on_revocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.revoked_at is not null or not exists (select 1 from private.staff_capabilities c
      where c.role = new.role and c.capability = 'queue:claim') then
    update private.queue_claims set claimed_by = null, claim_nonce = null, claimed_at = null,
      claim_expires_at = null, renewals = 0
    where claimed_by = new.user_id;
  end if;
  return null;
end;
$function$;
alter function internal.release_queue_claims_on_revocation() owner to postgres;
revoke all on function internal.release_queue_claims_on_revocation() from public;
