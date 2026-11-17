-- A ban also blocks the banned person's phone numbers.
--
-- Owner decision of 17 November 2026: a banned person must not be able to make
-- us send (and pay for) SMS codes by entering their number again on a new
-- account. Until now a ban stored only the identity fingerprint
-- (private.banned_identities, 5 years), which stops the person at the ID step,
-- after the SMS. Their number stayed blocked only while their banned account
-- held it, and was free again once that account was closed.
--
-- From this update:
-- 1. New table private.banned_phone_numbers (identity_hmac, phone): the
--    numbers a ban blocks, each tied to its row in private.banned_identities
--    (on delete cascade). A number is blocked exactly as long as the ban:
--    released at once when the ban is lifted (that row is deleted), and after
--    its 5 years (internal.purge_expired_identity_bans deletes it; a ban whose
--    time has passed blocks nothing even before the purge runs). A replacement
--    decision that keeps the ban keeps its numbers. No API role can read it.
-- 2. Which numbers: every number verified (active or revoked, while the proof
--    is still on record) by any account whose accepted identity has the banned
--    fingerprint, except a number another person currently holds as an active
--    proof, so a recycled number already verified by someone else is never
--    blocked under them. The numbers are copied when the ban is recorded
--    (trigger ban_identity_phone_numbers on private.banned_identities, after
--    insert or update), so they stay blocked after the proofs are deleted.
--    Bans recorded before this update are filled in once below.
-- 3. internal.create_verification_phone_challenge refuses a blocked number
--    with PT409 'phone number unavailable' (detail phone_banned) before any
--    challenge is stored, so no SMS is sent. Order: the member's own verified
--    number, then the two change rules, then phone_banned, then phone_in_use.
--    internal.finalize_verification_phone refuses it too (a code sent just
--    before the ban), as the authority.
-- 4. internal.phone_number_banned(p_phone): whether a number is blocked by a
--    ban that is still running. No API role can execute it.
--
-- The website shows a neutral message for phone_banned ("This phone number
-- can't be used on VerifyMzansi. Contact support if you think this is a
-- mistake."), never that a ban exists: networks re-issue numbers, and a ban is
-- personal information about the number's earlier owner.
--
-- No API command changes signature, grant or owner. A website release without
-- the matching code shows its generic refusal for the new reason (still no
-- SMS). ORDER: any time.
-- Read-only preflight: ../preflight/20261117064820_ban_blocks_phone_numbers.check.sql.
-- Rollback: ../rollback/20261117064820_ban_blocks_phone_numbers.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the two functions are the reviewed bodies (or this update's).
do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is distinct from '6bd315ea00157c1caf6655ed17a079be'
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is distinct from '3661274c4f3c00f87490dd4be0809820' then
    raise exception 'phone ban drift: internal.create_verification_phone_challenge is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.finalize_verification_phone(uuid,uuid,text)'))
      is distinct from 'b91370e1e74f3713b73dff260eb8d5b0'
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.finalize_verification_phone(uuid,uuid,text)'))
      is distinct from '2174d8a4f178fcfe207868e947ddd4af' then
    raise exception 'phone ban drift: internal.finalize_verification_phone is not the reviewed body' using errcode='55000';
  end if;
end$$;

create table if not exists private.banned_phone_numbers (
  identity_hmac text not null references private.banned_identities(identity_hmac) on delete cascade,
  phone text not null check(phone ~ '^\+27[0-9]{9}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(identity_hmac,phone)
);
create index if not exists banned_phone_numbers_phone_idx on private.banned_phone_numbers(phone);
alter table private.banned_phone_numbers owner to postgres;
alter table private.banned_phone_numbers enable row level security;
revoke all on private.banned_phone_numbers from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.phone_number_banned(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.banned_phone_numbers n
    join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned(text) owner to postgres;
revoke all on function internal.phone_number_banned(text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.ban_identity_phone_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.retain_until<=clock_timestamp() then return null; end if;
  -- Every number the banned person's accounts verified and that is still on
  -- record, except one another person now holds as an active proof.
  insert into private.banned_phone_numbers(identity_hmac,phone)
  select distinct new.identity_hmac,p.phone from private.verification_phone_proofs p
  where p.owner_id in(select f.owner_id from private.accepted_identity_facts f where f.identity_hmac=new.identity_hmac)
    and not exists(select 1 from private.verification_phone_proofs o
      where o.phone=p.phone and o.revoked_at is null
        and o.owner_id not in(select f.owner_id from private.accepted_identity_facts f where f.identity_hmac=new.identity_hmac))
  on conflict do nothing;
  return null;
end;
$function$;
alter function internal.ban_identity_phone_numbers() owner to postgres;
revoke all on function internal.ban_identity_phone_numbers() from public,anon,authenticated,service_role;

drop trigger if exists ban_identity_phone_numbers on private.banned_identities;
create trigger ban_identity_phone_numbers after insert or update on private.banned_identities
  for each row execute function internal.ban_identity_phone_numbers();

-- Bans recorded before this update.
insert into private.banned_phone_numbers(identity_hmac,phone)
select distinct b.identity_hmac,p.phone from private.banned_identities b
  join private.accepted_identity_facts f on f.identity_hmac=b.identity_hmac
  join private.verification_phone_proofs p on p.owner_id=f.owner_id
where b.retain_until>clock_timestamp()
  and not exists(select 1 from private.verification_phone_proofs o
    where o.phone=p.phone and o.revoked_at is null
      and o.owner_id not in(select f2.owner_id from private.accepted_identity_facts f2 where f2.identity_hmac=b.identity_hmac))
on conflict do nothing;

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
  if internal.phone_number_banned(p_phone) then
    raise exception 'phone number unavailable' using errcode='PT409', detail='phone_banned'; end if;
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
  -- A number banned after its code was sent is still refused here.
  if internal.phone_number_banned(challenge.phone) then
    raise exception 'phone number unavailable' using errcode='PT409', detail='phone_banned'; end if;
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
revoke all on function internal.finalize_verification_phone(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.finalize_verification_phone(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
