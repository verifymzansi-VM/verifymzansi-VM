-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.finalize_verification_phone(p_owner uuid, p_challenge uuid, p_expected_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.finalize_verification_phone(p_owner,p_challenge,p_expected_hash);
$function$;
alter function api.finalize_verification_phone(uuid,uuid,text) owner to postgres;
revoke all on function api.finalize_verification_phone(uuid,uuid,text) from public;
grant execute on function api.finalize_verification_phone(uuid,uuid,text) to service_role;
