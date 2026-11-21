-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.attach_capture_handoff_identity(p_owner uuid, p_token_sha256 text, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_owner is null or p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'phone link required' using errcode='22023'; end if;
  if p_identity is null or jsonb_typeof(p_identity)<>'object'
      or p_identity-array['fingerprint','encrypted_number']<>'{}'::jsonb
      or not(p_identity ?& array['fingerprint','encrypted_number'])
      or jsonb_typeof(p_identity->'fingerprint') is distinct from 'string'
      or p_identity->>'fingerprint' !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      or jsonb_typeof(p_identity->'encrypted_number') is distinct from 'object'
      or (p_identity->'encrypted_number')-array['ciphertext','iv','tag','key_id']<>'{}'::jsonb
      or not(p_identity->'encrypted_number' ?& array['ciphertext','iv','tag','key_id'])
      or jsonb_typeof(p_identity->'encrypted_number'->'ciphertext') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'iv') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'tag') is distinct from 'string'
      or jsonb_typeof(p_identity->'encrypted_number'->'key_id') is distinct from 'string'
      or p_identity->'encrypted_number'->>'ciphertext' !~ '^[a-f0-9]{26}$'
      or p_identity->'encrypted_number'->>'iv' !~ '^[a-f0-9]{24}$'
      or p_identity->'encrypted_number'->>'tag' !~ '^[a-f0-9]{32}$'
      or p_identity->'encrypted_number'->>'key_id' is distinct from 'identity-number-v1' then
    raise exception 'encrypted identity receipt required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  update private.capture_handoffs h set fingerprint=p_identity->>'fingerprint',
      encrypted_number=p_identity->'encrypted_number'
    where h.token_sha256=p_token_sha256 and h.owner_id=p_owner and h.expects_id
      and h.fingerprint is null and h.used_at is null and h.expires_at>clock_timestamp();
  if not found then
    raise exception 'phone link expired or already used' using errcode='PT409',detail='handoff_unavailable'; end if;
  return jsonb_build_object('attached',true);
end;
$function$;
alter function internal.attach_capture_handoff_identity(uuid,text,jsonb) owner to postgres;
revoke all on function internal.attach_capture_handoff_identity(uuid,text,jsonb) from public;
grant execute on function internal.attach_capture_handoff_identity(uuid,text,jsonb) to service_role;
