-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.acknowledge_cost_alarm(p_alarm_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.acknowledge_cost_alarm(p_alarm_id);
$function$;
alter function api.acknowledge_cost_alarm(uuid) owner to postgres;
revoke all on function api.acknowledge_cost_alarm(uuid) from public;
grant execute on function api.acknowledge_cost_alarm(uuid) to authenticated;
