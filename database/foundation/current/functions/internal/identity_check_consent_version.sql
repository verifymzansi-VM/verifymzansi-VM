-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_consent_version()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'identity-check-consent-v1'::text;
$function$;
alter function internal.identity_check_consent_version() owner to postgres;
revoke all on function internal.identity_check_consent_version() from public;
