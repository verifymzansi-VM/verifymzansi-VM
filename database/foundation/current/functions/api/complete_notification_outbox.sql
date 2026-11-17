-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_notification_outbox(p_id uuid, p_claim uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_notification_outbox(p_id,p_claim,p_ok,p_error);
$function$;
alter function api.complete_notification_outbox(uuid,uuid,boolean,text) owner to postgres;
revoke all on function api.complete_notification_outbox(uuid,uuid,boolean,text) from public;
grant execute on function api.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;
