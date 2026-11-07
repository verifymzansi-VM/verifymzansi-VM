-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.grant_verified_intro_trial(p_owner uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare fingerprint text;
begin
  perform internal.lock_verification_subject(p_owner);
  fingerprint:=internal.current_verified_identity(p_owner);
  if fingerprint is null then raise exception 'current complete verification required' using errcode='42501'; end if;
  if exists(select 1 from private.trial_identities t where t.owner_id=p_owner and t.identity_hmac<>fingerprint) then
    return jsonb_build_object('granted',false,'reason','account_already_used'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,2701));
  if internal.current_verified_identity(p_owner) is distinct from fingerprint then
    raise exception 'verification changed' using errcode='42501'; end if;
  return internal.grant_intro_trial(p_owner,fingerprint,p_days);
end;
$function$;
alter function internal.grant_verified_intro_trial(uuid,integer) owner to postgres;
revoke all on function internal.grant_verified_intro_trial(uuid,integer) from public;
grant execute on function internal.grant_verified_intro_trial(uuid,integer) to service_role;
