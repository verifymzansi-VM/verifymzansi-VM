-- Reviewed rollback for updates/20261125213005_release_one_phone_number.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It drops the three release
-- commands and their helpers, puts back the earlier bodies of
-- internal.phone_number_banned, internal.create_verification_phone_challenge
-- and internal.finalize_verification_phone byte for byte, and drops the
-- release columns with their indexes and rules. Numbers released meanwhile
-- are blocked again while their ban runs (their release marks are dropped with
-- the columns); a phone proof the approval revoked stays revoked.
-- It refuses (55000) unless the three functions have the update's bodies.
begin;
set local lock_timeout='5s';

do $$
declare sig text; body text; updated text;
begin
  for sig, updated in values
    ('internal.phone_number_banned(text)','07c5a85df974869e998f05d22ba00240'),
    ('internal.create_verification_phone_challenge(uuid,text,text)','ba09d4443ff6f61787a12f80bd07e6c8'),
    ('internal.finalize_verification_phone(uuid,uuid,text)','ee0f0b3ff5a0b1f335e673e4f33f72e7')
  loop
    select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p where p.oid=to_regprocedure(sig);
    if body is distinct from updated then
      raise exception 'rollback precondition: the release one phone number update is not applied as reviewed (% %)',sig,coalesce(body,'absent')
        using errcode='55000';
    end if;
  end loop;
end$$;

drop function if exists api.get_phone_number_releases();
drop function if exists internal.get_phone_number_releases();
drop function if exists api.review_phone_number_release(text,timestamptz,boolean);
drop function if exists internal.review_phone_number_release(text,timestamptz,boolean);
drop function if exists api.propose_phone_number_release(text,text);
drop function if exists internal.propose_phone_number_release(text,text);
drop function if exists internal.phone_release_conflict(uuid,text);

CREATE OR REPLACE FUNCTION internal.create_verification_phone_challenge(p_owner uuid, p_phone text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare challenge private.verification_phone_challenges; held private.verification_phone_proofs;
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  day_limit integer; sent_today integer;
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
  -- Site-wide daily limit on codes sent (South African day), counted after
  -- every refusal above. The UPDATE locks the day's row, so concurrent
  -- requests count one at a time and the count never passes the limit. Over
  -- it nothing is stored and no SMS is sent.
  day_limit := internal.sms_daily_limit();
  insert into private.sms_code_days(day) values(today) on conflict (day) do nothing;
  update private.sms_code_days d set sent=d.sent+1 where d.day=today and d.sent<day_limit
    returning d.sent into sent_today;
  if sent_today is null then
    raise exception 'daily SMS code limit reached' using errcode='PT429', detail='sms_daily_limit'; end if;
  -- Staff cost alarms at 70% of the limit (warning) and at the limit
  -- (critical). A cost alarm needs its allowance row: without the row the
  -- fallback limit still holds and no alarm is raised.
  if exists(select 1 from private.cost_allowances a where a.metric='sms_codes_day') then
    perform internal.engagement_valve_alarms('sms_codes_day', day_limit, sent_today-1, sent_today);
  end if;
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
drop function if exists internal.phone_number_banned_for(uuid,text);

drop index if exists private.banned_phone_numbers_release_proposed_by_idx;
drop index if exists private.banned_phone_numbers_released_by_idx;
alter table private.banned_phone_numbers
  drop constraint if exists banned_phone_numbers_release_check,
  drop constraint if exists banned_phone_numbers_release_request_check,
  drop constraint if exists banned_phone_numbers_release_reason_check,
  drop constraint if exists banned_phone_numbers_released_by_fkey,
  drop constraint if exists banned_phone_numbers_release_proposed_by_fkey,
  drop column if exists released_at,
  drop column if exists released_by,
  drop column if exists release_proposed_at,
  drop column if exists release_proposed_by,
  drop column if exists release_reason;

notify pgrst,'reload schema';
commit;
