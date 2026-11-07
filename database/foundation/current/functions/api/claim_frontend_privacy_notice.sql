-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_frontend_privacy_notice()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.claim_frontend_privacy_notice()$function$;
alter function api.claim_frontend_privacy_notice() owner to postgres;
revoke all on function api.claim_frontend_privacy_notice() from public;
grant execute on function api.claim_frontend_privacy_notice() to service_role;
