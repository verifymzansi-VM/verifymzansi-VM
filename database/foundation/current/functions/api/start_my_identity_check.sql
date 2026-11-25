-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.start_my_identity_check(p_consent_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.start_my_identity_check(p_consent_version);
$function$;
alter function api.start_my_identity_check(text) owner to postgres;
revoke all on function api.start_my_identity_check(text) from public;
grant execute on function api.start_my_identity_check(text) to authenticated;
