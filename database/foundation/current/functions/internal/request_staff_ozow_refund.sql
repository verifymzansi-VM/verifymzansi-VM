-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.request_staff_ozow_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_ozow_refund('api', p_payment_id, p_line_id, p_reason_code, p_reason, null);
$function$;
alter function internal.request_staff_ozow_refund(uuid,uuid,text,text) owner to postgres;
revoke all on function internal.request_staff_ozow_refund(uuid,uuid,text,text) from public;
grant execute on function internal.request_staff_ozow_refund(uuid,uuid,text,text) to authenticated;
