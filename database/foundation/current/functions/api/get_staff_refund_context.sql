-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_staff_refund_context(p_payment_id uuid, p_line_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_staff_refund_context(p_payment_id, p_line_id, p_request_id);
$function$;
alter function api.get_staff_refund_context(uuid,uuid,uuid) owner to postgres;
revoke all on function api.get_staff_refund_context(uuid,uuid,uuid) from public;
grant execute on function api.get_staff_refund_context(uuid,uuid,uuid) to authenticated;
