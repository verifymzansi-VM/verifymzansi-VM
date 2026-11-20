-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.redeem_capture_handoff(p_token_sha256 text, p_grant_sha256 text, p_signed_in uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; owner uuid;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$'
    or p_grant_sha256 is null or p_grant_sha256 !~ '^[a-f0-9]{64}$' or p_grant_sha256=p_token_sha256 then
    raise exception 'phone link token and capture grant required' using errcode='22023'; end if;
  -- Asked before the link is looked up: a signed-out phone learns nothing.
  if p_signed_in is null then
    raise exception 'sign in on this phone with the same account' using errcode='42501',detail='handoff_sign_in_required'; end if;
  select x.owner_id into owner from private.capture_handoffs x where x.token_sha256=p_token_sha256;
  if owner is not null then
    perform internal.lock_verification_subject(owner);
    select x.* into h from private.capture_handoffs x where x.token_sha256=p_token_sha256 for update;
  end if;
  if h.token_sha256 is null or not internal.capture_handoff_usable(h,false) then
    raise exception 'phone link expired or already used' using errcode='PT409',detail='handoff_unavailable'; end if;
  perform internal.capture_handoff_signed_in(h,p_signed_in);
  update private.capture_handoffs set used_at=clock_timestamp(),grant_sha256=p_grant_sha256
    where token_sha256=p_token_sha256 returning * into h;
  return internal.capture_handoff_state(h);
end;
$function$;
alter function internal.redeem_capture_handoff(text,text,uuid) owner to postgres;
revoke all on function internal.redeem_capture_handoff(text,text,uuid) from public;
grant execute on function internal.redeem_capture_handoff(text,text,uuid) to service_role;
