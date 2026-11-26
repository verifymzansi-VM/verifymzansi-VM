-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.create_verification_phone_challenge(uuid,text,text) from public;
grant execute on function internal.create_verification_phone_challenge(uuid,text,text) to service_role;
