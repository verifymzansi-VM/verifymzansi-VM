-- A phone code is sent only when the number can actually be verified.
--
-- Until now internal.create_verification_phone_challenge stored a challenge
-- for any valid number, and the website then paid for the SMS. Only at the
-- last step, when the member had typed the code, did
-- internal.finalize_verification_phone refuse a number it could never accept:
-- one another account holds (the unique index on active phone proofs,
-- verification_phone_unique_active_idx), or a change of number within 15 days
-- of the last change or without a current verified identity. A member could
-- also ask for a code to the number already verified on their own account.
-- Each of those SMS messages was paid for and gained nothing.
--
-- From this update, internal.create_verification_phone_challenge (same
-- signature, grants and owner) refuses, before it stores a challenge or expires
-- the member's open one, with PT409 and a listed reason (the `detail`):
-- 1. phone_already_verified: the number is the member's own active proof.
--    Nothing needs proving: no rule asks for a recent proof.
-- 2. phone_change_cooldown: the member has another active number, changed less
--    than 15 days ago. The `hint` is the UTC time from which a change is
--    allowed (YYYY-MM-DDTHH:MI:SSZ), for the member's message.
-- 3. phone_change_identity_required: the member has another active number and
--    no current verified identity (internal.current_verified_identity).
-- 4. phone_in_use: another account holds an active proof for the number.
-- 2 and 3 are the conditions finalization already applies, checked in the same
-- way; they come before 4, so a member who may not change their number learns
-- nothing about anyone else's. Finalization keeps every check and stays the
-- authority: two accounts that start on a free number at the same moment can
-- still each get a code, and its unique index accepts only one.
--
-- Reason 4 tells a signed-in member with a confirmed email whether a number is
-- verified on some other account (never which one) without holding the phone;
-- before, only someone who received the code learned it. That is the price of
-- not paying for an SMS that can never succeed, and the source backend answered
-- the same way. Every request to send counts against the website's SMS limits
-- whether or not it is refused (per account 5 an hour and 10 a day, per network
-- 10 an hour and 30 a day), which bounds probing.
--
-- No API command changes signature, grant or owner. The website release before
-- this update shows its generic refusal for the new PT409 (still no SMS); the
-- release with it shows the message for each reason.
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
      not in('3b433478c2e7b15b7889ba5d16e026ad','6bd315ea00157c1caf6655ed17a079be') then
    raise exception 'phone challenge drift: internal.create_verification_phone_challenge is not the reviewed body' using errcode='55000';
  end if;
end$$;

CREATE OR REPLACE FUNCTION internal.create_verification_phone_challenge(p_owner uuid, p_phone text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare challenge private.verification_phone_challenges; held private.verification_phone_proofs;
begin
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active subject required' using errcode='42501'; end if;
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_hash is null or length(p_hash) not between 16 and 512 then
    raise exception 'valid phone challenge required' using errcode='22023'; end if;
  -- Refuse, before any SMS is paid for, what finalization would refuse or
  -- would not need. Finalization keeps its checks and stays the authority.
  select * into held from private.verification_phone_proofs f where f.owner_id=p_owner and f.revoked_at is null;
  if held.phone=p_phone then
    raise exception 'phone number already verified' using errcode='PT409', detail='phone_already_verified'; end if;
  if held.id is not null and held.contact_changed_at+interval '15 days'>clock_timestamp() then
    raise exception 'contact change not eligible' using errcode='PT409', detail='phone_change_cooldown',
      hint=to_char((held.contact_changed_at+interval '15 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'); end if;
  if held.id is not null and internal.current_verified_identity(p_owner) is null then
    raise exception 'contact change not eligible' using errcode='PT409', detail='phone_change_identity_required'; end if;
  if exists(select 1 from private.verification_phone_proofs f
      where f.phone=p_phone and f.revoked_at is null and f.owner_id<>p_owner) then
    raise exception 'phone number in use' using errcode='PT409', detail='phone_in_use'; end if;
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
