-- Release one blocked phone number (launch checklist item 21).
--
-- Since 20261117064820_ban_blocks_phone_numbers.sql a ban also blocks every
-- phone number the banned person verified (private.banned_phone_numbers, kept
-- as long as the ban). A number is freed only when the whole ban is lifted or
-- after its 5 years. Networks re-issue numbers, and a number can be blocked by
-- mistake, so staff need to free one number for other people while the ID ban
-- stays.
--
-- From this update:
-- 1. private.banned_phone_numbers gets release columns: release_reason,
--    release_proposed_by, release_proposed_at (a waiting request, 7 days) and
--    released_by, released_at (the approval). A released number is marked,
--    never deleted: the trigger ban_identity_phone_numbers re-runs its
--    "insert ... on conflict do nothing" whenever the ban row changes (a
--    replacement decision, a later ban of the same person), which keeps the
--    mark. The marks go with the ban row (lifted, or purged after 5 years)
--    like the numbers themselves.
-- 2. A release frees the number for other people only.
--    internal.phone_number_banned (full body) ignores released rows; the new
--    internal.phone_number_banned_for(owner, phone) also blocks any account
--    that shares an accepted identity (revoked included) with a running ban
--    listing the number, released or not. internal.create_verification_phone_challenge
--    and internal.finalize_verification_phone (full bodies, otherwise
--    unchanged) ask phone_number_banned_for, so the banned person can never
--    take a released number back.
-- 3. Three staff commands, capability account:restore (admin and governor,
--    an authenticator code from the last 15 minutes; the same as lifting a
--    whole ban):
--    - api.propose_phone_number_release(p_phone, p_reason): asks to free a
--      number a running ban blocks now (otherwise PT404 phone_not_blocked).
--      One waiting request per number (PT409 phone_release_pending); the
--      same staff member sending the same reason again gets the waiting
--      request back (reused). A request that no longer covers every ban row
--      of the number (another ban added one) or has expired is replaced.
--    - api.review_phone_number_release(p_phone, p_proposed_at, p_approve):
--      decides the request the staff member saw (p_proposed_at is its time;
--      otherwise PT409 phone_release_not_pending). Rejection (any staff
--      member with the capability, the proposer included) clears it.
--      Approval needs a request under 7 days old that covers every ban row of
--      the number and whose proposer still holds the capability (PT409
--      phone_release_changed), by a staff member who proposed none of its rows
--      (42501 phone_release_same_staff). It marks the request's rows released
--      and revokes the active phone proof of that number still held by an
--      account of the banned person (only that one), so whoever holds the
--      number now can verify it.
--    - api.get_phone_number_releases(): the requests that can be decided and
--      the latest 50 releases, with the full numbers. Only numbers someone
--      asked to release are listed, never the whole blocked list.
--    Nobody may propose or decide a release of a number that they, or any
--    account sharing an accepted identity with them, verified, or that a ban
--    of such an identity blocks (42501 phone_release_conflict).
--
-- The member is told nothing: no SMS, email or notice. The banned person's ID
-- ban is unchanged. Whoever else holds the number now can verify it normally.
--
-- Expand only: three new API commands, five new columns, two new helpers and
-- three replaced bodies. ORDER: apply first, then merge (the Deploy gate
-- probes every command in the runtime manifest).
-- It refuses with 55000 unless internal.phone_number_banned,
-- internal.create_verification_phone_challenge and
-- internal.finalize_verification_phone have their reviewed bodies (or this
-- update's).
-- Read-only preflight: ../preflight/20261125213005_release_one_phone_number.check.sql.
-- Rollback: ../rollback/20261125213005_release_one_phone_number.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare sig text; body text; allowed text[];
begin
  for sig, allowed in values
    ('internal.phone_number_banned(text)',
      array['ddfab60ae9bad5a5b3f8fb3c5200ade3','07c5a85df974869e998f05d22ba00240']),
    ('internal.create_verification_phone_challenge(uuid,text,text)',
      array['635dd87998cdbdb31dcb4fb20e8ef202','ba09d4443ff6f61787a12f80bd07e6c8']),
    ('internal.finalize_verification_phone(uuid,uuid,text)',
      array['2174d8a4f178fcfe207868e947ddd4af','ee0f0b3ff5a0b1f335e673e4f33f72e7'])
  loop
    select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p where p.oid=to_regprocedure(sig);
    if body is null or not body=any(allowed) then
      raise exception 'release one phone number precondition: % is not a reviewed body (%)',sig,coalesce(body,'absent')
        using errcode='55000';
    end if;
  end loop;
end$$;

alter table private.banned_phone_numbers
  add column if not exists release_reason text,
  add column if not exists release_proposed_by uuid,
  add column if not exists release_proposed_at timestamptz,
  add column if not exists released_by uuid,
  add column if not exists released_at timestamptz;
alter table private.banned_phone_numbers
  drop constraint if exists banned_phone_numbers_release_proposed_by_fkey,
  add constraint banned_phone_numbers_release_proposed_by_fkey foreign key(release_proposed_by) references auth.users(id) on delete set null,
  drop constraint if exists banned_phone_numbers_released_by_fkey,
  add constraint banned_phone_numbers_released_by_fkey foreign key(released_by) references auth.users(id) on delete set null,
  drop constraint if exists banned_phone_numbers_release_reason_check,
  add constraint banned_phone_numbers_release_reason_check check(release_reason is null or length(release_reason) between 10 and 500),
  drop constraint if exists banned_phone_numbers_release_request_check,
  add constraint banned_phone_numbers_release_request_check check((release_proposed_at is null)=(release_reason is null)),
  drop constraint if exists banned_phone_numbers_release_check,
  add constraint banned_phone_numbers_release_check check(released_at is null or release_proposed_at is not null);
create index if not exists banned_phone_numbers_release_proposed_by_idx on private.banned_phone_numbers(release_proposed_by) where release_proposed_by is not null;
create index if not exists banned_phone_numbers_released_by_idx on private.banned_phone_numbers(released_by) where released_by is not null;

-- Whether a running ban blocks p_phone for everyone (not released).
CREATE OR REPLACE FUNCTION internal.phone_number_banned(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.banned_phone_numbers n
    join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned(text) owner to postgres;
revoke all on function internal.phone_number_banned(text) from public,anon,authenticated,service_role;

-- Whether p_phone is blocked for account p_owner: blocked for everyone, or
-- listed (released or not) by a running ban of an identity the account has
-- (or had) as an accepted identity. A release never frees a number for the
-- banned person.
CREATE OR REPLACE FUNCTION internal.phone_number_banned_for(p_owner uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.phone_number_banned(p_phone)
    or exists(select 1 from private.banned_phone_numbers n
      join private.banned_identities b on b.identity_hmac=n.identity_hmac
      join private.accepted_identity_facts f on f.identity_hmac=n.identity_hmac
      where n.phone=p_phone and f.owner_id=p_owner and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned_for(uuid,text) owner to postgres;
revoke all on function internal.phone_number_banned_for(uuid,text) from public,anon,authenticated,service_role;

-- Whether staff member p_actor, or any account sharing an accepted identity
-- (revoked included) with them, verified p_phone, or a ban of such an
-- identity lists it: they may not release it.
CREATE OR REPLACE FUNCTION internal.phone_release_conflict(p_actor uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with accounts as (
    select p_actor as id
    union
    select o.owner_id from private.accepted_identity_facts a
      join private.accepted_identity_facts o on o.identity_hmac=a.identity_hmac
      where a.owner_id=p_actor)
  select exists(select 1 from private.verification_phone_proofs p
      where p.phone=p_phone and p.owner_id in(select id from accounts))
    or exists(select 1 from private.banned_phone_numbers n
      join private.accepted_identity_facts f on f.identity_hmac=n.identity_hmac
      where n.phone=p_phone and f.owner_id in(select id from accounts));
$function$;
alter function internal.phone_release_conflict(uuid,text) owner to postgres;
revoke all on function internal.phone_release_conflict(uuid,text) from public,anon,authenticated,service_role;

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
  -- A released number stays blocked for the banned person's own accounts.
  if internal.phone_number_banned_for(p_owner, p_phone) then
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
  -- A number banned after its code was sent is still refused here, and a
  -- released number stays blocked for the banned person's own accounts.
  if internal.phone_number_banned_for(p_owner, challenge.phone) then
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

CREATE OR REPLACE FUNCTION internal.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');reason_text text;now_at timestamptz;
  blocked integer;waiting integer;requests integer;mine integer;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' then
    raise exception 'valid phone number required' using errcode='22023';end if;
  reason_text:=internal.privacy_text(p_reason,10,500);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  -- The number's unreleased rows under running bans, locked; how many carry a
  -- waiting request, in how many requests, and how many carry this staff
  -- member's same request.
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  select count(*),count(*) filter(where n.release_proposed_at>now_at-interval '7 days'),
      count(distinct n.release_proposed_at) filter(where n.release_proposed_at>now_at-interval '7 days'),
      count(*) filter(where n.release_proposed_at>now_at-interval '7 days' and n.release_proposed_by=actor and n.release_reason=reason_text)
    into blocked,waiting,requests,mine
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if blocked=0 then
    raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  -- A request waits when one request covers every ban row of the number. One
  -- that covers only some (a later ban added a row) is replaced.
  if waiting=blocked and requests=1 then
    if mine=blocked then
      return jsonb_build_object('phone',p_phone,'status','proposed','reused',true);end if;
    raise exception 'a release is already waiting' using errcode='PT409',detail='phone_release_pending';
  end if;
  update private.banned_phone_numbers n set release_reason=reason_text,release_proposed_by=actor,release_proposed_at=now_at
    from private.banned_identities b
    where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  perform internal.staff_actor('account:restore');
  return jsonb_build_object('phone',p_phone,'status','proposed');
end$function$;
alter function internal.propose_phone_number_release(text,text) owner to postgres;
revoke all on function internal.propose_phone_number_release(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.propose_phone_number_release(text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.propose_phone_number_release(p_phone,p_reason)$function$;
alter function api.propose_phone_number_release(text,text) owner to postgres;
revoke all on function api.propose_phone_number_release(text,text) from public,anon,authenticated,service_role;
grant execute on function api.propose_phone_number_release(text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.review_phone_number_release(p_phone text, p_proposed_at timestamptz, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz;
  blocked integer;carrying integer;mine boolean;proposer uuid;holder uuid;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_proposed_at is null or p_approve is null then
    raise exception 'valid phone number, request and decision required' using errcode='22023';end if;
  -- The banned person's account that may still hold the number as an active
  -- proof is locked first, as lifting a restriction locks its subject before
  -- the ban rows.
  if p_approve then
    select p.owner_id into holder from private.verification_phone_proofs p
      where p.phone=p_phone and p.revoked_at is null
        and p.owner_id in(select f.owner_id from private.accepted_identity_facts f
          join private.banned_phone_numbers n on n.identity_hmac=f.identity_hmac
          where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_at is null);
    if holder is not null then perform internal.lock_verification_subject(holder);end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  -- The number's unreleased rows, the rows carrying the request the staff
  -- member saw, whether they proposed any waiting row, and its proposer.
  select count(*),
      count(*) filter(where n.release_proposed_at=p_proposed_at and p_proposed_at>now_at-interval '7 days'),
      coalesce(bool_or(n.release_proposed_by=actor) filter(where n.release_proposed_at>now_at-interval '7 days'),false),
      min(n.release_proposed_by::text) filter(where n.release_proposed_at=p_proposed_at)::uuid
    into blocked,carrying,mine,proposer
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if carrying=0 then
    -- The same approval sent again after it was applied.
    if p_approve and exists(select 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
        where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_by=actor and b.retain_until>now_at) then
      return jsonb_build_object('phone',p_phone,'status','released','reused',true);end if;
    if blocked=0 then
      raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';end if;
    raise exception 'no release is waiting' using errcode='PT409',detail='phone_release_not_pending';
  end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  if not p_approve then
    update private.banned_phone_numbers n set release_reason=null,release_proposed_by=null,release_proposed_at=null
      from private.banned_identities b
      where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at
        and n.release_proposed_at=p_proposed_at;
    perform internal.staff_actor('account:restore');
    return jsonb_build_object('phone',p_phone,'status','rejected');
  end if;
  if mine then
    raise exception 'a different staff member must approve this release' using errcode='42501',detail='phone_release_same_staff';end if;
  -- Approval needs the request to cover every ban row of the number (a later
  -- ban may have added one) and its proposer to still hold the capability.
  if carrying<>blocked or proposer is null
    or not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='account:restore'
      where s.user_id=proposer and s.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=proposer) then
    raise exception 'release request expired or changed' using errcode='PT409',detail='phone_release_changed';end if;
  -- Revoke the banned person's own active proof of the number (only that
  -- one), so whoever holds the number now can verify it.
  if holder is not null then
    update private.verification_phone_proofs p set revoked_at=clock_timestamp()
      where p.owner_id=holder and p.phone=p_phone and p.revoked_at is null
        and p.owner_id in(select f.owner_id from private.accepted_identity_facts f
          join private.banned_phone_numbers n on n.identity_hmac=f.identity_hmac
          where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_at is null);
  end if;
  update private.banned_phone_numbers n set released_by=actor,released_at=now_at
    from private.banned_identities b
    where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at
      and n.release_proposed_at=p_proposed_at;
  perform internal.staff_actor('account:restore');
  return jsonb_build_object('phone',p_phone,'status','released');
end$function$;
alter function internal.review_phone_number_release(text,timestamptz,boolean) owner to postgres;
revoke all on function internal.review_phone_number_release(text,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.review_phone_number_release(text,timestamptz,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.review_phone_number_release(p_phone text, p_proposed_at timestamptz, p_approve boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.review_phone_number_release(p_phone,p_proposed_at,p_approve)$function$;
alter function api.review_phone_number_release(text,timestamptz,boolean) owner to postgres;
revoke all on function api.review_phone_number_release(text,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function api.review_phone_number_release(text,timestamptz,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();
begin
  return jsonb_build_object('actor_id',actor,
    -- Requests that can be decided: one waiting request covers every
    -- unreleased ban row of the number. A partial one is asked again.
    'pending',coalesce((select jsonb_agg(jsonb_build_object('phone',w.phone,'reason',w.reason,
        'proposed_at',w.proposed_at,'expires_at',w.proposed_at+interval '7 days',
        'proposed_by_name',internal.profile_public_name(p.display_name),
        'proposed_by_me',w.proposer is not distinct from actor,
        'conflicted',internal.phone_release_conflict(actor,w.phone)) order by w.proposed_at desc,w.phone)
      from (select n.phone,min(n.release_reason) as reason,min(n.release_proposed_at) as proposed_at,
            min(n.release_proposed_by::text)::uuid as proposer
          from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
          where n.released_at is null and b.retain_until>now_at
          group by n.phone
          having count(*)=count(*) filter(where n.release_proposed_at>now_at-interval '7 days')
            and count(distinct n.release_proposed_at)=1) w
        left join private.profiles p on p.account_id=w.proposer),'[]'::jsonb),
    'released',coalesce((select jsonb_agg(jsonb_build_object('phone',r.phone,'reason',r.release_reason,
        'proposed_by_name',internal.profile_public_name(pp.display_name),
        'released_by_name',internal.profile_public_name(rp.display_name),
        'released_at',r.released_at) order by r.released_at desc,r.phone)
      from (select * from (select distinct on(n.phone) n.phone,n.release_reason,n.release_proposed_by,n.released_by,n.released_at
            from private.banned_phone_numbers n where n.released_at is not null
            order by n.phone,n.released_at desc) latest
          order by latest.released_at desc,latest.phone limit 50) r
        left join private.profiles pp on pp.account_id=r.release_proposed_by
        left join private.profiles rp on rp.account_id=r.released_by),'[]'::jsonb));
end$function$;
alter function internal.get_phone_number_releases() owner to postgres;
revoke all on function internal.get_phone_number_releases() from public,anon,authenticated,service_role;
grant execute on function internal.get_phone_number_releases() to authenticated;

CREATE OR REPLACE FUNCTION api.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_phone_number_releases()$function$;
alter function api.get_phone_number_releases() owner to postgres;
revoke all on function api.get_phone_number_releases() from public,anon,authenticated,service_role;
grant execute on function api.get_phone_number_releases() to authenticated;

notify pgrst,'reload schema';
commit;
