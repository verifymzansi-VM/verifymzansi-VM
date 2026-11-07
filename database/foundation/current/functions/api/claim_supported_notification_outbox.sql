-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.claim_supported_notification_outbox(p_supported_kinds,p_limit)$function$;
alter function api.claim_supported_notification_outbox(text[],integer) owner to postgres;
revoke all on function api.claim_supported_notification_outbox(text[],integer) from public;
grant execute on function api.claim_supported_notification_outbox(text[],integer) to service_role;
