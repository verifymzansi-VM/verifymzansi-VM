-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_dashboard_refund(p_payment_id uuid, p_line_id uuid, p_reason_code text, p_reason text, p_ozow_refund_id uuid, p_ozow_fact jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_ozow_refund('dashboard', p_payment_id, p_line_id, p_reason_code, p_reason, p_ozow_refund_id,
    p_ozow_fact);
$function$;
alter function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb) owner to postgres;
revoke all on function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb) from public;
grant execute on function internal.record_staff_dashboard_refund(uuid,uuid,text,text,uuid,jsonb) to authenticated;
