-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.report_ozow_refund_missing(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.report_ozow_refund_missing(p_request_id);
$function$;
alter function api.report_ozow_refund_missing(uuid) owner to postgres;
revoke all on function api.report_ozow_refund_missing(uuid) from public;
grant execute on function api.report_ozow_refund_missing(uuid) to service_role;
