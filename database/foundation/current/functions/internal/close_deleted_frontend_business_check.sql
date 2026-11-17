-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_deleted_frontend_business_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.lock_verification_subject(old.owner_id);
  update private.evidence_cases set status='closed',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1
    where id=old.id and status='open';
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),clock_timestamp()+interval '30 days')
    where case_id=old.id and state='clean';
  return old;
end$function$;
alter function internal.close_deleted_frontend_business_check() owner to postgres;
revoke all on function internal.close_deleted_frontend_business_check() from public;
