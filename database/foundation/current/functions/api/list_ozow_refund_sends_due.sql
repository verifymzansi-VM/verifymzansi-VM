-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_ozow_refund_sends_due(p_limit integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_ozow_refund_sends_due(p_limit);
$function$;
alter function api.list_ozow_refund_sends_due(integer) owner to postgres;
revoke all on function api.list_ozow_refund_sends_due(integer) from public;
grant execute on function api.list_ozow_refund_sends_due(integer) to service_role;
