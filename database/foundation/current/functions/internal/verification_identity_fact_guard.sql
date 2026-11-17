-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_identity_fact_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.owner_id,new.submission_id,new.identity_hmac,new.reviewed_by,new.second_reviewer,new.decision_id,new.reviewed_at)
    is distinct from (old.id,old.owner_id,old.submission_id,old.identity_hmac,old.reviewed_by,old.second_reviewer,old.decision_id,old.reviewed_at)
    or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'accepted identity facts are immutable except first revocation' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.verification_identity_fact_guard() owner to postgres;
revoke all on function internal.verification_identity_fact_guard() from public;
