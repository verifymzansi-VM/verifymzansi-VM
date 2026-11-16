-- A phone number another account has verified is refused before any SMS.
--
-- Until now internal.create_verification_phone_challenge stored a challenge
-- for any valid number, and the website then paid for the SMS. Only at the
-- last step, when the member had typed the code, did
-- internal.finalize_verification_phone hit the unique index on active phone
-- proofs (verification_phone_unique_active_idx) and refuse: the member was told
-- the number was linked to another account after the SMS had been sent.
--
-- From this update, internal.create_verification_phone_challenge (same
-- signature, grants and owner) refuses with PT409 'phone number in use' when
-- another account holds an active proof for the number, before it stores a
-- challenge or expires the caller's pending one. The website then sends no SMS
-- and says at once that the number is linked to another account.
-- - The member's own active proof for the same number is not a refusal (a
--   member may prove their own number again).
-- - It is a check, not a lock: two accounts that both start on a free number
--   can still each get a code, and the unique index at finalization stays the
--   authority, as before.
-- - It tells a signed-in member with a confirmed email whether a number is
--   verified on some other account (never which one) without holding the
--   phone; before, only someone who received the code learned it. That is the
--   price of not paying for an SMS that can never succeed, and the source
--   backend answered the same way. Every request to send counts against the
--   website's SMS limits whether or not it is refused (per account 5 an hour
--   and 10 a day, per network 10 an hour and 30 a day), which bounds probing.
-- No API command changes signature, grant or owner. The website release before
-- this update shows its generic refusal for the new PT409 (still no SMS); the
-- release with it says the number is linked to another account.
--
-- ORDER: any time. Read-only preflight:
-- ../preflight/20261116194000_phone_in_use_before_sms.check.sql.
-- Rollback: ../rollback/20261116194000_phone_in_use_before_sms.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the function is the reviewed body, or already this update's.
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is null
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      not in('3b433478c2e7b15b7889ba5d16e026ad','e0329c5c47cfca2a502467e6430acdad') then
    raise exception 'phone challenge drift: internal.create_verification_phone_challenge is not the reviewed body' using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.create_verification_phone_challenge(p_owner uuid, p_phone text, p_hash text)
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
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_hash is null or length(p_hash) not between 16 and 512 then
    raise exception 'valid phone challenge required' using errcode='22023'; end if;
  -- Refuse a number another account has proved before any SMS is paid for.
  -- Finalization's unique index stays the authority for concurrent attempts.
  if exists(select 1 from private.verification_phone_proofs f
      where f.phone=p_phone and f.revoked_at is null and f.owner_id<>p_owner) then
    raise exception 'phone number in use' using errcode='PT409'; end if;
  -- New delivery invalidates older pending challenges for this subject.
  update private.verification_phone_challenges set expires_at=greatest(created_at+interval '1 microsecond',clock_timestamp())
    where owner_id=p_owner and verified_at is null and expires_at>clock_timestamp();
  insert into private.verification_phone_challenges(owner_id,phone,otp_hash) values(p_owner,p_phone,p_hash) returning * into challenge;
  return jsonb_build_object('challenge_id',challenge.id,'expires_at',challenge.expires_at);
end;
$function$;
alter function internal.create_verification_phone_challenge(uuid,text,text) owner to postgres;
revoke all on function internal.create_verification_phone_challenge(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.create_verification_phone_challenge(uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
