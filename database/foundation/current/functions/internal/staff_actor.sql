-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_actor(p_capability text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  needs_mfa boolean;
  totp_at bigint; proof_after timestamptz;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false) or claims->>'aal' is distinct from 'aal2' then
    raise exception 'staff session with second factor required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text = claims->>'session_id' and s.user_id = actor
      and s.aal = 'aal2' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live staff session required' using errcode = '42501';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = actor) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = actor
      and f.factor_type = 'totp' and f.status = 'verified') then
    raise exception 'verified authenticator app required' using errcode = '42501';
  end if;
  select max((a->>'timestamp')::bigint) into totp_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]' end) a
  where jsonb_typeof(a) = 'object' and a->>'method' = 'totp' and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if totp_at is null or totp_at < extract(epoch from clock_timestamp() - interval '12 hours') then
    raise exception 'staff second-factor verification expired' using errcode = '42501';
  end if;
  select c.requires_recent_mfa,r.frontend_mfa_not_before into needs_mfa,proof_after
  from private.staff_roles r join private.staff_capabilities c on c.role = r.role
  where r.user_id = actor and r.revoked_at is null and c.capability = p_capability;
  if not found then raise exception 'capability not granted' using errcode = '42501'; end if;
  if proof_after is not null and totp_at<ceil(extract(epoch from proof_after)) then
    raise exception 'second-factor verification required after role assignment' using errcode='42501';end if;
  if needs_mfa and totp_at < extract(epoch from clock_timestamp() - interval '15 minutes') then
    raise exception 'recent second-factor verification required' using errcode = '42501';
  end if;
  return actor;
end;
$function$;
alter function internal.staff_actor(text) owner to postgres;
revoke all on function internal.staff_actor(text) from public;
grant execute on function internal.staff_actor(text) to authenticated;
