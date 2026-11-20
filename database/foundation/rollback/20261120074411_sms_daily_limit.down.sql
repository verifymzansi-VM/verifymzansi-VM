-- Reviewed rollback for updates/20261120074411_sms_daily_limit.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix (to send more codes, raise the
-- setting instead). Websites deployed before and after the update work without
-- it, so it can be run at any time.
-- The rollback puts back internal.create_verification_phone_challenge byte for
-- byte, and drops internal.sms_daily_limit, private.sms_code_days (with the
-- daily counts), the cost allowance 'sms_codes_day' and its cost alarms. The
-- website's per-number, per-account and per-network limits are unchanged.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.create_verification_phone_challenge(uuid,text,text)'))
      is distinct from '635dd87998cdbdb31dcb4fb20e8ef202'
    or to_regclass('private.sms_code_days') is null then
    raise exception 'rollback precondition: the sms daily limit update is not applied' using errcode='55000';
  end if;
end$$;

-- The function as it was before the update.
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

drop function if exists internal.sms_daily_limit();
delete from private.cost_alarms where metric='sms_codes_day';
delete from private.cost_allowances where metric='sms_codes_day';
drop table if exists private.sms_code_days;

notify pgrst,'reload schema';
commit;
