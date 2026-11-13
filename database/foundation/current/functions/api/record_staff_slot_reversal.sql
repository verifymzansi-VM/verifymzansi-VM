-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_slot_reversal(p_line_id, p_kind, p_reason);
$function$;
alter function api.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function api.record_staff_slot_reversal(uuid,text,text) from public;
grant execute on function api.record_staff_slot_reversal(uuid,text,text) to authenticated;
