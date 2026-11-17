-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_verification_phone_attempt(p_owner uuid, p_challenge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare challenge private.verification_phone_challenges;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  update private.verification_phone_challenges set attempts=attempts+1
    where id=p_challenge and owner_id=p_owner and verified_at is null and expires_at>clock_timestamp() and attempts<5 returning * into challenge;
  if not found then raise exception 'challenge unavailable' using errcode='PT409'; end if;
  -- Trusted OTP adapter only. Never return the stored hash to a member/browser.
  return jsonb_build_object('challenge_id',challenge.id,'phone',challenge.phone,'otp_hash',challenge.otp_hash);
end;
$function$;
alter function internal.claim_verification_phone_attempt(uuid,uuid) owner to postgres;
revoke all on function internal.claim_verification_phone_attempt(uuid,uuid) from public;
grant execute on function internal.claim_verification_phone_attempt(uuid,uuid) to service_role;
