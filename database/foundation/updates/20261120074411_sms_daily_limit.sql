-- A site-wide daily limit on SMS verification codes (launch checklist item 12,
-- launch assurance LA-A15).
--
-- Every SMS code the website sends is preceded by exactly one call of
-- internal.create_verification_phone_challenge (api.create_verification_phone_challenge,
-- service only): the website pays for the SMS only after the challenge is
-- stored. The website already limits sends per number (10 a day), per account
-- (10 a day) and per network (30 a day). This update adds one limit for the
-- whole site per South African day, so that many accounts or a fault in the
-- website cannot send an unbounded number of codes in one day.
--
-- From this update:
-- 1. New table private.sms_code_days (day, sent): the codes counted per day
--    (Africa/Johannesburg). One small row a day; no account, number or code.
--    No API role has access. Filled once below with the challenges already
--    stored today, so the day the update is applied counts from midnight.
-- 2. New cost allowance 'sms_codes_day' in private.cost_allowances: its
--    free_quantity is the limit, 500 codes a day. It is the one setting:
--    the staff cost page shows it, and a reviewed update (or the owner in the
--    SQL editor) changes it with
--      update private.cost_allowances set free_quantity=<n> where metric='sms_codes_day';
--    It has measurement 'estimate', so internal.check_cost_alarms never reads
--    it; this update raises its alarms itself (point 4).
-- 3. internal.sms_daily_limit(): that value as a whole number (at most
--    1,000,000), or 500 when the row is missing or empty. No API role can run
--    it. STABLE, not IMMUTABLE, so a changed value is read on the next call.
-- 4. internal.create_verification_phone_challenge (same signature, grants and
--    owner) counts the code after every existing refusal (account, number,
--    own number, change rules, phone_banned, phone_in_use), so a refused
--    request uses no place. The count is one UPDATE of the day's row with
--    `sent<limit` in its condition: the row lock makes concurrent requests
--    count one at a time, and a request that waited re-checks the condition
--    on the newest row, so the count never passes the limit. At the limit it
--    refuses with PT429 'daily SMS code limit reached' (detail
--    sms_daily_limit) before it stores a challenge or expires the member's
--    open one, so no SMS is sent and the code already sent still works. The
--    count reaching 70% of the limit raises a staff cost alarm 'warning', and
--    reaching the limit a 'critical' one (internal.engagement_valve_alarms,
--    at most once each a day), shown under open alarms on the staff cost
--    page. The count resets at midnight South African time.
--
-- Known limit: a limit lowered below the day's count refuses at once but
-- raises no alarm that day (no code reaches the limit).
--
-- No API command changes signature, grant or owner. A website release without
-- the matching code shows its generic "Phone verification could not be
-- completed" for the new refusal (still with no SMS); the release with it
-- shows "We can't send codes right now. Please try again later.". ORDER: any
-- time (apply first, then merge, as usual).
-- Read-only preflight: ../preflight/20261120074411_sms_daily_limit.check.sql.
-- Rollback: ../rollback/20261120074411_sms_daily_limit.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- function it replaces has its reviewed body (or this update's).
do $$
declare present integer;
begin
  select (to_regclass('private.sms_code_days') is not null)::integer
    + (to_regprocedure('internal.sms_daily_limit()') is not null)::integer
    + (exists(select 1 from private.cost_allowances a where a.metric='sms_codes_day'))::integer
  into present;
  if present not in (0, 3) then
    raise exception 'sms daily limit precondition: % of 3 objects exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is distinct from '3661274c4f3c00f87490dd4be0809820'
    and (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is distinct from '97060ddadb6f5f73796c9a5c3fcd0b4b' then
    raise exception 'sms daily limit drift: internal.create_verification_phone_challenge is not the reviewed body' using errcode='55000';
  end if;
end$$;

create table if not exists private.sms_code_days (
  day date primary key,
  sent integer not null default 0 check (sent >= 0)
);
alter table private.sms_code_days owner to postgres;
alter table private.sms_code_days enable row level security;
revoke all on private.sms_code_days from public,anon,authenticated,service_role;

-- The challenges already stored today (South African day) count.
insert into private.sms_code_days(day, sent)
select (statement_timestamp() at time zone 'Africa/Johannesburg')::date, count(*)::integer
from private.verification_phone_challenges c
where c.created_at >= ((statement_timestamp() at time zone 'Africa/Johannesburg')::date)::timestamp
  at time zone 'Africa/Johannesburg'
on conflict (day) do nothing;

-- The limit, named for the staff cost page.
insert into private.cost_allowances (metric, label, unit, free_quantity, period, provider, overage_note,
    measured_in_database, measurement)
  values ('sms_codes_day', 'SMS verification codes sent today (daily limit)', 'count', 500, 'day',
    'Africa''s Talking', 'At the limit no more codes are sent until midnight (South African time); members are asked to try again later', true, 'estimate')
  on conflict (metric) do nothing;

CREATE OR REPLACE FUNCTION internal.sms_daily_limit()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- least() ignores a null, so the fallback is applied first.
  select least(coalesce(floor((select a.free_quantity from private.cost_allowances a
    where a.metric = 'sms_codes_day')), 500), 1000000)::integer;
$function$;
alter function internal.sms_daily_limit() owner to postgres;
revoke all on function internal.sms_daily_limit() from public,anon,authenticated,service_role;

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
  -- Staff cost alarms at 70% of the limit (warning) and at the limit (critical).
  perform internal.engagement_valve_alarms('sms_codes_day', day_limit, sent_today-1, sent_today);
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
