-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verification_submission_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if old.number_erased_at is null and new.number_erased_at is not null
    and new.number_ciphertext is null and new.number_iv is null and new.number_tag is null
    and (new.id,new.case_id,new.owner_id,new.case_version,new.id_artifact_id,new.selfie_artifact_id,
      new.identity_hmac,new.identity_key_id,new.protocol,new.encryption_key_id,new.receipt_id,new.recipe,
      new.risk_score,new.created_at)
    is not distinct from (old.id,old.case_id,old.owner_id,old.case_version,old.id_artifact_id,old.selfie_artifact_id,
      old.identity_hmac,old.identity_key_id,old.protocol,old.encryption_key_id,old.receipt_id,old.recipe,
      old.risk_score,old.created_at) then
    return new;
  end if;
  raise exception 'verification submission is immutable; replace with a new receipt' using errcode='23514';
end;
$function$;
alter function internal.verification_submission_immutable() owner to postgres;
revoke all on function internal.verification_submission_immutable() from public;
