-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_closure_invalidation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.lock_verification_subject(new.user_id);
  update private.accepted_identity_facts set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where owner_id=new.user_id and revoked_at is null;
  return new;
end;
$function$;
alter function internal.verification_closure_invalidation() owner to postgres;
revoke all on function internal.verification_closure_invalidation() from public;
