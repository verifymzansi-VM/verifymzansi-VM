-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.check_cost_alarms()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  insert into private.cost_alarms (metric, level, period, used, free_quantity)
  select a.metric, l.level, to_char(statement_timestamp() at time zone 'UTC', case when a.period='day' then 'YYYY-MM-DD' else 'YYYY-MM' end), u.used, a.free_quantity
  from private.cost_allowances a join internal.cost_usage() u on u.metric = a.metric
  cross join (values ('warning', 0.7), ('critical', 0.9)) l (level, share)
  where a.measurement='database_observation' and a.verified_on is not null and a.billing_scope<>'unverified' and a.free_quantity is not null and u.used >= a.free_quantity * l.share
  on conflict (metric, level, period) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.check_cost_alarms() owner to postgres;
revoke all on function internal.check_cost_alarms() from public;
grant execute on function internal.check_cost_alarms() to service_role;
