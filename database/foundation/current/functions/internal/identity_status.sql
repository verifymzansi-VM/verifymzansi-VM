-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_status(p_identity_hmac text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' then
    raise exception 'identity fingerprint required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'banned', exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()),
    'trial_used', exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac));
end;
$function$;
alter function internal.identity_status(text) owner to postgres;
revoke all on function internal.identity_status(text) from public;
grant execute on function internal.identity_status(text) to service_role;
