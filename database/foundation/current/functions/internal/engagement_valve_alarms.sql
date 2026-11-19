-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.engagement_valve_alarms(p_metric text, p_valve integer, p_before integer, p_after integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  insert into private.cost_alarms (metric, level, period, used, free_quantity)
  select p_metric, l.level, to_char((statement_timestamp() at time zone 'Africa/Johannesburg')::date, 'YYYY-MM-DD'),
    p_after, p_valve
  from (values ('warning', p_valve * 7 / 10), ('critical', p_valve)) l(level, threshold)
  where p_before < l.threshold and p_after >= l.threshold
  on conflict (metric, level, period) do nothing;
$function$;
alter function internal.engagement_valve_alarms(text,integer,integer,integer) owner to postgres;
revoke all on function internal.engagement_valve_alarms(text,integer,integer,integer) from public;
