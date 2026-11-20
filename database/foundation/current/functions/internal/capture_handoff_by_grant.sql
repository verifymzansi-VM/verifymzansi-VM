-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_by_grant(p_grant_sha256 text)
 RETURNS private.capture_handoffs
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare h private.capture_handoffs; owner uuid;
begin
  if p_grant_sha256 is null or p_grant_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'capture grant required' using errcode='22023'; end if;
  select x.owner_id into owner from private.capture_handoffs x where x.grant_sha256=p_grant_sha256;
  if owner is not null then
    perform internal.lock_verification_subject(owner);
    select x.* into h from private.capture_handoffs x where x.grant_sha256=p_grant_sha256 for update;
  end if;
  if h.token_sha256 is null or not internal.capture_handoff_usable(h,true) then
    raise exception 'phone link expired or replaced' using errcode='PT409',detail='handoff_unavailable'; end if;
  return h;
end;
$function$;
alter function internal.capture_handoff_by_grant(text) owner to postgres;
revoke all on function internal.capture_handoff_by_grant(text) from public;
