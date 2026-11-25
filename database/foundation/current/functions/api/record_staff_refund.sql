-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_staff_refund(p_payment_id uuid, p_line_id uuid, p_channel text, p_amount_cents bigint, p_reason_code text, p_reason text, p_reference text, p_ozow_fact jsonb, p_asked_on text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_staff_refund(p_payment_id, p_line_id, p_channel, p_amount_cents, p_reason_code, p_reason,
    p_reference, p_ozow_fact, p_asked_on);
$function$;
alter function api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) owner to postgres;
revoke all on function api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) from public;
grant execute on function api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text) to authenticated;
