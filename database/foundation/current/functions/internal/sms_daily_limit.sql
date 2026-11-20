-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.sms_daily_limit()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- least() ignores a null, so the fallback is applied first.
  select least(coalesce(floor((select a.free_quantity from private.cost_allowances a
    where a.metric = 'sms_codes_day')), 500), 1000000)::integer;
$function$;
alter function internal.sms_daily_limit() owner to postgres;
revoke all on function internal.sms_daily_limit() from public;
