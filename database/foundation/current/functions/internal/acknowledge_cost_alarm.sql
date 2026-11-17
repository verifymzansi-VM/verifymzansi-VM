-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.acknowledge_cost_alarm(p_alarm_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('cost:acknowledge'); alarm private.cost_alarms;
begin
  update private.cost_alarms set acknowledged_by = actor, acknowledged_at = statement_timestamp()
  where id = p_alarm_id and acknowledged_at is null returning * into alarm;
  if alarm.id is null then raise exception 'open alarm not found' using errcode = '22023'; end if;
  actor:=internal.staff_actor('cost:acknowledge'); -- final authority after the alarm row wait
  return jsonb_build_object('id', alarm.id, 'acknowledged_at', alarm.acknowledged_at);
end;
$function$;
alter function internal.acknowledge_cost_alarm(uuid) owner to postgres;
revoke all on function internal.acknowledge_cost_alarm(uuid) from public;
grant execute on function internal.acknowledge_cost_alarm(uuid) to authenticated;
