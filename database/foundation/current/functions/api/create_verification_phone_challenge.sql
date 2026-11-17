-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.create_verification_phone_challenge(p_owner uuid, p_phone text, p_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.create_verification_phone_challenge(p_owner,p_phone,p_hash);
$function$;
alter function api.create_verification_phone_challenge(uuid,text,text) owner to postgres;
revoke all on function api.create_verification_phone_challenge(uuid,text,text) from public;
grant execute on function api.create_verification_phone_challenge(uuid,text,text) to service_role;
