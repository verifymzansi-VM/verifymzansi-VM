-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_ozow_refund_send(p_request_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_ozow_refund_send(p_request_id, p_result);
$function$;
alter function api.record_ozow_refund_send(uuid,jsonb) owner to postgres;
revoke all on function api.record_ozow_refund_send(uuid,jsonb) from public;
grant execute on function api.record_ozow_refund_send(uuid,jsonb) to service_role;
