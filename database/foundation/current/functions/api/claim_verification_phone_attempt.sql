-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_verification_phone_attempt(p_owner uuid, p_challenge uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.claim_verification_phone_attempt(p_owner,p_challenge);
$function$;
alter function api.claim_verification_phone_attempt(uuid,uuid) owner to postgres;
revoke all on function api.claim_verification_phone_attempt(uuid,uuid) from public;
grant execute on function api.claim_verification_phone_attempt(uuid,uuid) to service_role;
