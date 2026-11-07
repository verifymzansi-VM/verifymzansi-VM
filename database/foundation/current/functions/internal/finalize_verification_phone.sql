-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.finalize_verification_phone(p_owner uuid, p_challenge uuid, p_expected_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare challenge private.verification_phone_challenges; old_proof private.verification_phone_proofs; proof private.verification_phone_proofs;
begin
  perform internal.lock_verification_subject(p_owner);
  select * into challenge from private.verification_phone_challenges c where c.id=p_challenge and c.owner_id=p_owner for update;
  if not found or p_expected_hash is null or challenge.otp_hash<>p_expected_hash then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  select * into old_proof from private.verification_phone_proofs f where f.owner_id=p_owner and f.revoked_at is null for update;
  if challenge.verified_at is not null then
    if old_proof.challenge_id=challenge.id and old_proof.phone=challenge.phone then
      return jsonb_build_object('verified',true,'reused',true,'proof_id',old_proof.id); end if;
    raise exception 'proof was superseded' using errcode='PT409';
  end if;
  if challenge.expires_at<=clock_timestamp() or challenge.attempts not between 1 and 5 then
    raise exception 'challenge unavailable' using errcode='22023'; end if;
  if old_proof.id is not null and old_proof.phone<>challenge.phone and
    (old_proof.contact_changed_at+interval '15 days'>clock_timestamp() or internal.current_verified_identity(p_owner) is null) then
    raise exception 'contact change not eligible' using errcode='PT409'; end if;
  update private.verification_phone_proofs set revoked_at=clock_timestamp() where id=old_proof.id;
  insert into private.verification_phone_proofs(owner_id,challenge_id,phone,contact_changed_at)
    values(p_owner,challenge.id,challenge.phone,case when old_proof.phone=challenge.phone then old_proof.contact_changed_at else clock_timestamp() end) returning * into proof;
  update private.verification_phone_challenges set verified_at=proof.verified_at where id=challenge.id;
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('verification_phone_confirmed',proof.id,p_owner,'verification_phone_confirmed:'||proof.id);
  return jsonb_build_object('verified',true,'reused',false,'proof_id',proof.id);
end;
$function$;
alter function internal.finalize_verification_phone(uuid,uuid,text) owner to postgres;
revoke all on function internal.finalize_verification_phone(uuid,uuid,text) from public;
grant execute on function internal.finalize_verification_phone(uuid,uuid,text) to service_role;
