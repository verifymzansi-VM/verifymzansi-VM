-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_staff_slot_refund(p_line_id uuid, p_kind text, p_reason_code text, p_reason text, p_ozow_reference text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_slot_refund(p_line_id, p_kind, p_reason_code, p_reason, p_ozow_reference);
$function$;
alter function api.record_staff_slot_refund(uuid,text,text,text,text) owner to postgres;
revoke all on function api.record_staff_slot_refund(uuid,text,text,text,text) from public;
grant execute on function api.record_staff_slot_refund(uuid,text,text,text,text) to authenticated;
