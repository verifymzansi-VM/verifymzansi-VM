-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.scrub_frontend_verification_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$begin
  if new.state='deleted' then update private.frontend_verification_uploads set fingerprint=null,encrypted_number=null,
    capture_method=null,browser_liveness_passed=null where artifact_id=new.id; end if;
  return new;
end$function$;
alter function internal.scrub_frontend_verification_receipt() owner to postgres;
revoke all on function internal.scrub_frontend_verification_receipt() from public;
